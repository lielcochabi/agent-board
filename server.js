// Agent Board: zero-dependency local server.
// Reads agent status files and agent output docs from disk for any registered project, streams change events to the browser,
// creates new agents / registers new projects, and queues run requests (files only, nothing is executed).
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile, execFileSync } = require('child_process');

const PORT = Number(process.env.PORT) || 4747;
const PUBLIC = path.join(__dirname, 'public');
// Machine-specific state lives outside the plugin folder when installed as a plugin (CLAUDE_PLUGIN_DATA survives updates).
const DATA_DIR = process.env.BOARD_DATA || process.env.CLAUDE_PLUGIN_DATA || __dirname;
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}
const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json');

// ---------- projects ----------
// The JARVIS mapping is only used when JARVIS_PROJECT is set; a fresh install starts with an empty board.
const JARVIS_ROOT = process.env.JARVIS_PROJECT || '';
const JARVIS_REPO = process.env.JARVIS_REPO || path.join(JARVIS_ROOT, 'jarvis-client');
const JARVIS_TODO = process.env.JARVIS_TODO || '';

function defaultProjects() {
  if (!JARVIS_ROOT) return [];
  const d = (rel, base = JARVIS_REPO) => path.join(base, rel);
  return [{
    id: 'jarvis', name: 'JARVIS', root: JARVIS_ROOT, repo: JARVIS_REPO,
    order: ['scout', 'compass', 'forge', 'echo', 'sentry', 'warden', 'herald', 'scribe', 'custodian'],
    outputs: [
      { key: 'plans', label: 'Plans', dir: d('docs/plans'), agent: 'compass' },
      { key: 'qa', label: 'QA', dir: d('docs/qa'), agent: 'sentry' },
      { key: 'research', label: 'Research', dir: d('docs/research'), agent: 'scout' },
      { key: 'review', label: 'Reviews', dir: d('docs/review'), agent: 'warden' },
      { key: 'audit', label: 'Audits', dir: d('docs/audit'), agent: 'custodian' },
      { key: 'prompts', label: 'Prompt log', dir: d('docs/prompt-log'), agent: 'echo' },
      { key: 'missions', label: 'Missions', dir: d('agent-missions', JARVIS_ROOT), agent: 'mission' },
    ],
    files: JARVIS_TODO ? [{ key: 'todo', label: 'TODO', file: JARVIS_TODO, agent: 'scribe' }] : [],
  }];
}
function genericProject(id, name, root) {
  return {
    id, name, root, repo: root, order: [],
    outputs: [
      { key: 'docs', label: 'Docs', dir: path.join(root, 'docs'), agent: 'folder' },
      { key: 'missions', label: 'Missions', dir: path.join(root, 'agent-missions'), agent: 'mission' },
    ],
    files: [],
  };
}
let projects;
try { projects = JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf8')); }
catch { projects = defaultProjects(); fs.writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2)); }
const saveProjects = () => fs.writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2));
const getProject = id => projects.find(p => p.id === id);
const statusDir = p => path.join(p.root, 'agent-status');
const agentsDir = p => path.join(p.root, '.claude', 'agents');
const promptsDir = p => path.join(p.root, 'agent-prompts');
const requestsDir = p => path.join(p.root, 'agent-requests');

