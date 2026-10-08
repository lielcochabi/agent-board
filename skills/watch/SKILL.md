---
name: watch
description: Start Agent Board runs automatically while this session is open: runs queued from the board and by its triggers (schedule, new commit, new file, another agent finishing). Use for /board:watch.
disable-model-invocation: true
---

Triggers on the Agent Board only queue run requests as files in `agent-requests/`. This session starts them, so every agent still runs here, under this session's permissions, where the user can see it.

1. Start a persistent Monitor on this command, from the project root (the folder that holds `.claude/agents/`):
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/watch.js" "<absolute project path>"`
   Each output line `REQUEST <file>` means a new request file exists. The first line (`watching ...`) is only a status line.
2. For each `REQUEST <file>` line, start that one request exactly as `/board:run` does, for that file only: read `agent-requests/<file>`, check the agent exists, do the connector check, move the file into `agent-requests/done/`, then start the agent (as its own chat if the request says `run: chat`, otherwise as a helper) using the task text (the lines after `---`). If a connector first has to be enabled or signed in, say so once and leave the file where it is. If the same agent is already running, wait for it to finish first.
3. The `source:` line says what queued it (a schedule, a commit, a new file, another agent, or the user). Mention it in one line when you start the agent.
4. Tell the user once that watching is on, and how to stop it: stop the monitor, or end the session.

Do not run anything that is not an agent from `.claude/agents/`, and never start more than three agents at the same time.
