---
name: open
description: Start the Agent Board server, add the current project to it and open it in the browser. Use for /board:open or when the user asks to see or open the agent board.
disable-model-invocation: true
---

1. Check whether the board is already running: `curl -s -o /dev/null -w "%{http_code}" http://localhost:4747/api/projects` (200 means yes). If it is not, start it in the background with `BOARD_DATA="${CLAUDE_PLUGIN_DATA}" node "${CLAUDE_PLUGIN_ROOT}/server.js"` and wait a second.
2. Register the current project folder (the one containing `.claude/agents/`, normally the working directory). Send the request with the required header; a "already on the board" error is fine:
   `curl -s -X POST http://localhost:4747/api/projects -H "x-board: 1" -H "content-type: application/json" -d '{"name":"<folder name>","root":"<absolute project path>"}'`
3. Open http://localhost:4747 for the user (use the Browser pane tools if available, otherwise give the link).
4. Tell the user in two lines: the board follows their agents live, and tasks typed into an agent's panel are queued and started with `/board:run`.
