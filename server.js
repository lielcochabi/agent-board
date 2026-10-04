// JARVIS Agent Board: zero-dependency local server.
// Reads agent status files and agent output docs straight from disk and streams change events to the browser.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const PORT = Number(process.env.PORT) || 4747;
const PROJECT = process.env.JARVIS_PROJECT || 'C:/Users/lielc/Desktop/personalAi-testing';
const REPO = process.env.JARVIS_REPO || path.join(PROJECT, 'jarvis-client');
const TODO = process.env.JARVIS_TODO || 'C:/Users/lielc/Desktop/JARVIS-TODO.md';
const STATUS_DIR = path.join(PROJECT, 'agent-status');
const PUBLIC = path.join(__dirname, 'public');

const ROSTER = [
  ['scout', 'Researcher'], ['compass', 'Planner'], ['forge', 'Builder'],
  ['echo', 'Voice / prompts'], ['sentry', 'Tester / QA'], ['warden', 'Reviewer'],
  ['herald', 'Release manager'], ['scribe', 'Docs keeper'], ['custodian', 'Quality auditor'],
];

// Output roots. The id of a file is "<rootKey>/<relative path>", so a request can never name a path outside these folders.
const ROOTS = {
  plans:    { dir: path.join(REPO, 'docs/plans'),       label: 'Plans',     agent: 'compass' },
  qa:       { dir: path.join(REPO, 'docs/qa'),          label: 'QA',        agent: 'sentry' },
  research: { dir: path.join(REPO, 'docs/research'),    label: 'Research',  agent: 'scout' },
  review:   { dir: path.join(REPO, 'docs/review'),      label: 'Reviews',   agent: 'warden' },
  audit:    { dir: path.join(REPO, 'docs/audit'),       label: 'Audits',    agent: 'custodian' },
  prompts:  { dir: path.join(REPO, 'docs/prompt-log'),  label: 'Prompt log', agent: 'echo' },
  missions: { dir: path.join(PROJECT, 'agent-missions'), label: 'Missions',  agent: null },
};

function parseStatus(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*`?(state|task|step|updated|output)`?\s*:\s*`?(.*?)`?\s*$/i);
    if (m) out[m[1].toLowerCase()] = m[2];
  }
  return out;
}

function walk(dir, base = '') {
  let files = [];
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return files; }
  for (const e of entries) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) files = files.concat(walk(path.join(dir, e.name), rel));
    else if (/\.(md|txt)$/i.test(e.name)) files.push(rel);
  }
  return files;
}

function readAgents() {
  return ROSTER.map(([name, role]) => {
    let s = {};
    try { s = parseStatus(fs.readFileSync(path.join(STATUS_DIR, `${name}.md`), 'utf8')); } catch {}
    const missions = walk(ROOTS.missions.dir).filter(f => f.toLowerCase().startsWith(name + '-')).length;
    return { name, role, state: (s.state || 'idle').toLowerCase(), task: s.task || '', step: s.step || '',
             updated: s.updated || '', output: s.output || '', missions };
  });
}

function readOutputs() {
  const list = [];
  for (const [key, r] of Object.entries(ROOTS)) {
    for (const rel of walk(r.dir)) {
      const st = fs.statSync(path.join(r.dir, rel));
      let agent = r.agent;
      if (key === 'missions') { const m = rel.match(/^([a-z]+)-/i); agent = m ? m[1].toLowerCase() : null; }
      list.push({ id: `${key}/${rel}`, name: rel, kind: r.label, agent, mtime: st.mtimeMs, size: st.size });
    }
  }
  try {
    const st = fs.statSync(TODO);
    list.push({ id: 'todo/JARVIS-TODO.md', name: 'JARVIS-TODO.md', kind: 'TODO', agent: 'scribe', mtime: st.mtimeMs, size: st.size });
  } catch {}
  return list.sort((a, b) => b.mtime - a.mtime);
}

function resolveFile(id) {
  if (id === 'todo/JARVIS-TODO.md') return TODO;
  const i = id.indexOf('/');
  const root = ROOTS[id.slice(0, i)];
  if (!root) return null;
  const full = path.resolve(root.dir, id.slice(i + 1));
  const rootAbs = path.resolve(root.dir) + path.sep;
  return full.startsWith(rootAbs) ? full : null;
}

function gitLog(cb) {
  execFile('git', ['log', '--pretty=format:%h\t%an\t%ar\t%s', '-12'], { cwd: REPO, timeout: 4000 }, (err, out) => {
    if (err) return cb([]);
    cb(out.split('\n').filter(Boolean).map(l => { const [hash, author, when, subject] = l.split('\t'); return { hash, author, when, subject }; }));
  });
}

const clients = new Set();
let timer = null;
function broadcast() {
  clearTimeout(timer);
  timer = setTimeout(() => { for (const c of clients) c.write('data: change\n\n'); }, 150);
}
for (const dir of [STATUS_DIR, ...Object.values(ROOTS).map(r => r.dir), path.dirname(TODO)]) {
  try { fs.watch(dir, { recursive: dir !== path.dirname(TODO) }, (_, f) => { if (dir !== path.dirname(TODO) || /JARVIS-TODO/.test(f || '')) broadcast(); }); } catch {}
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
function json(res, data, code = 200) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/state') {
    return gitLog(commits => json(res, { agents: readAgents(), outputs: readOutputs(), commits, now: Date.now() }));
  }
  if (url.pathname === '/api/file') {
    const full = resolveFile(url.searchParams.get('id') || '');
    if (!full) return json(res, { error: 'not found' }, 404);
    try { return json(res, { id: url.searchParams.get('id'), mtime: fs.statSync(full).mtimeMs, text: fs.readFileSync(full, 'utf8') }); }
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
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}).listen(PORT, '127.0.0.1', () => console.log(`JARVIS Agent Board on http://localhost:${PORT}`));