// ---------- reading ----------
function parseStatus(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*`?(state|task|step|updated|output)`?\s*:\s*`?(.*?)`?\s*$/i);
    if (m) out[m[1].toLowerCase()] = m[2];
  }
  return out;
}
function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const out = {};
  if (!m) return out;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([a-zA-Z_-]+):\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if (/^".*"$/.test(v)) { try { v = JSON.parse(v); } catch { v = v.slice(1, -1); } }
    out[kv[1]] = v;
  }
  return out;
}
function walk(dir, base = '') {
  let files = [], entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return files; }
  for (const e of entries) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) files = files.concat(walk(path.join(dir, e.name), rel));
    else if (/\.(md|txt|csv|json|html|log)$/i.test(e.name)) files.push(rel);
  }
  return files;
}
const EMBLEMS = ['scout', 'compass', 'forge', 'echo', 'sentry', 'warden', 'herald', 'scribe', 'custodian', 'orb'];
// No tools line means the agent inherits everything the session has (connectors included), which is what a non-code operator is.
const agentType = tools => !tools || /mcp__/.test(tools) ? 'Operator' : /\bEdit\b/.test(tools) ? 'Builder' : /WebSearch|WebFetch/.test(tools || '') ? 'Researcher' : 'Reviewer';
function readAgents(p) {
  let names = [];
  try { names = fs.readdirSync(agentsDir(p)).filter(f => f.endsWith('.md')); } catch {}
  const missionRoot = p.outputs.find(o => o.key === 'missions');
  const missionFiles = missionRoot ? walk(missionRoot.dir) : [];
  let requestFiles = [];
  try { requestFiles = fs.readdirSync(requestsDir(p)).filter(f => f.endsWith('.md')); } catch {}
  const agents = names.map(f => {
    const fm = parseFrontmatter(fs.readFileSync(path.join(agentsDir(p), f), 'utf8'));
    const name = fm.name || f.replace(/\.md$/, '');
    let s = {}, mt = 0;
    const statusFile = path.join(statusDir(p), `${name}.md`);
    try { s = parseStatus(fs.readFileSync(statusFile, 'utf8')); mt = fs.statSync(statusFile).mtimeMs; } catch {}
    const parsed = Date.parse(s.updated), meta = (p.meta || {})[name] || {};
    const icon = meta.emblem === 'custom' ? readEmblem(p, name) : {};
    const role = (fm.description || '').split('.')[0].slice(0, 60);
    const dash = v => (v && v !== '-' ? v : '');
    return { name, role, emblem: meta.emblem && meta.emblem !== 'custom' ? meta.emblem : EMBLEMS.includes(name) && !meta.emblem ? name : 'orb',
             emblemSvg: icon.svg || '', iconError: icon.error || '', iconPending: meta.emblem === 'custom' && !icon.svg,
             iconRequested: fs.existsSync(iconRequestFile(p, name)), type: meta.type || agentType(fm.tools),
             state: (s.state || 'idle').toLowerCase(), task: dash(s.task), step: dash(s.step),
             updated: mt || (isNaN(parsed) ? 0 : parsed), output: dash(s.output),
             editable: !!meta.goal,
             missions: missionFiles.filter(m => m.toLowerCase().startsWith(name + '-')).length,
             requests: requestFiles.filter(m => m.toLowerCase().startsWith(name + '-')).length,
             triggers: (p.triggers || []).filter(t => t.agent === name).map(t => ({ id: t.id, kind: t.kind, label: triggerLabel(t), task: t.task, enabled: t.enabled, last: t.last || 0, lastError: t.lastError || '' })) };
  });
  const rank = n => { const i = p.order.indexOf(n); return i < 0 ? 999 : i; };
  return agents.sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
}
function readOutputs(p, agentNames) {
  const list = [];
  for (const r of p.outputs) {
    for (const rel of walk(r.dir)) {
      const st = fs.statSync(path.join(r.dir, rel));
      let agent = null;
      if (r.agent === 'mission') { const m = rel.match(/^([a-z0-9-]+?)-/i); agent = m ? m[1].toLowerCase() : null; }
      else if (r.agent === 'folder') { const seg = rel.split('/')[0].toLowerCase(); agent = agentNames.includes(seg) ? seg : null; }
      else agent = r.agent;
      list.push({ id: `${p.id}:${r.key}/${rel}`, name: rel, kind: r.label, agent, mtime: st.mtimeMs, size: st.size });
    }
  }
  for (const f of p.files || []) {
    try {
      const st = fs.statSync(f.file);
      list.push({ id: `${p.id}:${f.key}/${path.basename(f.file)}`, name: path.basename(f.file), kind: f.label, agent: f.agent, mtime: st.mtimeMs, size: st.size });
    } catch {}
  }
  return list.sort((a, b) => b.mtime - a.mtime);
}
function resolveFile(id) {
  const c = id.indexOf(':');
  const p = getProject(id.slice(0, c));
  if (!p) return null;
  const rest = id.slice(c + 1), i = rest.indexOf('/');
  const key = rest.slice(0, i), rel = rest.slice(i + 1);
  const f = (p.files || []).find(x => x.key === key);
  if (f) return rel === path.basename(f.file) ? f.file : null;
  const r = p.outputs.find(x => x.key === key);
  if (!r) return null;
  const full = path.resolve(r.dir, rel);
  return full.startsWith(path.resolve(r.dir) + path.sep) ? full : null;
}
function gitLog(p, names, cb) {
  execFile('git', ['log', '--pretty=format:%h\t%an\t%at\t%s', '-20'], { cwd: p.repo || p.root, timeout: 4000 }, (err, out) => {
    if (err) return cb([]);
    cb(out.split('\n').filter(Boolean).map(l => {
      const [hash, author, at, subject] = l.split('\t');
      const m = subject.match(/^([A-Za-z-]+):/), tag = m && m[1].toLowerCase();
      return { hash, message: subject, agent: names.includes(tag) ? tag : author, time: Number(at) * 1000 };
    }));
  });
}

// ---------- creating ----------
const PRESETS = {
  Researcher: 'Read, Grep, Glob, Bash, Write, WebSearch, WebFetch',
  Reviewer: 'Read, Grep, Glob, Bash, Write',
  Builder: 'Read, Grep, Glob, Bash, Write, Edit',
  Operator: '', // no tools line: uses whatever the session has, including connected apps
};
// Connected apps the board can see: names only, read from the project's .mcp.json and the user's Claude settings.
// It never reads or returns commands, URLs or tokens, and it never writes these files.
function readConnectors(p) {
  const out = [], seen = new Set();
  const add = (name, source) => {
    if (!/^[\w .-]{1,60}$/.test(name) || seen.has(name)) return;
    seen.add(name);
    out.push({ name, tool: 'mcp__' + name.replace(/[^A-Za-z0-9_-]/g, '_'), source });
  };
  const read = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
  const proj = read(path.join(p.root, '.mcp.json'));
  Object.keys((proj && proj.mcpServers) || {}).forEach(n => add(n, 'this project'));
  const user = read(path.join(os.homedir(), '.claude.json'));
  if (user) {
    const key = [p.root, p.root.replace(/\\/g, '/')].find(k => (user.projects || {})[k]);
    Object.keys((key && user.projects[key].mcpServers) || {}).forEach(n => add(n, 'this project'));
    Object.keys(user.mcpServers || {}).forEach(n => add(n, 'your Claude settings'));
  }
  return out;
}
const OPERATOR_BASE = 'Read, Grep, Glob, Write, Edit, Bash, WebSearch, WebFetch';
const isGit = p => fs.existsSync(path.join(p.repo || p.root, '.git'));
const RESERVED = ['claude', 'explore', 'plan', 'general-purpose', 'statusline-setup', 'claude-code-guide'];
const clean = (s, max) => String(s == null ? '' : s).replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);

