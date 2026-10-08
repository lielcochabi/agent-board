// Agent Board tests. Run with: npm test
// Starts the real server on a spare port with throwaway data and project folders, then exercises the HTTP API,
// the hooks and the watcher script. Nothing outside the OS temp folder is touched.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PORT = 4900 + Math.floor(Math.random() * 90);
const BASE = `http://localhost:${PORT}`;
const tmp = prefix => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const DATA = tmp('board-data-'), HOME = tmp('board-home-'), PROJ = tmp('board-proj-'), NOGIT = tmp('board-nogit-');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const H = { 'content-type': 'application/json', 'x-board': '1' };

let passed = 0, failed = 0, group = '';
function check(name, ok, detail) {
  if (ok) passed++; else { failed++; console.log(`  FAIL [${group}] ${name}${detail === undefined ? '' : ' -> ' + JSON.stringify(detail)}`); }
}
const section = n => { group = n; console.log(n); };

const post = async (p, b, headers = H) => { const r = await fetch(BASE + p, { method: 'POST', headers, body: JSON.stringify(b) }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; };
const get = async p => { const r = await fetch(BASE + p); return { status: r.status, ...(await r.json().catch(() => ({}))) }; };
const state = async id => (await get('/api/state?project=' + id));
const agent = async (id, name) => (await state(id)).agents.find(a => a.name === name);

let srv;
const start = async () => {
  srv = cp.spawn('node', [path.join(ROOT, 'server.js')], { env: { ...process.env, PORT: String(PORT), BOARD_DATA: DATA, USERPROFILE: HOME, HOME, BOARD_TICK_MS: '800' }, stdio: 'ignore' });
  for (let i = 0; i < 40; i++) { try { await fetch(BASE + '/api/projects'); return; } catch { await sleep(100); } }
  throw new Error('server did not start');
};
const stop = async () => { srv.kill(); await sleep(400); };
const rawHost = (host) => new Promise(res => http.get({ host: 'localhost', port: PORT, path: '/api/projects', headers: { Host: host } }, r => { r.resume(); res(r.statusCode); }));
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');
const git = (cwd, ...a) => cp.execFileSync('git', a, { cwd, stdio: 'ignore' });
const writeStatus = (root, n, st, step = 'working') => { fs.mkdirSync(path.join(root, 'agent-status'), { recursive: true }); fs.writeFileSync(path.join(root, 'agent-status', n + '.md'), `state: ${st}\ntask: job\nstep: ${step}\nupdated: ${new Date().toISOString()}\noutput: -\n`); };

(async () => {
  git(PROJ, 'init'); git(PROJ, 'config', 'user.email', 't@t.t'); git(PROJ, 'config', 'user.name', 't');
  fs.writeFileSync(path.join(PROJ, 'a.txt'), '1'); git(PROJ, 'add', '.'); git(PROJ, 'commit', '-m', 'one');
  fs.writeFileSync(path.join(PROJ, '.mcp.json'), JSON.stringify({ mcpServers: { shopify: { url: 'https://x.example?token=SECRET123' }, 'bad name!': {} } }));
  fs.writeFileSync(path.join(HOME, '.claude.json'), JSON.stringify({ mcpServers: { gmail: { command: 'npx', env: { TOKEN: 'SECRET456' } } } }));
  await start();

  section('security');
  check('rejects a foreign Host header', (await rawHost('evil.example')) === 403);
  check('POST without X-Board is blocked', (await post('/api/projects', { name: 'x', root: PROJ }, { 'content-type': 'application/json' })).status === 403);
  check('GET /api/state for no projects is a clean 404', (await get('/api/state')).status === 404);

  section('projects');
  check('add project', (await post('/api/projects', { name: 'Proj', root: PROJ })).ok === true);
  check('same folder twice is refused', !!(await post('/api/projects', { name: 'Other', root: PROJ })).error);
  check('relative path is refused', !!(await post('/api/projects', { name: 'Rel', root: 'some/where' })).error);
  check('missing folder is refused', !!(await post('/api/projects', { name: 'Gone', root: path.join(PROJ, 'nope') })).error);
  check('non-git project', (await post('/api/projects', { name: 'Shop', root: NOGIT })).ok === true);
  check('git flag per project', (await state('proj')).git === true && (await state('shop')).git === false);

  section('agents: create, validate, files');
  const mk = (o) => post('/api/agents', { project: 'proj', name: 'scout', goal: 'Find useful things in the code.', how: 'Read first.', type: 'Researcher', ...o });
  check('create', (await mk({})).ok === true);
  check('duplicate name', !!(await mk({})).error);
  check('reserved name', !!(await mk({ name: 'explore' })).error);
  check('bad name', !!(await mk({ name: 'Bad Name' })).error);
  check('goal required', !!(await mk({ name: 'nogoal', goal: '' })).error);
  check('unknown type', !!(await mk({ name: 'weird', type: 'Wizard' })).error);
  const prompt = read(PROJ, 'agent-prompts', 'scout.md'), def = read(PROJ, '.claude', 'agents', 'scout.md');
  check('prompt has no unresolved placeholders', !/\{\{\w+\}\}/.test(prompt));
  check('prompt carries goal, how and folder', prompt.includes('Find useful things') && prompt.includes('Read first.') && prompt.includes('Your folder and messages'));
  check('git project gets the commit rule', /Prefix commit messages/.test(prompt));
  check('definition lists the type tools', /^tools: Read, Grep, Glob, Bash, Write, WebSearch, WebFetch$/m.test(def));
  check('own folder with inbox and outbox', fs.existsSync(path.join(PROJ, 'agent-space', 'scout', 'inbox')) && fs.existsSync(path.join(PROJ, 'agent-space', 'scout', 'outbox')));
  check('icon request written', fs.existsSync(path.join(PROJ, 'agent-emblems', 'scout.request.md')));
  check('status file starts idle', /state: idle/.test(read(PROJ, 'agent-status', 'scout.md')));
  check('non-git project: no commit rule', (await post('/api/agents', { project: 'shop', name: 'seller', goal: 'Sell things online.', type: 'Operator' })).ok === true && /not a git repository/.test(read(NOGIT, 'agent-prompts', 'seller.md')));

  section('agents: tools');
  const toolsLine = (root, n) => (read(root, '.claude', 'agents', n + '.md').split('\n').find(l => l.startsWith('tools:')) || null);
  await post('/api/agents', { project: 'proj', name: 'allrev', goal: 'Review everything.', type: 'Reviewer', tools: '*' });
  check('"*" means no tools line', toolsLine(PROJ, 'allrev') === null && (await get('/api/agent?project=proj&name=allrev')).tools === '*');
  await post('/api/agents', { project: 'proj', name: 'conly', goal: 'Use the shop app.', type: 'Operator', tools: 'mcp__shopify' });
  check('connector-only list keeps file tools', /^tools: Read, Grep, Glob, Write, Edit, Bash, WebSearch, WebFetch, mcp__shopify$/.test(toolsLine(PROJ, 'conly')));
  await post('/api/agents', { project: 'proj', name: 'mixed', goal: 'Read and write only.', type: 'Operator', tools: 'Read, Write, Bash(git:*)' });
  check('explicit list is untouched', toolsLine(PROJ, 'mixed') === 'tools: Read, Write, Bash(git:*)');
  check('unsafe tools text is refused', !!(await post('/api/agents', { project: 'proj', name: 'evil', goal: 'Do bad things.', type: 'Operator', tools: 'Read; rm -rf /' })).error);
  check('Operator has no tools line', (await post('/api/agents', { project: 'proj', name: 'op', goal: 'Do anything.', type: 'Operator' })).ok && toolsLine(PROJ, 'op') === null);

  section('agents: recognise existing, edit, remove');
  fs.writeFileSync(path.join(PROJ, '.claude', 'agents', 'hand.md'), '---\nname: hand\ndescription: "Hand worker. Does things."\ntools: Read, mcp__gmail__search\n---\nhi\n');
  fs.writeFileSync(path.join(PROJ, '.claude', 'agents', 'plain.md'), '---\nname: plain\ndescription: "Plain. No tools line."\n---\nhi\n');
  const types = Object.fromEntries((await state('proj')).agents.map(a => [a.name, a.type]));
  check('mcp tools show as Operator', types.hand === 'Operator');
  check('no tools line shows as Operator', types.plain === 'Operator');
  check('hand-written agent is not editable', !!(await post('/api/agents/update', { project: 'proj', name: 'hand', goal: 'overwrite me', type: 'Builder' })).error);
  check('edit rewrites files', (await post('/api/agents/update', { project: 'proj', name: 'scout', goal: 'Find even more things.', type: 'Builder' })).ok === true && /Edit$/m.test(toolsLine(PROJ, 'scout')) && read(PROJ, 'agent-prompts', 'scout.md').includes('even more'));
  check('path-like name is refused on remove', !!(await post('/api/agents/remove', { project: 'proj', name: '../x' })).error);
  writeStatus(PROJ, 'op', 'running');
  check('cannot remove a running agent', !!(await post('/api/agents/remove', { project: 'proj', name: 'op' })).error);
  check('remove moves files, keeps them', (await post('/api/agents/remove', { project: 'proj', name: 'mixed' })).ok === true && !fs.existsSync(path.join(PROJ, '.claude', 'agents', 'mixed.md')) && fs.readdirSync(path.join(PROJ, 'agent-removed')).length === 1);
  check('same name can be created again', (await post('/api/agents', { project: 'proj', name: 'mixed', goal: 'Back again.', type: 'Reviewer' })).ok === true);
  check('run-as chat is stored', (await post('/api/agents', { project: 'proj', name: 'solo', goal: 'Work on its own.', type: 'Operator', runAs: 'chat' })).ok && (await agent('proj', 'solo')).runAs === 'chat');

  section('run requests');
  check('queue a request', (await post('/api/requests', { project: 'proj', agent: 'scout', task: 'look at the readme' })).ok === true);
  const rq = d => fs.readdirSync(path.join(PROJ, 'agent-requests')).filter(f => f.startsWith(d + '-')).map(f => read(PROJ, 'agent-requests', f));
  check('request file has header and task', /^agent: scout$/m.test(rq('scout')[0]) && rq('scout')[0].endsWith('---\nlook at the readme\n'));
  check('unknown agent', !!(await post('/api/requests', { project: 'proj', agent: 'nobody', task: 'do it' })).error);
  check('task too short', !!(await post('/api/requests', { project: 'proj', agent: 'scout', task: 'x' })).error);
  await post('/api/requests', { project: 'proj', agent: 'op', task: 'sweep up', source: 'schedule' });
  check('same source and task is not queued twice', !!(await post('/api/requests', { project: 'proj', agent: 'op', task: 'sweep up', source: 'schedule' })).error && rq('op').length === 1);
  await post('/api/requests', { project: 'proj', agent: 'solo', task: 'do solo things' });
  check('chat agents mark their requests', /^run: chat$/m.test(rq('solo')[0]));
  check('requests are counted on the agent', (await agent('proj', 'scout')).requests === 1);

  section('messages');
  check('empty message', !!(await post('/api/messages', { project: 'proj', agent: 'scout', text: ' ' })).error);
  check('unknown agent', !!(await post('/api/messages', { project: 'proj', agent: '../x', text: 'hi' })).error);
  const m1 = await post('/api/messages', { project: 'proj', agent: 'allrev', text: 'What is our refund window?' });
  check('send saves and queues', m1.ok === true && m1.queued === true && fs.readdirSync(path.join(PROJ, 'agent-space', 'allrev', 'inbox')).length === 1);
  check('second message saved, run already queued', (await post('/api/messages', { project: 'proj', agent: 'allrev', text: 'And shipping?' })).queued === false);
  check('two unanswered', (await agent('proj', 'allrev')).space.unanswered === 2);
  await sleep(30);
  fs.writeFileSync(path.join(PROJ, 'agent-space', 'allrev', 'outbox', '20990101T000000-reply.md'), 'to: you\n\n30 days.');
  check('a reply clears them', (await agent('proj', 'allrev')).space.unanswered === 0);
  const th = await get('/api/thread?project=proj&agent=allrev');
  check('thread has both sides in order', th.items.length === 3 && th.items[0].side === 'in' && th.items[2].side === 'out' && th.items[2].text === '30 days.');

  section('icons');
  const E = path.join(PROJ, 'agent-emblems');
  check('pending until drawn', (await agent('proj', 'scout')).iconPending === true);
  const good = '<svg viewBox="0 0 64 64"><path class="ln" d="M27 50 L30 26 H34 L37 50 Z"/><circle class="fill a k-pulse" cx="32" cy="22" r="3" style="--dl:.4s"/><g class="a k-spin c"><path class="wedge" d="M32 22 L54 15 L54 29 Z" transform="rotate(10 32 22)"/></g></svg>';
  fs.writeFileSync(path.join(E, 'scout.svg'), good);
  const drawn = await agent('proj', 'scout');
  check('drawn icon is served as clean markup', !drawn.iconPending && !drawn.iconError && drawn.emblemSvg.includes('k-pulse') && !drawn.emblemSvg.includes('<svg'));
  const bad = {
    script: '<svg viewBox="0 0 64 64"><script>alert(1)</script></svg>',
    onload: '<svg viewBox="0 0 64 64"><circle cx="1" cy="1" r="1" onload="alert(1)"/></svg>',
    image: '<svg viewBox="0 0 64 64"><image href="http://evil/x.png"/></svg>',
    foreign: '<svg viewBox="0 0 64 64"><foreignObject><div/></foreignObject></svg>',
    fillUrl: '<svg viewBox="0 0 64 64"><circle cx="1" cy="1" r="1" fill="url(#a)"/></svg>',
    styleUrl: '<svg viewBox="0 0 64 64"><circle cx="1" cy="1" r="1" style="fill:url(http://x)"/></svg>',
    colour: '<svg viewBox="0 0 64 64"><circle cx="1" cy="1" r="1" fill="red"/></svg>',
    pathJs: '<svg viewBox="0 0 64 64"><path d="M0 0 alert(1)"/></svg>',
    cls: '<svg viewBox="0 0 64 64"><path class="ln evil" d="M0 0"/></svg>',
    comment: '<svg viewBox="0 0 64 64"><!-- hi --><path d="M0 0"/></svg>',
    text: '<svg viewBox="0 0 64 64">hello<path d="M0 0"/></svg>',
    viewBox: '<svg viewBox="0 0 100 100"><path d="M0 0"/></svg>',
    unclosed: '<svg viewBox="0 0 64 64"><g><path d="M0 0"/></svg>',
    trailing: '<svg viewBox="0 0 64 64"></svg><script>1</script>',
    huge: '<svg viewBox="0 0 64 64">' + '<circle cx="1" cy="1" r="1"/>'.repeat(90) + '</svg>',
    entity: '<svg viewBox="0 0 64 64"><path d="M0 0" class="ln&#x22; onclick=&#x22;x"/></svg>',
  };
  for (const [k, v] of Object.entries(bad)) { fs.writeFileSync(path.join(E, 'scout.svg'), v); const a = await agent('proj', 'scout'); check('rejects ' + k, a.emblemSvg === '' && !!a.iconError, a.emblemSvg.slice(0, 60)); }
  fs.writeFileSync(path.join(E, 'scout.svg'), good);
  check('redraw writes a request with the brief and keeps the old icon', (await post('/api/agents/icon', { project: 'proj', name: 'scout', brief: 'a radar sweep' })).ok && read(E, 'scout.request.md').includes('a radar sweep') && (await agent('proj', 'scout')).emblemSvg.length > 10);
  check('redraw for a bad name', !!(await post('/api/agents/icon', { project: 'proj', name: '../x', brief: '' })).error);

  section('connectors');
  const cn = await get('/api/connectors?project=proj'), cnRaw = JSON.stringify(cn);
  check('lists project and user apps by name', cn.servers.map(s => s.tool).sort().join() === 'mcp__gmail,mcp__shopify');
  check('never returns secrets, commands or urls', !/SECRET|token|npx|command|https?:/i.test(cnRaw));
  check('unknown project', (await get('/api/connectors?project=nope')).status === 404);
  fs.writeFileSync(path.join(PROJ, '.mcp.json'), JSON.stringify({ mcpServers: { shopify: {}, stripe: {} } }));
  check('a changed .mcp.json shows up without a restart', (await get('/api/connectors?project=proj')).servers.some(s => s.tool === 'mcp__stripe'));
  fs.writeFileSync(path.join(HOME, '.claude.json'), JSON.stringify({ mcpServers: { slack: {} } }));
  check('a changed user settings file shows up too', (await get('/api/connectors?project=proj')).servers.some(s => s.tool === 'mcp__slack') && !(await get('/api/connectors?project=proj')).servers.some(s => s.tool === 'mcp__gmail'));

  section('commits');
  fs.writeFileSync(path.join(PROJ, 'c.txt'), '3'); git(PROJ, 'add', '.'); git(PROJ, 'commit', '-m', 'scout: add a file');
  await sleep(8200); // the commit list is cached for a few seconds
  const commits = (await state('proj')).commits;
  check('commits are listed and tagged with the agent that made them', commits.length >= 2 && commits[0].agent === 'scout' && commits[0].message === 'scout: add a file', commits[0]);
  check('repeated reads inside the cache window agree', JSON.stringify((await state('proj')).commits) === JSON.stringify(commits));

  section('outputs');
  fs.mkdirSync(path.join(NOGIT, 'docs', 'seller'), { recursive: true });
  fs.writeFileSync(path.join(NOGIT, 'docs', 'seller', 'week-41.csv'), 'sku,ours\nA1,10\n');
  fs.writeFileSync(path.join(NOGIT, 'docs', 'seller', 'photo.png'), 'x');
  const docs = (await state('shop')).docs;
  check('csv listed and attributed, png not', docs.some(d => d.name.endsWith('.csv') && d.agent === 'seller') && !docs.some(d => d.name.endsWith('.png')));
  const fileRes = await get('/api/file?id=' + encodeURIComponent(docs.find(d => d.name.endsWith('.csv')).id));
  check('file endpoint returns text and metadata', fileRes.text === 'sku,ours\nA1,10\n' && fileRes.kind === 'Docs' && fileRes.agent === 'seller');
  check('file ids cannot leave the output folders', (await get('/api/file?id=' + encodeURIComponent('shop:docs/../../x'))).status === 404);

  section('imports');
  const items = [
    { kind: 'scheduled', id: 'daily-report', title: 'Daily sales report', description: 'Summarise sales.', prompt: 'Read the CSV.\nFlag drops.', cron: '30 8 * * *' },
    { kind: 'scheduled', id: 'weekdays', title: 'Weekday notes', cron: '0 9 * * 1-5' },
    { kind: 'session', id: 'local_abc-123', title: 'Pricing chat', cwd: NOGIT, link: 'claude://claude.ai/epitaxy/local_abc-123' },
    { kind: 'session', id: 'evil', title: 'Evil', link: 'javascript:alert(1)', cron: '$(rm -rf /)' },
    { kind: 'chat', id: 'web', title: 'A web chat', link: 'https://claude.ai/chat/abcd1234' },
    { kind: 'session', id: 'bad id with spaces', title: 'bad' },
  ];
  check('post list, bad ids and kinds dropped', (await post('/api/imports', { items })).count === 4);
  const li = (await get('/api/imports')).items;
  const byId = Object.fromEntries(li.map(i => [i.id, i]));
  check('daily cron becomes a trigger preview', byId['scheduled:daily-report'].trigger && byId['scheduled:daily-report'].trigger.label === 'Every day at 08:30');
  check('weekday cron is not converted', byId['scheduled:weekdays'].trigger === null);
  check('project guessed from the chat folder', byId['session:local_abc-123'].project === 'shop');
  check('hostile link and cron are dropped', byId['session:evil'].link === '' && byId['session:evil'].cron === '');
  const ad = await post('/api/imports/adopt', { id: 'scheduled:daily-report', project: 'proj', name: 'sales-report', goal: 'Summarise sales.', how: 'Read the CSV.', type: 'Operator', schedule: true });
  const sr = await agent('proj', 'sales-report');
  check('adopt makes the agent, origin and trigger', ad.ok && sr.origin.kind === 'scheduled' && sr.triggers.length === 1 && sr.triggers[0].label === 'Every day at 08:30');
  check('adopted item leaves the list', !(await get('/api/imports')).items.some(i => i.id === 'scheduled:daily-report'));
  check('adopting twice is refused', !!(await post('/api/imports/adopt', { id: 'scheduled:daily-report', project: 'proj', name: 'again', goal: 'x y z', type: 'Operator' })).error);
  await post('/api/agents/update', { project: 'proj', name: 'sales-report', goal: 'Summarise sales better.', type: 'Operator' });
  check('editing keeps the origin', (await agent('proj', 'sales-report')).origin.kind === 'scheduled');

  section('triggers: validation');
  const tv = b => post('/api/triggers', { project: 'proj', agent: 'op', task: 'do the thing', ...b });
  check('repeat under 5 minutes', !!(await tv({ kind: 'every', every: 1 })).error);
  check('bad time', !!(await tv({ kind: 'daily', at: '25:00' })).error);
  check('folder with ..', !!(await tv({ kind: 'file', dir: '../x' })).error);
  check('absolute folder', !!(await tv({ kind: 'file', dir: 'C:/Windows' })).error);
  check('agent waiting for itself', !!(await tv({ kind: 'after', after: 'op' })).error);
  check('no task', !!(await post('/api/triggers', { project: 'proj', agent: 'op', kind: 'commit', task: '' })).error);
  check('unknown agent', !!(await post('/api/triggers', { project: 'proj', agent: 'nope', kind: 'commit', task: 'xxx' })).error);

  section('triggers: firing');
  fs.rmSync(path.join(PROJ, 'agent-requests'), { recursive: true, force: true });
  const ids = {};
  for (const [k, b] of Object.entries({
    every: { agent: 'scout', kind: 'every', every: 5, task: 'Scan for new tasks.' },
    daily: { agent: 'scout', kind: 'daily', at: '00:00', task: 'Daily sweep.' },
    commit: { agent: 'allrev', kind: 'commit', task: 'Check the latest commit.' },
    file: { agent: 'conly', kind: 'file', dir: 'inbox', ext: 'csv', task: 'Process the new CSV.' },
    after: { agent: 'mixed', kind: 'after', after: 'solo', task: 'Write up what solo found.' },
  })) { const r = await post('/api/triggers', { project: 'proj', ...b }); ids[k] = r.id; check('create ' + k, r.ok === true); }
  await stop();
  const pf = path.join(DATA, 'projects.json'), pr = JSON.parse(fs.readFileSync(pf, 'utf8'));
  for (const p of pr) for (const t of p.triggers || []) t.created -= 36 * 3600 * 1000; // make schedules due
  fs.writeFileSync(pf, JSON.stringify(pr));
  fs.mkdirSync(path.join(PROJ, 'inbox'), { recursive: true }); fs.writeFileSync(path.join(PROJ, 'inbox', 'old.csv'), 'old');
  writeStatus(PROJ, 'solo', 'idle');
  await start(); await sleep(2800);
  const queued = () => { try { return fs.readdirSync(path.join(PROJ, 'agent-requests')).filter(f => f.endsWith('.md')).map(f => /source: (\S+)/.exec(read(PROJ, 'agent-requests', f))[1] + ':' + f.replace(/-\d{8}T.*/, '')); } catch { return []; } };
  const first = queued().sort();
  check('schedules fire once, others only set a baseline', first.join() === 'schedule:sales-report,schedule:scout,schedule:scout', first); // sales-report carries the daily trigger adopted from an import
  fs.writeFileSync(path.join(PROJ, 'b.txt'), '2'); git(PROJ, 'add', '.'); git(PROJ, 'commit', '-m', 'two');
  fs.writeFileSync(path.join(PROJ, 'inbox', 'new.csv'), 'new');
  writeStatus(PROJ, 'solo', 'running'); await sleep(1800); writeStatus(PROJ, 'solo', 'done'); await sleep(2800);
  const after = queued().sort();
  check('commit, file and after-another-agent each fire', ['commit:allrev', 'file:conly', 'after:solo:mixed'].every(x => after.includes(x)), after);
  await sleep(2000);
  check('no pile-up on later ticks', queued().length === after.length, queued());
  check('pause and remove', (await post('/api/triggers/toggle', { project: 'proj', id: ids.commit, enabled: false })).ok && (await post('/api/triggers/remove', { project: 'proj', id: ids.every })).ok && (await agent('proj', 'allrev')).triggers[0].enabled === false);

  section('flow');
  fs.mkdirSync(path.join(PROJ, 'agent-missions'), { recursive: true });
  fs.writeFileSync(path.join(PROJ, 'agent-missions', 'allrev-verify-numbers.md'), 'from: scout\n# Verify the numbers\nplease');
  fs.writeFileSync(path.join(PROJ, 'agent-missions', 'conly-draft-post.md'), '# Draft the post\nfrom the user');
  const old = new Date(Date.now() - 3 * 3600 * 1000); fs.utimesSync(path.join(PROJ, 'agent-missions', 'conly-draft-post.md'), old, old);
  const fl = await get('/api/flow?project=proj');
  const edge = (from, to) => fl.edges.find(e => e.from === from && e.to === to);
  check('mission from an agent', edge('scout', 'allrev') && edge('scout', 'allrev').kind === 'mission' && edge('scout', 'allrev').what === 'Verify the numbers');
  check('old unpicked mission is stuck', edge('you', 'conly') && edge('you', 'conly').status === 'stuck');
  check('trigger sources show as senders', edge('commit', 'allrev') && edge('schedule', 'scout') && edge('file', 'conly') && edge('solo', 'mixed'));
  check('queued requests are waiting', edge('commit', 'allrev').status === 'waiting');

  section('hooks and watcher');
  const run = (script, ev) => cp.spawnSync('node', [path.join(ROOT, script)], { input: JSON.stringify(ev), encoding: 'utf8' });
  const HP = tmp('board-hook-');
  fs.mkdirSync(path.join(HP, '.claude', 'agents'), { recursive: true }); fs.writeFileSync(path.join(HP, '.claude', 'agents', 'tester.md'), '---\nname: tester\n---\n');
  run('hooks/status.js', { hook_event_name: 'SubagentStart', agent_type: 'tester', cwd: HP });
  check('start hook writes running', /state: running/.test(read(HP, 'agent-status', 'tester.md')));
  run('hooks/status.js', { hook_event_name: 'SubagentStop', agent_type: 'tester', cwd: HP });
  check('stop hook closes a stale running', /state: done/.test(read(HP, 'agent-status', 'tester.md')));
  fs.writeFileSync(path.join(HP, 'agent-status', 'tester.md'), 'state: blocked\ntask: x\nstep: needs you\nupdated: now\noutput: -\n');
  run('hooks/status.js', { hook_event_name: 'SubagentStop', agent_type: 'tester', cwd: HP });
  check('stop hook keeps an honest blocked', /state: blocked/.test(read(HP, 'agent-status', 'tester.md')));
  run('hooks/status.js', { hook_event_name: 'SubagentStart', agent_type: 'general-purpose', cwd: HP });
  check('hook ignores agents that are not in the project', fs.readdirSync(path.join(HP, 'agent-status')).join() === 'tester.md');
  fs.mkdirSync(path.join(HP, 'agent-requests'), { recursive: true }); fs.writeFileSync(path.join(HP, 'agent-requests', 'tester-20260101T000000-ab12.md'), 'agent: tester\n---\nx');
  fs.mkdirSync(path.join(HP, 'agent-emblems'), { recursive: true }); fs.writeFileSync(path.join(HP, 'agent-emblems', 'tester.request.md'), 'x');
  const inbox = run('hooks/inbox.js', { cwd: HP }).stdout;
  check('session hook mentions requests and icons', /1 run request/.test(inbox) && /1 agent icon/.test(inbox), inbox);
  const w = cp.spawn('node', [path.join(ROOT, 'scripts', 'watch.js'), HP], { stdio: ['ignore', 'pipe', 'ignore'] });
  let out = ''; w.stdout.on('data', c => (out += c));
  await sleep(700); fs.writeFileSync(path.join(HP, 'agent-requests', 'tester-20260101T000001-cd34.md'), 'agent: tester\n---\ny'); await sleep(3600); w.kill();
  check('watcher prints existing and new requests once', (out.match(/REQUEST /g) || []).length === 2, out);
  fs.rmSync(HP, { recursive: true, force: true });

  await stop();
  for (const d of [DATA, HOME, PROJ, NOGIT]) fs.rmSync(d, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('TEST RUN CRASHED:', e); try { srv.kill(); } catch {} process.exit(2); });
