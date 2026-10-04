# JARVIS Agent Board

Local web app (no dependencies, Node 18+) that shows what the JARVIS agents are doing and lets you read what they produced.

- **Agent rail:** state, current step and last update per agent, read from `agent-status/<agent>.md`.
- **Outputs:** plans, QA notes, research, reviews, audits, prompt log, missions and `JARVIS-TODO.md`, rendered as documents. Click an agent to filter to its outputs.
- **Live:** changes on disk are pushed to the page, no refresh needed.

## Run

Double-click `start.bat`, or `npm start`, then open http://localhost:4747.

## Config (environment variables)

| Variable | Default |
|---|---|
| `JARVIS_PROJECT` | `C:/Users/lielc/Desktop/personalAi-testing` (holds `agent-status/` and `agent-missions/`) |
| `JARVIS_REPO` | `<JARVIS_PROJECT>/jarvis-client` (holds `docs/`) |
| `JARVIS_TODO` | `C:/Users/lielc/Desktop/JARVIS-TODO.md` |
| `PORT` | `4747` |

Read-only: the server only serves files inside the output folders listed in `server.js`.