// ---------- custom emblems ----------
// An agent draws its own emblem (agent-emblems/<name>.svg) following the request the board writes next to it.
// The file is untrusted text, so it is parsed against a whitelist and rebuilt from validated pieces before it reaches the page.
const ICON_SPEC_FILE = path.join(__dirname, 'icon-spec.md');
const emblemsDir = p => path.join(p.root, 'agent-emblems');
const ICON_CLASSES = new Set(['ln', 'faint', 'fill', 'frame', 'wedge', 'a', 'o', 'c', 'draw', 'k-spin', 'k-pulse', 'k-bob', 'k-wave', 'k-ping', 'k-draw', 'k-flash']);
const ICON_TAGS = new Set(['g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon']);
const isNum = v => /^-?\d*\.?\d+$/.test(v);
const ICON_ATTRS = {
  d: v => v.length < 1500 && /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s-]+$/.test(v),
  points: v => v.length < 800 && /^[0-9.,\s-]+$/.test(v),
  fill: v => v === 'none' || v === 'currentColor',
  stroke: v => v === 'none' || v === 'currentColor',
  'stroke-linecap': v => ['round', 'butt', 'square'].includes(v),
  'stroke-linejoin': v => ['round', 'miter', 'bevel'].includes(v),
  'stroke-dasharray': v => /^[0-9.\s,]+$/.test(v),
  transform: v => /^(?:(?:translate|rotate|scale)\([-\d.,\s]+\)\s*)+$/.test(v),
  class: v => v.trim().split(/\s+/).every(c => ICON_CLASSES.has(c)),
  style: v => /^(?:\s*--(?:dl|dur)\s*:\s*\d*\.?\d+s\s*;?)+\s*$/.test(v),
};
for (const n of ['cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'width', 'height', 'x1', 'y1', 'x2', 'y2', 'stroke-width', 'opacity', 'fill-opacity', 'stroke-opacity', 'pathLength']) ICON_ATTRS[n] = isNum;

function sanitizeEmblem(text) {
  text = String(text || '').trim();
  if (!text) return { error: 'the icon file is empty' };
  if (text.length > 8000) return { error: 'the icon file is larger than 8 KB' };
  if (/<[!?]/.test(text)) return { error: 'comments and doctype lines are not allowed' };
  const tagRe = /<(\/?)([A-Za-z][\w-]*)([^<>]*?)(\/?)>/g;
  let m, last = 0, out = '', count = 0, rooted = false, done = false;
  const stack = [];
  while ((m = tagRe.exec(text))) {
    if (text.slice(last, m.index).trim()) return { error: 'text inside the icon is not allowed' };
    last = tagRe.lastIndex;
    const close = m[1] === '/', tag = m[2].toLowerCase(), attrText = m[3], selfClose = m[4] === '/';
    if (done) return { error: 'content after the closing svg tag' };
    if (close) {
      if (attrText.trim() || !stack.length || stack.pop() !== tag) return { error: 'mismatched tags' };
      if (tag === 'svg') done = true; else out += `</${tag}>`;
      continue;
    }
    if (!rooted) {
      if (tag !== 'svg' || selfClose) return { error: 'the icon must be one <svg> element' };
      const vb = /viewBox\s*=\s*"([^"]*)"/.exec(attrText);
      if (!vb || vb[1].trim().split(/[\s,]+/).join(' ') !== '0 0 64 64') return { error: 'the icon must use viewBox="0 0 64 64"' };
      rooted = true; stack.push('svg');
      continue;
    }
    if (!ICON_TAGS.has(tag)) return { error: `<${tag}> is not allowed` };
    if (++count > 80) return { error: 'more than 80 shapes' };
    if (stack.length > 4) return { error: 'groups nested too deeply' };
    const attrRe = /\s+([A-Za-z][\w:-]*)\s*=\s*"([^"]*)"/y;
    let pos = 0, attrs = '';
    while (pos < attrText.length && attrText.slice(pos).trim()) {
      attrRe.lastIndex = pos;
      const a = attrRe.exec(attrText);
      if (!a) return { error: 'a malformed attribute' };
      const check = ICON_ATTRS[a[1]];
      if (!check || !check(a[2])) return { error: `attribute ${a[1]} is not allowed or has a bad value` };
      attrs += ` ${a[1]}="${a[2]}"`;
      pos = attrRe.lastIndex;
    }
    out += `<${tag}${attrs}${selfClose ? '/' : ''}>`;
    if (!selfClose) stack.push(tag);
  }
  if (text.slice(last).trim()) return { error: 'text inside the icon is not allowed' };
  if (!rooted || !done || stack.length) return { error: 'the svg element is not closed' };
  return { svg: out };
}

function readEmblem(p, name) {
  let raw;
  try { raw = fs.readFileSync(path.join(emblemsDir(p), `${name}.svg`), 'utf8'); } catch { return {}; }
  return sanitizeEmblem(raw);
}
const iconRequestFile = (p, name) => path.join(emblemsDir(p), `${name}.request.md`);

function writeIconRequest(p, name, role, goal, brief) {
  let tpl;
  try { tpl = fs.readFileSync(ICON_SPEC_FILE, 'utf8'); } catch { return { error: 'icon-spec.md is missing next to the server.' }; }
  const win = path.win32;
  const text = fill(tpl, {
    name, role, goal,
    brief: brief || '(none: choose a fitting visual metaphor from the role and goal)',
    svgFile: win.join(p.root, 'agent-emblems', `${name}.svg`),
    doneDir: win.join(p.root, 'agent-emblems', 'done'),
    requestFile: win.join(p.root, 'agent-emblems', `${name}.request.md`),
  });
  try {
    fs.mkdirSync(emblemsDir(p), { recursive: true });
    fs.writeFileSync(iconRequestFile(p, name), text);
  } catch (e) { return { error: `Could not write the icon request: ${e.code || e.message}` }; }
  watch(emblemsDir(p));
  return { ok: true };
}

// Ask Claude for a (new) icon. The old one stays until a new file replaces it.
function redrawIcon(b) {
  const p = getProject(clean(b.project, 60));
  if (!p) return { error: 'Pick a project first.' };
  const name = clean(b.name, 40);
  const defPath = path.join(agentsDir(p), `${name}.md`);
  if (!validName(name) || !fs.existsSync(defPath)) return { error: `There is no agent named "${name}" in ${p.name}.` };
  const fm = parseFrontmatter(fs.readFileSync(defPath, 'utf8'));
  const m = (p.meta || {})[name] || {};
  const role = m.role || (fm.description || '').split('.')[0] || name;
  const r = writeIconRequest(p, name, role, m.goal || fm.description || role, clean(b.brief, 500));
  if (r.error) return r;
  p.meta = p.meta || {};
  p.meta[name] = { ...m, emblem: 'custom' };
  saveProjects(); broadcast();
  return { ok: true, command: '/board:icons' };
}

