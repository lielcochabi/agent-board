// Builds public/index.html from the Claude Design reference (design/agent-board.design.html):
// swaps the mock data layer for the real local API and removes demo-only controls.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'agent-board.design.html'), 'utf8').replace(/\r\n/g, '\n');
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
  async getAgent(project, name){ return j('/api/agent?project=' + encodeURIComponent(project) + '&name=' + encodeURIComponent(name)); },
  async updateAgent(project, a){ await post('/api/agents/update', { project, ...a }); },
  async removeAgent(project, name){ await post('/api/agents/remove', { project, name }); },
  async redrawIcon(project, name, brief){ await post('/api/agents/icon', { project, name, brief }); },
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
rep(`const TYPE_HELP = { Researcher:'Tools: Read, Grep, Glob, WebSearch · no file writes', Reviewer:'Tools: Read, Grep, Glob · comments only, no edits', Builder:'Tools: Read, Edit, Write, Bash · writes inside its scope', Operator:'Tools: whatever your Claude session has, including connected apps · for work that is not code' };`,
    `const TYPE_HELP = { Researcher:'Tools: Read, Grep, Glob, Bash, WebSearch, WebFetch, Write · writes notes to its docs folder', Reviewer:'Tools: Read, Grep, Glob, Bash, Write · writes review notes only, no code edits', Builder:'Tools: Read, Grep, Glob, Bash, Write, Edit · can change project files inside its scope' , Operator:'Tools: whatever your Claude session has, including connected apps (shop, email, spreadsheets) · for work that is not code' };`);

// 4. show the server's own error text (the agent form already does)
rep(`catch(err){ setFieldError('fwPRoot', 'ePRoot', 'Couldn\\'t add it: ' + err.message); }`,
    `catch(err){ setFieldError('fwPRoot', 'ePRoot', err.message); }`);

// 5. the stage no longer needs the mock-only global
rep(`projects: [], all: {}, focus: 'jarvis', panel: null, launcherDown: false,`, `projects: [], all: {}, focus: 'jarvis', panel: null,`);

// 6. Run control = "send to Claude Code": the board queues a request file; the plugin's /board:run runs it in the user's own session.
rep("    POST /api/run   {project, agent, task}  -> 2xx = launched, anything else => copy-paste fallback\n    POST /api/stop  {project, agent}\n", '    POST /api/requests {project, agent, task} -> queues a request file; Claude Code runs it (/board:run)\n');
rep("  async run(project, agent, task){ await post('/api/run', { project, agent, task }); },\n  async stop(project, agent){ await post('/api/stop', { project, agent }); },\n",
    "  async run(project, agent, task){ return post('/api/requests', { project, agent, task }); },\n");
rep('<button class="btn danger" data-stop>■ Stop</button>', '');
rep("  if (t.closest('[data-stop]')) return api.stop(S.focus, S.panel.agent);\n", '');
rep("<p class=\"p-label\">Run</p>", "<p class=\"p-label\">Send to Claude Code</p>");
rep("⌘/Ctrl + Enter to run", "Ctrl + Enter to queue");
rep(">Run</button></div></div>`;", ">Queue it</button></div></div>`;");
rep("placeholder=\"What should it do?\"", "placeholder=\"What should it do? It is queued here and run by Claude Code.\"");
// after queuing: show the queued view with the command (reuses the design's fallback panel)
rep("<p>Launching from here isn't set up, so run it in Claude Code instead. Paste this:</p>", "<p>Queued. In your Claude Code session run <code>/board:run ${esc(a.name)}</code>, or paste this sentence instead:</p>");
rep("try { await api.run(S.focus, name, task); }\n  catch(err){ S.fallback[key] = task.replace(/\\.$/, ''); S.runKey = ''; renderPanel(); announce('Launcher unavailable. Copy the sentence into Claude Code.'); }",
    "try { await api.run(S.focus, name, task); S.fallback[key] = task.replace(/\\.$/, ''); S.runKey = ''; renderPanel(); announce('Queued. Run /board:run in Claude Code.'); }\n  catch(err){ S.runErr[key] = err.message; S.runKey = ''; renderPanel(); }");
// the demo's fake progress stream has no real data behind it
rep("<ul class=\"stream\" id=\"pStream\" aria-live=\"polite\"></ul>", '');
rep("    $('#pStream').innerHTML = log.map((s, i) => `<li class=\"${i === log.length - 1 ? 'now' : ''}\">${esc(s)}</li>`).join('');\n    $('#pStream').scrollTop = 1e6;\n", '');
// pending requests shown with the other facts
rep("${a.missions ? `<dt>Missions</dt><dd>${a.missions} waiting</dd>` : ''}</dl>`;", "${a.missions ? `<dt>Missions</dt><dd>${a.missions} waiting</dd>` : ''}${a.requests ? `<dt>Queued</dt><dd>${a.requests} request${a.requests > 1 ? 's' : ''} waiting for Claude Code</dd>` : ''}</dl>`;");

fs.mkdirSync(path.join(__dirname, '..', 'public'), { recursive: true });
fs.writeFileSync(path.join(__dirname, '..', 'public', 'index.html'), t);
console.log('built public/index.html', t.length, 'bytes');
