// Builds public/index.html from the Claude Design reference (design/agent-board.design.html):
// swaps the mock data layer for the real local API and removes demo-only controls.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'agent-board.design.html'), 'utf8');
let t = src;

function cut(startMarker, endMarker, replacement) {
  const a = t.indexOf(startMarker), b = t.indexOf(endMarker);
  if (a < 0 || b < 0 || b < a) throw new Error('markers not found: ' + startMarker.slice(0, 50));
  t = t.slice(0, a) + replacement + t.slice(b);
}
function rep(a, b) {
  if (!t.includes(a)) throw new Error('missing: ' + a.slice(0, 70));
  t = t.replace(a, () => b);
}

// 1. data layer: mock + simulation -> real API
cut('/* ================================================================\n   DATA LAYER', '/* ================================================================\n   EMBLEMS', `/* ================================================================
   DATA LAYER: the local Node server (server.js)
   ================================================================ */
const EMBLEMS = ['scout','compass','forge','echo','sentry','warden','herald','scribe','custodian','orb'];

async function j(url){ const r = await fetch(url); if (!r.ok) throw new Error(r.status + ' ' + url); return r.json(); }
async function post(url, body){
  const r = await fetch(url, { method:'POST', headers:{ 'content-type':'application/json', 'x-board':'1' }, body: JSON.stringify(body) });
  let data = {}; try { data = await r.json(); } catch {}
  if (!r.ok) throw new Error(data.error || ('Request failed (' + r.status + ')'));
  return data;
}
const api = {
  projects: () => j('/api/projects'),
  state: id => j('/api/state?project=' + encodeURIComponent(id)),
  file: id => j('/api/file?id=' + encodeURIComponent(id)),
  async run(project, agent, task){ await post('/api/run', { project, agent, task }); },
  async stop(project, agent){ await post('/api/stop', { project, agent }); },
  async createAgent(project, a){ await post('/api/agents', { project, ...a }); },
  async createProject(p){ return (await post('/api/projects', p)).id; }
};

/* live updates: SSE "change" => refetch */
let refetchTimer;
function emitChange(){ clearTimeout(refetchTimer); refetchTimer = setTimeout(refetch, 60); }
{
  const es = new EventSource('/api/events');
  es.onmessage = e => { if (e.data === 'change') emitChange(); };
}

`);

// 2. demo-only controls
rep(`        <label><input type="checkbox" id="launcherToggle"><span>Launcher unavailable<small>Demo: shows the copy-to-Claude-Code fallback in Run.</small></span></label>\n`, '');
rep(`$('#launcherToggle').onchange = e => { S.launcherDown = e.target.checked; };\n`, '');

// 3. type help must match the tools the server really grants (every agent needs Write for its status file and notes)
rep(`const TYPE_HELP = { Researcher:'Tools: Read, Grep, Glob, WebSearch · no file writes', Reviewer:'Tools: Read, Grep, Glob · comments only, no edits', Builder:'Tools: Read, Edit, Write, Bash · writes inside its scope' };`,
    `const TYPE_HELP = { Researcher:'Tools: Read, Grep, Glob, Bash, WebSearch, WebFetch, Write · writes notes to its docs folder', Reviewer:'Tools: Read, Grep, Glob, Bash, Write · writes review notes only, no code edits', Builder:'Tools: Read, Grep, Glob, Bash, Write, Edit · can change project files inside its scope' };`);

// 4. show the server's own error text
rep(`catch(err){ return setFieldError('fwName', 'eName', 'Couldn\\'t save the agent file: ' + err.message); }`,
    `catch(err){ return setFieldError('fwName', 'eName', err.message); }`);
rep(`catch(err){ setFieldError('fwPRoot', 'ePRoot', 'Couldn\\'t add it: ' + err.message); }`,
    `catch(err){ setFieldError('fwPRoot', 'ePRoot', err.message); }`);

// 5. the stage no longer needs the mock-only global
rep(`projects: [], all: {}, focus: 'jarvis', panel: null, launcherDown: false,`, `projects: [], all: {}, focus: 'jarvis', panel: null,`);

// 6. no launch control: agents run from Claude Code; the board only follows them.
rep('    POST /api/run   {project, agent, task}  -> 2xx = launched, anything else => copy-paste fallback\n    POST /api/stop  {project, agent}\n', '');
rep(`<section class="p-sec" id="pRun" aria-label="Run"></section>`, '');
cut('  // run control\n  const mode = ', '  // outputs\n', '');
cut("  const key = S.focus + '/' + S.panel?.agent;\n  if (t.closest('[data-run]'))", '/* ================================================================\n   SHEETS', '});\n\n');
rep("  async run(project, agent, task){ await post('/api/run', { project, agent, task }); },\n  async stop(project, agent){ await post('/api/stop', { project, agent }); },\n", '');

fs.mkdirSync(path.join(__dirname, '..', 'public'), { recursive: true });
fs.writeFileSync(path.join(__dirname, '..', 'public', 'index.html'), t);
console.log('built public/index.html', t.length, 'bytes');