// Every new agent starts from agent-template.md. Only its goal, its way of working and a few optional extras change.
const TEMPLATE_FILE = path.join(__dirname, 'agent-template.md');
const fill = (tpl, vars) => tpl.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? vars[k] : m));

function agentFields(b, name) {
  const goal = String(b.goal || b.description || '').trim().slice(0, 1000);
  if (goal.length < 3) return { error: 'Describe its goal in a sentence.' };
  if (!Object.prototype.hasOwnProperty.call(PRESETS, b.type)) return { error: 'Pick what the agent may do.' };
  const toolsCustom = clean(b.tools, 400);
  if (toolsCustom && !/^[A-Za-z0-9_*:(),. -]+$/.test(toolsCustom)) return { error: 'Tools can only contain letters, numbers, commas and names like mcp__shop.' };
  const onlyConnectors = toolsCustom && toolsCustom.split(',').every(t => !t.trim() || t.trim().startsWith('mcp__'));
  const tools = onlyConnectors ? (PRESETS[b.type] || OPERATOR_BASE) + ', ' + toolsCustom : toolsCustom || PRESETS[b.type];
  const custom = b.custom === true;
  const prompt = custom ? String(b.prompt || '').trim().slice(0, 20000) : '';
  if (custom && prompt.length < 10) return { error: 'Write the prompt, or switch off "Write the whole prompt myself".' };
  return {
    goal, tools, toolsCustom, type: b.type, custom, prompt,
    how: String(b.how || '').trim().slice(0, 6000),
    extra: String(b.extra || '').trim().slice(0, 4000),
    role: clean(b.role, 80) || clean(goal, 60).replace(/[.\s]+$/, ''),
    when: clean(b.when, 300) || clean(goal, 200),
    scope: clean(b.scope, 200) || `docs/${name}/ and agent-missions/`,
    emblem: 'custom',
  };
}

function agentFiles(p, name, f) {
  const NAME = name.toUpperCase();
  const root = p.root, win = path.win32;
  const promptPath = win.join(root, 'agent-prompts', `${name}.md`);
  const statusPath = win.join(root, 'agent-status', `${name}.md`);
  const defPath = path.join(agentsDir(p), `${name}.md`);
  const requestPath = win.join(root, 'agent-emblems', `${name}.request.md`);
  const git = isGit(p);
  const gitRule = git ? `Prefix commit messages with "${NAME}:" and commit only your own files by explicit path. Never push; the user decides when to push.` : 'This folder is not a git repository: keep your work in files, never overwrite another agent\'s files, and never delete anything unless asked.';
  const gitLine = git ? 'When committing, stage and commit only your own files by explicit path, never `git add -A`. Never push.' : 'This folder is not a git repository, so keep your work in files and never overwrite another agent\'s files.';
  let prompt;
  if (f.custom) prompt = f.prompt + '\n';
  else {
    let tpl;
    try { tpl = fs.readFileSync(TEMPLATE_FILE, 'utf8'); } catch { return { error: 'agent-template.md is missing next to the server.' }; }
    prompt = fill(tpl, {
      NAME, role: f.role, project: p.name, root, goal: f.goal,
      how: f.how || 'Use your judgment. Keep changes small and tell the user what you did.',
      extra: f.extra ? `\n## Extra rules\n${f.extra}\n` : '',
      gitRule, scope: f.scope, missions: win.join(root, 'agent-missions'), name,
    });
  }
  const def = `---
name: ${name}
description: ${JSON.stringify(f.when.startsWith(f.role) ? f.when : `${f.role}. ${f.when}`)}
${f.tools ? `tools: ${f.tools}\n` : ''}---

You are ${NAME} (${f.role}) for the ${p.name} project, launched as a subagent by the orchestrator session.

1. Read \`${promptPath}\` in full. It is your standing job description and the source of truth for your role and rules. Follow it exactly.
2. The orchestrator's message is your topic. Act on it immediately; do not re-ask what your role is.
3. **Status file is mandatory, and it is your FIRST and LAST action.** Your status file is \`${statusPath}\`. The board reads it; if you skip it you show as idle while working. Overwrite the whole file (never append, never touch another agent's file) with exactly these five lines:
   \`\`\`
   state: running
   task: <one line: what the mission is>
   step: <what you are doing right now>
   updated: <ISO timestamp>
   output: <file path or commit hash, or - until known>
   \`\`\`
   - Before reading anything else, write it with \`state: running\`.
   - Rewrite it at each milestone.
   - If you stop for any reason, set \`state: blocked\` or \`state: failed\` with the reason in \`step\`.
   - Your last tool call before the final report must set \`state: done\` with \`output\` set. Do not report finished until this write is done.
4. Other agents may run in parallel in the same checkout. Your write scope is ${f.scope}. ${gitLine}
5. **Your emblem:** if \`${requestPath}\` exists, you have not drawn your own icon yet. Before your main task, read that file and follow it. It is a short one-time drawing job, and it is the only time you may write outside your scope.
6. Finish with a short report: what you did and how, what is unverified, and any mission file you wrote for another agent.
`;
  return { prompt, def, promptPath, statusPath, defPath };
}

const metaOf = f => ({ emblem: f.emblem, type: f.type, tools: f.toolsCustom, goal: f.goal, how: f.how, extra: f.extra, role: f.role, when: f.when, scope: f.scope, custom: f.custom, prompt: f.prompt });
const validName = n => /^[a-z][a-z0-9-]{1,29}$/.test(n);

