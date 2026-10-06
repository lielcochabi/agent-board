// SessionStart: tell Claude when the board has queued run requests for this project.
const fs = require('fs');
const path = require('path');

let raw = '';
process.stdin.on('data', c => (raw += c));
process.stdin.on('end', () => {
  try {
    const cwd = JSON.parse(raw || '{}').cwd || process.cwd();
    const dir = path.join(cwd, 'agent-requests');
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
    if (files.length) {
      const agents = [...new Set(files.map(f => f.replace(/-\d{8}T.*$/, '')))];
      console.log(`Agent Board: ${files.length} run request(s) queued from the board for ${agents.join(', ')}. Tell the user, and run /board:run when they want them started.`);
    }
  } catch {}
  process.exit(0);
});
