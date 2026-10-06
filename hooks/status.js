// Keeps agent-status/<agent>.md current without the agent having to remember to write it.
// Runs on SubagentStart / SubagentStop. Only touches agents that live in the project's own .claude/agents/,
// and only the status file named after that agent. Never fails the session: any problem is swallowed.
const fs = require('fs');
const path = require('path');

let raw = '';
process.stdin.on('data', c => (raw += c));
process.stdin.on('end', () => {
  try { run(JSON.parse(raw || '{}')); } catch {}
  process.exit(0);
});

function projectRoot(cwd, agent) {
  let dir = path.resolve(cwd);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.claude', 'agents', `${agent}.md`))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

function parse(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*`?(state|task|step|updated|output)`?\s*:\s*`?(.*?)`?\s*$/i);
    if (m) out[m[1].toLowerCase()] = m[2];
  }
  return out;
}

function run(ev) {
  const agent = String(ev.agent_type || '');
  if (!/^[a-z][a-z0-9-]{1,39}$/.test(agent) || !ev.cwd) return;
  const root = projectRoot(ev.cwd, agent);
  if (!root) return;
  const dir = path.join(root, 'agent-status');
  const file = path.join(dir, `${agent}.md`);
  let cur = {};
  try { cur = parse(fs.readFileSync(file, 'utf8')); } catch {}
  const dash = v => (v && v !== '-' ? v : '-');
  let next;
  if (ev.hook_event_name === 'SubagentStart') {
    next = { state: 'running', task: '-', step: 'Starting', output: '-' };
  } else if (ev.hook_event_name === 'SubagentStop') {
    // Respect an honest status the agent wrote itself (blocked / failed / done); only close out a stale "running".
    if ((cur.state || '').toLowerCase() !== 'running') return;
    next = { state: 'done', task: dash(cur.task), step: 'Finished', output: dash(cur.output) };
  } else return;
  const text = `state: ${next.state}\ntask: ${next.task}\nstep: ${next.step}\nupdated: ${new Date().toISOString()}\noutput: ${next.output}\n`;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, text);
}