function createAgent(b) {
  const p = getProject(clean(b.project, 60));
  if (!p) return { error: 'Pick a project first.' };
  const name = clean(b.name, 40);
  if (!validName(name)) return { error: 'Name must be 2 to 30 characters: lowercase letters, numbers and dashes, starting with a letter.' };
  if (RESERVED.includes(name)) return { error: `"${name}" is a built-in Claude Code agent name. Pick another.` };
  const f = agentFields(b, name);
  if (f.error) return f;
  const files = agentFiles(p, name, f);
  if (files.error) return files;
  if (fs.existsSync(files.defPath)) return { error: `An agent named "${name}" already exists in ${p.name}.` };
  try {
    fs.mkdirSync(agentsDir(p), { recursive: true });
    fs.mkdirSync(promptsDir(p), { recursive: true });
    fs.mkdirSync(statusDir(p), { recursive: true });
    fs.writeFileSync(files.promptPath, files.prompt, { flag: 'wx' });
    fs.writeFileSync(files.defPath, files.def, { flag: 'wx' });
    fs.writeFileSync(files.statusPath, 'state: idle\ntask: -\nstep: -\nupdated: -\noutput: -\n', { flag: 'wx' });
    p.meta = p.meta || {}; p.meta[name] = metaOf(f); saveProjects();
  } catch (e) { return { error: `Could not write the agent files: ${e.code || e.message}` }; }
  writeIconRequest(p, name, f.role, f.goal, clean(b.iconBrief, 500));
  return { ok: true, name, project: p.id, root: p.root, files: [files.defPath, files.promptPath, files.statusPath] };
}

// Only agents created from the board can be edited: their form values are stored, so nothing hand-written is overwritten.
function editableAgent(b) {
  const p = getProject(clean(b.project, 60));
  if (!p) return { error: 'Pick a project first.' };
  const name = clean(b.name, 40);
  if (!validName(name) || !fs.existsSync(path.join(agentsDir(p), `${name}.md`))) return { error: `There is no agent named "${name}" in ${p.name}.` };
  const m = (p.meta || {})[name];
  if (!m || !m.goal) return { error: `"${name}" was written by hand, so the board will not overwrite it. Edit .claude/agents/${name}.md instead.` };
  return { p, name, m };
}

function getAgentForm(b) {
  const r = editableAgent(b);
  if (r.error) return r;
  return { ok: true, name: r.name, ...r.m };
}

function updateAgent(b) {
  const r = editableAgent(b);
  if (r.error) return r;
  const f = agentFields(b, r.name);
  if (f.error) return f;
  f.emblem = r.m.emblem || 'custom'; // editing never changes the icon; use Redraw icon for that
  const files = agentFiles(r.p, r.name, f);
  if (files.error) return files;
  try {
    fs.writeFileSync(files.promptPath, files.prompt);
    fs.writeFileSync(files.defPath, files.def);
    r.p.meta[r.name] = metaOf(f); saveProjects();
  } catch (e) { return { error: `Could not write the agent files: ${e.code || e.message}` }; }
  return { ok: true, name: r.name };
}

// Remove moves the agent's files into <project>/agent-removed/<name>-<time>/ so nothing is lost. Outputs and commits stay.
function removeAgent(b) {
  const p = getProject(clean(b.project, 60));
  if (!p) return { error: 'Pick a project first.' };
  const name = clean(b.name, 40);
  if (!validName(name)) return { error: 'Bad agent name.' };
  const defPath = path.join(agentsDir(p), `${name}.md`);
  if (!fs.existsSync(defPath)) return { error: `There is no agent named "${name}" in ${p.name}.` };
  const a = readAgents(p).find(x => x.name === name);
  if (a && a.state === 'running' && Date.now() - a.updated < 15 * 60 * 1000) return { error: `${name} is running. Wait for it to finish first.` };
  const dest = path.join(p.root, 'agent-removed', `${name}-${new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '')}`);
  try {
    fs.mkdirSync(dest, { recursive: true });
    for (const src of [defPath, path.join(promptsDir(p), `${name}.md`), path.join(statusDir(p), `${name}.md`), path.join(emblemsDir(p), `${name}.svg`), iconRequestFile(p, name)]) {
      if (fs.existsSync(src)) fs.renameSync(src, path.join(dest, path.basename(path.dirname(src)) + '-' + path.basename(src)));
    }
    if (p.meta) delete p.meta[name];
    p.triggers = (p.triggers || []).filter(t => t.agent !== name && t.after !== name);
    p.order = (p.order || []).filter(n => n !== name);
    saveProjects();
  } catch (e) { return { error: `Could not remove the agent: ${e.code || e.message}` }; }
  broadcast();
  return { ok: true, name, movedTo: dest };
}

// A run request is just a file in <project>/agent-requests/. The server never starts anything:
// the board plugin in Claude Code reads the queue and runs the agent inside the user's own session.
function createRequest(b) {
  const p = getProject(clean(b.project, 60));
  if (!p) return { error: 'Pick a project first.' };
  const agent = clean(b.agent, 40);
  if (!readAgents(p).some(a => a.name === agent)) return { error: `There is no agent named "${agent}" in ${p.name}.` };
  const task = String(b.task || '').trim().slice(0, 2000);
  if (task.length < 3) return { error: 'Write a task first. One sentence is enough.' };
  const dir = requestsDir(p);
  let pending = 0;
  try { pending = fs.readdirSync(dir).filter(f => f.startsWith(agent + '-') && f.endsWith('.md')).length; } catch {}
  if (pending >= 10) return { error: `${agent} already has ${pending} requests waiting. Run /board:run in Claude Code first.` };
  const source = clean(b.source, 60).toLowerCase().replace(/[^a-z0-9:-]/g, '');
  if (source) {
    // a trigger must not pile up identical requests while nobody has picked the last one up
    try {
      for (const f of fs.readdirSync(dir).filter(f => f.startsWith(agent + '-') && f.endsWith('.md'))) {
        const old = fs.readFileSync(path.join(dir, f), 'utf8');
        if (old.includes('source: ' + source + '\n') && old.endsWith('---\n' + task + '\n')) return { error: 'That request is already queued.' };
      }
    } catch {}
  }
  const now = new Date();
  const file = path.join(dir, `${agent}-${now.toISOString().replace(/[-:]/g, '').replace(/\..*/, '')}-${Math.random().toString(36).slice(2, 6)}.md`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    const text = ['agent: ' + agent, 'requested: ' + now.toISOString(), ...(source ? ['source: ' + source] : []), 'status: pending', '---', task, ''].join('\n');
    fs.writeFileSync(file, text, { flag: 'wx' });
  } catch (e) { return { error: `Could not queue the request: ${e.code || e.message}` }; }
  watch(dir); broadcast();
  return { ok: true, queued: path.basename(file), command: `/board:run ${agent}` };
}

