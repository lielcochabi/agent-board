// Agent Board: zero-dependency local server.
// Reads agent status files and agent output docs from disk for any registered project, streams change events to the browser,
// and creates new agents / registers new projects (files only, nothing is executed).
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const PORT = Number(process.env.PORT) || 4747;
const PUBLIC = path.join(__dirname, 'public');
const PROJECTS_FILE = path.join(__dirname, 'projects.json');

// ---------- projects ----------
const JARVIS_ROOT = process.env.JARVIS_PROJECT || 'C:/Users/lielc/Desktop/personalAi-testing';
const JARVIS_REPO = process.env.JARVIS_REPO || path.join(JARVIS_ROOT, 'jarvis-client');
const JARVIS_TODO = process.env.JARVIS_TODO || 'C:/Users/lielc/Desktop/JARVIS-TODO.md';

function defaultProjects() {
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
    files: [{ key: 'todo', label: 'TODO', file: JARVIS_TODO, agent: 'scribe' }],
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
    else if (/\.(md|txt)$/i.test(e.name)) files.push(rel);
  }
  return files;
}
const EMBLEMS = ['scout', 'compass', 'forge', 'echo', 'sentry', 'warden', 'herald', 'scribe', 'custodian', 'orb'];
const agentType = tools => /\bEdit\b/.test(tools || '') ? 'Builder' : /WebSearch|WebFetch/.test(tools || '') ? 'Researcher' : 'Reviewer';
function readAgents(p) {
  let names = [];
  try { names = fs.readdirSync(agentsDir(p)).filter(f => f.endsWith('.md')); } catch {}
  const missionRoot = p.outputs.find(o => o.key === 'missions');
  const missionFiles = missionRoot ? walk(missionRoot.dir) : [];
  const agents = names.map(f => {
    const fm = parseFrontmatter(fs.readFileSync(path.join(agentsDir(p), f), 'utf8'));
    const name = fm.name || f.replace(/\.md$/, '');
    let s = {}, mt = 0;
    const statusFile = path.join(statusDir(p), `${name}.md`);
    try { s = parseStatus(fs.readFileSync(statusFile, 'utf8')); mt = fs.statSync(statusFile).mtimeMs; } catch {}
    const parsed = Date.parse(s.updated), meta = (p.meta || {})[name] || {};
    const role = (fm.description || '').split('.')[0].slice(0, 60);
    const dash = v => (v && v !== '-' ? v : '');
    return { name, role, emblem: meta.emblem || (EMBLEMS.includes(name) ? name : 'orb'), type: meta.type || agentType(fm.tools),
             state: (s.state || 'idle').toLowerCase(), task: dash(s.task), step: dash(s.step),
             updated: mt || (isNaN(parsed) ? 0 : parsed), output: dash(s.output),
             missions: missionFiles.filter(m => m.toLowerCase().startsWith(name + '-')).length };
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
};
const RESERVED = ['claude', 'explore', 'plan', 'general-purpose', 'statusline-setup', 'claude-code-guide'];
const clean = (s, max) => String(s == null ? '' : s).replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);

function createAgent(b) {
  const p = getProject(clean(b.project, 60));
  if (!p) return { error: 'Pick a project first.' };
  const name = clean(b.name, 40);
  if (!/^[a-z][a-z0-9-]{1,29}$/.test(name)) return { error: 'Name must be 2 to 30 characters: lowercase letters, numbers and dashes, starting with a letter.' };
  if (RESERVED.includes(name)) return { error: `"${name}" is a built-in Claude Code agent name. Pick another.` };
  const role = clean(b.role, 80);
  if (role.length < 2) return { error: 'Add a short role, for example "Test writer".' };
  const preset = PRESETS[b.type];
  if (!preset) return { error: 'Pick an agent type.' };
  const instructions = String(b.description || '').trim().slice(0, 8000);
  if (instructions.length < 10) return { error: 'Describe what this agent does in a sentence or two.' };
  const description = clean(b.when, 300) || clean(instructions, 200);
  const emblem = EMBLEMS.includes(b.emblem) ? b.emblem : 'orb';
  const scope = clean(b.scope, 200) || `docs/${name}/ and agent-missions/`;

  const NAME = name.toUpperCase();
  const root = p.root, win = path.win32;
  const promptPath = win.join(root, 'agent-prompts', `${name}.md`);
  const statusPath = win.join(root, 'agent-status', `${name}.md`);
  const defPath = path.join(agentsDir(p), `${name}.md`);
  if (fs.existsSync(defPath)) return { error: `An agent named "${name}" already exists in ${p.name}.` };

  const prompt = `# You are ${NAME}: ${role}, ${p.name} project

You are a dedicated agent on the ${p.name} project (folder: ${root}). This file is your standing job description. The user tells you WHAT to do each time; your role and rules are defined here.

## Your job
${instructions}

## Orientation (every session)
- Working directory: ${root}. Read CLAUDE.md or README.md there first if they exist.
- Check ${win.join(root, 'agent-missions')} for files named ${name}-*.md. Treat them as priority work.

## Hard rules
1. Write only inside your scope: ${scope}.
2. Prefix commit messages with "${NAME}:" and commit only your own files by explicit path. Never push; the user decides when to push.
3. Keep your status file up to date (see your agent definition): first action and last action.
4. Be honest about confidence: separate "verified by running it", "verified by reading it" and "not verified".

## Output
Write deliverables to docs/${name}/<topic>.md and end with a short report: what you did, what is unverified, what needs the user.
`;
  const def = `---
name: ${name}
description: ${JSON.stringify(`${role}. ${description}`)}
tools: ${preset}
---

You are ${NAME} (${role}) for the ${p.name} project, launched as a subagent by the orchestrator session.

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
4. Other agents may run in parallel in the same checkout. Your write scope is ${scope}. When committing, stage and commit only your own files by explicit path, never \`git add -A\`. Never push.
5. Finish with a short report: what you did and how, what is unverified, and any mission file you wrote for another agent.
`;
  try {
    fs.mkdirSync(agentsDir(p), { recursive: true });
    fs.mkdirSync(promptsDir(p), { recursive: true });
    fs.mkdirSync(statusDir(p), { recursive: true });
    fs.writeFileSync(promptPath, prompt, { flag: 'wx' });
    fs.writeFileSync(defPath, def, { flag: 'wx' });
    fs.writeFileSync(statusPath, 'state: idle\ntask: -\nstep: -\nupdated: -\noutput: -\n', { flag: 'wx' });
    p.meta = p.meta || {}; p.meta[name] = { emblem, type: b.type }; saveProjects();
  } catch (e) { return { error: `Could not write the agent files: ${e.code || e.message}` }; }
  return { ok: true, name, project: p.id, root, files: [defPath, promptPath, statusPath] };
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
  [statusDir(p), agentsDir(p), ...p.outputs.map(o => o.dir)].forEach(d => watch(d));
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
      if (url.pathname === '/api/agents') { const r = createAgent(body); return json(res, r, r.error ? 400 : 200); }
      if (url.pathname === '/api/projects') { const r = createProject(body); return json(res, r, r.error ? 400 : 200); }
      if (url.pathname === '/api/run' || url.pathname === '/api/stop') return json(res, { error: 'Launching from the board is not set up yet. Run the agent in Claude Code.' }, 501);
      json(res, { error: 'Not found.' }, 404);
    });
  }

  if (url.pathname === '/api/projects') return json(res, projects.map(p => ({ id: p.id, name: p.name, root: p.root })));
  if (url.pathname === '/api/state') {
    const p = getProject(url.searchParams.get('project') || '') || projects[0];
    const agents = readAgents(p);
    const names = agents.map(a => a.name);
    return gitLog(p, names, commits => json(res, { project: { id: p.id, name: p.name, root: p.root }, agents, docs: readOutputs(p, names), commits }));
  }
  if (url.pathname === '/api/file') {
    const full = resolveFile(url.searchParams.get('id') || '');
    if (!full) return json(res, { error: 'not found' }, 404);
    try {
      const id = url.searchParams.get('id'), p = getProject(id.slice(0, id.indexOf(':')));
      const meta = readOutputs(p, readAgents(p).map(a => a.name)).find(o => o.id === id) || {};
      return json(res, { id, name: meta.name || path.basename(full), kind: meta.kind || 'Docs', agent: meta.agent || null, mtime: fs.statSync(full).mtimeMs, text: fs.readFileSync(full, 'utf8') });
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
