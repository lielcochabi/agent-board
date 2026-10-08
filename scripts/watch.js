// Prints one line per run request that appears in <project>/agent-requests, so a Claude Code Monitor can react to each one.
// It only watches and prints. Starting the agent is done by the Claude session, under its own permissions.
const fs = require('fs');
const path = require('path');
const dir = path.join(path.resolve(process.argv[2] || process.cwd()), 'agent-requests');
const seen = new Set();
function scan() {
  let files = [];
  try { files = fs.readdirSync(dir).filter(f => f.endsWith('.md')).sort(); } catch {}
  for (const f of files) if (!seen.has(f)) { seen.add(f); console.log('REQUEST ' + f); }
}
console.log('watching ' + dir);
scan();
setInterval(scan, 3000);