// ---------- triggers ----------
// A trigger watches for something and, when it happens, queues a run request for its agent (the same file the Run box writes).
// Nothing starts by itself: a Claude Code session that is running /board:watch (or you, with /board:run) starts the agent.
const TRIGGER_KINDS = ['every', 'daily', 'commit', 'file', 'after'];
const TRIGGER_LIMIT = 20;
const triggerSource = t => (t.kind === 'after' ? `after:${t.after}` : t.kind === 'every' || t.kind === 'daily' ? 'schedule' : t.kind);
function triggerLabel(t) {
  switch (t.kind) {
    case 'every': return t.every % 60 === 0 ? `Every ${t.every / 60} h` : `Every ${t.every} min`;
    case 'daily': return `Every day at ${t.at}`;
    case 'commit': return 'When a new commit lands';
    case 'file': return `When a new file appears in ${t.dir}${t.ext ? ` (${t.ext})` : ''}`;
    case 'after': return `After ${t.after} finishes`;
  }
  return t.kind;
}

function addTrigger(b) {
  const p = getProject(clean(b.project, 60));
  if (!p) return { error: 'Pick a project first.' };
  const agent = clean(b.agent, 40);
  const names = readAgents(p).map(a => a.name);
  if (!names.includes(agent)) return { error: `There is no agent named "${agent}" in ${p.name}.` };
  const kind = clean(b.kind, 20);
  if (!TRIGGER_KINDS.includes(kind)) return { error: 'Pick when it should start.' };
  const task = String(b.task || '').trim().slice(0, 2000);
  if (task.length < 3) return { error: 'Say what the agent should do when this happens.' };
  if ((p.triggers || []).length >= TRIGGER_LIMIT) return { error: `A project can have ${TRIGGER_LIMIT} triggers. Remove one first.` };
  const t = { id: Math.random().toString(36).slice(2, 10), agent, kind, task, enabled: true, created: Date.now(), last: 0, base: null };
  if (kind === 'every') {
    t.every = Math.round(Number(b.every));
    if (!(t.every >= 5 && t.every <= 10080)) return { error: 'Repeat every 5 minutes up to 7 days (10080 minutes).' };
  } else if (kind === 'daily') {
    const m = /^(\d{1,2}):(\d{2})$/.exec(clean(b.at, 10));
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return { error: 'Give a time like 09:30.' };
    t.at = `${m[1].padStart(2, '0')}:${m[2]}`;
  } else if (kind === 'file') {
    const dir = clean(b.dir, 200).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (!dir || dir.split('/').includes('..') || /^[A-Za-z]:/.test(dir)) return { error: 'Give a folder inside the project, like inbox or docs/orders.' };
    const full = path.resolve(p.root, dir);
    if (full !== path.resolve(p.root) && !full.startsWith(path.resolve(p.root) + path.sep)) return { error: 'That folder is outside the project.' };
    const ext = clean(b.ext, 40).toLowerCase().replace(/[^a-z0-9,]/g, '');
    t.dir = dir; t.ext = ext;
  } else if (kind === 'after') {
    const after = clean(b.after, 40);
    if (!names.includes(after)) return { error: 'Pick the agent to wait for.' };
    if (after === agent) return { error: 'An agent cannot wait for itself.' };
    t.after = after;
  }
  p.triggers = [...(p.triggers || []), t];
  saveProjects(); broadcast();
  return { ok: true, id: t.id };
}
function findTrigger(b) {
  const p = getProject(clean(b.project, 60));
  const t = p && (p.triggers || []).find(x => x.id === clean(b.id, 20));
  return t ? { p, t } : null;
}
function removeTrigger(b) {
  const r = findTrigger(b);
  if (!r) return { error: 'That trigger no longer exists.' };
  r.p.triggers = r.p.triggers.filter(x => x !== r.t);
  saveProjects(); broadcast();
  return { ok: true };
}
function toggleTrigger(b) {
  const r = findTrigger(b);
  if (!r) return { error: 'That trigger no longer exists.' };
  r.t.enabled = b.enabled !== false;
  if (r.t.enabled) { r.t.base = null; r.t.created = Date.now(); r.t.last = 0; } // start fresh, do not replay what happened while it was off
  saveProjects(); broadcast();
  return { ok: true };
}

function headSha(p) {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: p.repo || p.root, timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
  catch { return ''; }
}
function newestMtime(dir, exts) {
  let best = 0, seen = 0;
  const visit = (d, depth) => {
    let list = [];
    try { list = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      if (++seen > 2000) return;
      const full = path.join(d, e.name);
      if (e.isDirectory()) { if (depth < 3 && !e.name.startsWith('.')) visit(full, depth + 1); continue; }
      if (exts.length && !exts.includes(path.extname(e.name).slice(1).toLowerCase())) continue;
      try { best = Math.max(best, fs.statSync(full).mtimeMs); } catch {}
    }
  };
  visit(dir, 0);
  return best;
}

