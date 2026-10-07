// SessionStart: tell Claude when the board has queued run requests for this project.
const fs = require('fs');
const path = require('path');

let raw = '';
process.stdin.on('data', c => (raw += c));
process.stdin.on('end', () => {
  try {
    const cwd = JSON.parse(raw || '{}').cwd || process.cwd();
    const list = d => { try { return fs.readdirSync(path.join(cwd, d)).filter(f => f.endsWith('.md')); } catch { return []; } };
    const files = list('agent-requests');
    if (files.length) {
      const agents = [...new Set(files.map(f => f.replace(/-\d{8}T.*$/, '')))];
      console.log(`Agent Board: ${files.length} run request(s) queued from the board for ${agents.join(', ')}. Tell the user, and run /board:run when they want them started.`);
    }
    const icons = list('agent-emblems').filter(f => f.endsWith('.request.md'));
    if (icons.length) console.log(`Agent Board: ${icons.length} agent icon(s) are waiting to be drawn (${icons.map(f => f.replace('.request.md', '')).join(', ')}). Tell the user, and run /board:icons when they want them drawn.`);
  } catch {}
  process.exit(0);
});