const lastStates = {};
function evalTriggers() {
  const now = Date.now();
  for (const p of projects) {
    if (!(p.triggers || []).length) continue;
    const agents = readAgents(p);
    const cur = Object.fromEntries(agents.map(a => [a.name, a.state]));
    const prev = lastStates[p.id];
    lastStates[p.id] = cur;
    let dirty = false;
    for (const t of p.triggers) {
      if (!t.enabled || !cur[t.agent]) continue;
      let fire = false;
      if (t.kind === 'every') fire = now - (t.last || t.created) >= t.every * 60000;
      else if (t.kind === 'daily') {
        const [h, m] = t.at.split(':').map(Number), slot = new Date(); slot.setHours(h, m, 0, 0);
        fire = now >= slot.getTime() && Math.max(t.last || 0, t.created) < slot.getTime();
      } else if (t.kind === 'commit') {
        const sha = headSha(p);
        if (t.base === null) { t.base = sha; dirty = true; }
        else if (sha && sha !== t.base) { t.base = sha; fire = true; dirty = true; }
      } else if (t.kind === 'file') {
        const newest = newestMtime(path.resolve(p.root, t.dir), t.ext ? t.ext.split(',').filter(Boolean) : []);
        if (t.base === null) { t.base = newest; dirty = true; }
        else if (newest > t.base) { t.base = newest; fire = true; dirty = true; }
      } else if (t.kind === 'after') fire = !!prev && prev[t.after] === 'running' && cur[t.after] === 'done';
      if (!fire) continue;
      const r = createRequest({ project: p.id, agent: t.agent, task: t.task, source: triggerSource(t) });
      t.last = now; t.lastError = r.error || ''; dirty = true;
    }
    if (dirty) { saveProjects(); broadcast(); }
  }
}
setInterval(evalTriggers, Number(process.env.BOARD_TICK_MS) || 20000);
setTimeout(evalTriggers, 1500); // sets the baselines right after start

// ---------- flow (who handed what to whom) ----------
// Built from files only: missions agents leave each other, run requests (typed in the board or queued by triggers), and agent states.
const HOUR = 3600 * 1000;
function readHead(file) {
  try { return fs.readFileSync(file, 'utf8').slice(0, 3000); } catch { return ''; }
}
function buildFlow(p) {
  const agents = readAgents(p);
  const byName = Object.fromEntries(agents.map(a => [a.name, a]));
  const now = Date.now();
  const edges = [];
  const statusFor = (to, at) => {
    const a = byName[to];
    if (!a) return { status: 'waiting', note: '' };
    const handled = a.updated >= at;
    if (handled && a.state === 'running') return { status: 'running', note: `${to} is working on it` };
    if (handled && a.state === 'done') return { status: 'done', note: '' };
    if (handled && (a.state === 'blocked' || a.state === 'failed')) return { status: 'stuck', note: `${to} is ${a.state === 'blocked' ? 'waiting on you' : 'failed'}${a.step ? `: ${a.step}` : ''}` };
    if (now - at > HOUR) return { status: 'stuck', note: `${to} has not picked this up in ${Math.round((now - at) / HOUR)} h` };
    return { status: 'waiting', note: '' };
  };
  const addEdge = (id, from, to, kind, what, at, st) => edges.push({ id, from, to, kind, what: String(what).slice(0, 140), at, ...st });

  const missionRoot = p.outputs.find(o => o.key === 'missions');
  if (missionRoot) {
    for (const rel of walk(missionRoot.dir)) {
      if (/^(done|archive)\//i.test(rel) || /\/(done|archive)\//i.test(rel)) continue;
      const base = rel.split('/').pop();
      const to = agents.map(a => a.name).filter(n => base.toLowerCase().startsWith(n + '-')).sort((a, b) => b.length - a.length)[0];
      if (!to) continue;
      const full = path.join(missionRoot.dir, rel), head = readHead(full);
      let at = 0; try { at = fs.statSync(full).mtimeMs; } catch { continue; }
      const from = ((/^\s*from\s*:\s*([A-Za-z0-9-]+)/im.exec(head.split('\n').slice(0, 6).join('\n')) || [])[1] || 'you').toLowerCase();
      const title = (/^#\s+(.+)$/m.exec(head) || [])[1] || base.replace(/\.[a-z]+$/i, '').slice(to.length + 1).replace(/-/g, ' ');
      addEdge('m:' + rel, from, to, 'mission', title, at, statusFor(to, at));
    }
  }
  for (const [dir, done] of [[requestsDir(p), false], [path.join(requestsDir(p), 'done'), true]]) {
    let files = []; try { files = fs.readdirSync(dir).filter(f => f.endsWith('.md')); } catch {}
    for (const f of files) {
      const full = path.join(dir, f), head = readHead(full);
      let at = 0; try { at = fs.statSync(full).mtimeMs; } catch { continue; }
      if (done && now - at > 24 * HOUR) continue;
      const to = ((/^agent:\s*(\S+)/m.exec(head) || [])[1] || '').toLowerCase();
      if (!to) continue;
      const src = ((/^source:\s*(\S+)/m.exec(head) || [])[1] || 'you').toLowerCase();
      const from = src.startsWith('after:') ? src.slice(6) : src;
      const task = head.split(/^---\s*$/m)[1] || '';
      const requested = Date.parse((/^requested:\s*(\S+)/m.exec(head) || [])[1]) || at;
      const st = done ? statusFor(to, requested) : (now - requested > HOUR / 2 ? { status: 'stuck', note: `Queued ${Math.round((now - requested) / 60000)} min ago. Run /board:run in Claude Code.` } : { status: 'waiting', note: 'Queued. Waiting for Claude Code.' });
      if (done && st.status === 'waiting') st.status = 'done'; // it was started when it moved to done/
      addEdge('r:' + f, from, to, 'request', task.trim().split('\n')[0] || 'Run request', requested, st);
    }
  }
  edges.sort((a, b) => b.at - a.at);
  edges.length = Math.min(edges.length, 40);
  const actors = [...new Set(edges.map(e => e.from).filter(n => !byName[n]))];
  return {
    agents: agents.map(a => ({ name: a.name, state: a.state, emblem: a.emblem, emblemSvg: a.emblemSvg, step: a.step })),
    actors, edges,
    triggers: (p.triggers || []).map(t => ({ id: t.id, agent: t.agent, label: triggerLabel(t), enabled: t.enabled })),
  };
}

function createProject(b) {
  const name = clean(b.name, 40), root = clean(b.root, 400);
  if (name.length < 2) return { error: 'Give the project a name.' };
  if (!path.win32.isAbsolute(root) && !path.isAbsolute(root)) return { error: 'Folder must be a full path, like C:\\Users\\you\\Projects\\my-app.' };
  let st; try { st = fs.statSync(root); } catch { return { error: 'That folder does not exist.' }; }
  if (!st.isDirectory()) return { error: 'That path is a file, not a folder.' };
  const id = slug(name) || 'project';
  if (getProject(id) || projects.some(p => path.resolve(p.root) === path.resolve(root))) return { error: 'That project or folder is already on the board.' };
  const p = genericProject(id, name, path.resolve(root));
  try { fs.mkdirSync(agentsDir(p), { recursive: true }); fs.mkdirSync(statusDir(p), { recursive: true }); }
  catch (e) { return { error: `Could not prepare the folder: ${e.code || e.message}` }; }
  projects.push(p); saveProjects(); watchProject(p);
  return { ok: true, id: p.id, project: { id: p.id, name: p.name, root: p.root } };
}

// ---------- live updates ----------
const clients = new Set();
let timer = null;
function broadcast() {
  clearTimeout(timer);
  timer = setTimeout(() => { for (const c of clients) c.write('data: change\n\n'); }, 150);
}
const watched = new Set();
function watch(dir, recursive = true) {
  if (watched.has(dir)) return;
  try { fs.watch(dir, { recursive }, () => broadcast()); watched.add(dir); } catch {}
}
function watchProject(p) {
  [statusDir(p), agentsDir(p), requestsDir(p), emblemsDir(p), ...p.outputs.map(o => o.dir)].forEach(d => watch(d));
  (p.files || []).forEach(f => watch(path.dirname(f.file), false));
  watch(p.root, false); // catches output folders being created later
}
projects.forEach(watchProject);

// ---------- http ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
function json(res, data, code = 200) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}
function readBody(req, cb) {
  let size = 0; const chunks = [];
  req.on('data', c => { size += c.length; if (size > 65536) req.destroy(); else chunks.push(c); });
  req.on('end', () => { try { cb(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { cb(null); } });
}
// Only this machine's own page may talk to the API: blocks DNS-rebinding and cross-site POSTs.
function hostOk(req) { return [`localhost:${PORT}`, `127.0.0.1:${PORT}`].includes(req.headers.host); }
function originOk(req) {
  const o = req.headers.origin;
  return req.headers['x-board'] === '1' && (!o || o === `http://${req.headers.host}`);
}

http.createServer((req, res) => {
  if (!hostOk(req)) { res.writeHead(403); return res.end('forbidden'); }
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'POST') {
    if (!originOk(req)) return json(res, { error: 'Request blocked.' }, 403);
    return readBody(req, body => {
      if (!body) return json(res, { error: 'Bad request.' }, 400);
      const act = { '/api/agents': createAgent, '/api/agents/update': updateAgent, '/api/agents/remove': removeAgent, '/api/agents/icon': redrawIcon, '/api/triggers': addTrigger, '/api/triggers/remove': removeTrigger, '/api/triggers/toggle': toggleTrigger }[url.pathname];
      if (act) { const r = act(body); return json(res, r, r.error ? 400 : 200); }
      if (url.pathname === '/api/projects') { const r = createProject(body); return json(res, r, r.error ? 400 : 200); }
      if (url.pathname === '/api/requests') { const r = createRequest(body); return json(res, r, r.error ? 400 : 200); }
      json(res, { error: 'Not found.' }, 404);
    });
  }

  if (url.pathname === '/api/connectors') {
    const p = getProject(url.searchParams.get('project') || '');
    return p ? json(res, { servers: readConnectors(p) }) : json(res, { error: 'No such project.' }, 404);
  }
  if (url.pathname === '/api/flow') {
    const p = getProject(url.searchParams.get('project') || '');
    return p ? json(res, buildFlow(p)) : json(res, { error: 'No such project.' }, 404);
  }
  if (url.pathname === '/api/agent') {
    const r = getAgentForm({ project: url.searchParams.get('project') || '', name: url.searchParams.get('name') || '' });
    return json(res, r, r.error ? 404 : 200);
  }
  if (url.pathname === '/api/projects') return json(res, projects.map(p => ({ id: p.id, name: p.name, root: p.root })));
  if (url.pathname === '/api/state') {
    const p = getProject(url.searchParams.get('project') || '') || projects[0];
    if (!p) return json(res, { error: 'No projects yet.' }, 404);
    const agents = readAgents(p);
    const names = agents.map(a => a.name);
    return gitLog(p, names, commits => json(res, { project: { id: p.id, name: p.name, root: p.root }, git: isGit(p), agents, docs: readOutputs(p, names), commits }));
  }
  if (url.pathname === '/api/file') {
    const full = resolveFile(url.searchParams.get('id') || '');
    if (!full) return json(res, { error: 'not found' }, 404);
    try {
      const id = url.searchParams.get('id'), p = getProject(id.slice(0, id.indexOf(':')));
      const meta = readOutputs(p, readAgents(p).map(a => a.name)).find(o => o.id === id) || {};
      const raw = fs.readFileSync(full, 'utf8'), cap = 400000;
      return json(res, { id, name: meta.name || path.basename(full), kind: meta.kind || 'Docs', agent: meta.agent || null, mtime: fs.statSync(full).mtimeMs, text: raw.slice(0, cap), truncated: raw.length > cap });
    }
    catch { return json(res, { error: 'not found' }, 404); }
  }
  if (url.pathname === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write('retry: 2000\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  const file = path.join(PUBLIC, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname).replace(/^([/\\])+/, ''));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(buf);
  });
}).listen(PORT, '127.0.0.1', () => console.log(`Agent Board on http://localhost:${PORT}`));
