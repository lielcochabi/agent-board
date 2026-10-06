# Agent Board

Local web app (no dependencies, Node 18+) for managing AI agents across several projects.

- **Folder strip:** one tab per project. A small dot on each tab shows running, blocked, failed or just-finished work in that project.
- **Stage:** the focused project's agents as animated emblems. Active agents sit forward; idle ones stand by.
- **Agent panel:** current task and step, a Run box, and the agent's output documents rendered as text. Commits are behind the Commits button.
- **Create:** "New agent" writes the agent's definition, job description and status file into the project; "+" adds a project folder.
- **Live:** changes on disk are pushed to the page over Server-Sent Events.

## Run

Double-click `start.bat` (opens Firefox, falls back to your default browser), or `npm start`, then open http://localhost:4747.

## How it reads a project

For each registered project folder:

| Path | Used for |
|---|---|
| `.claude/agents/*.md` | the agents (name, role from the description, tools decide the type) |
| `agent-status/<agent>.md` | live state: `state`, `task`, `step`, `updated`, `output` |
| `agent-missions/<agent>-*.md` | waiting missions |
| `docs/**` | outputs, attributed to an agent by first sub-folder name |

The JARVIS project has its own folder mapping (plans, QA, research, reviews...) defined in `server.js`.

## Config (environment variables)

| Variable | Default |
|---|---|
| `JARVIS_PROJECT` | `C:/Users/lielc/Desktop/personalAi-testing` |
| `JARVIS_REPO` | `<JARVIS_PROJECT>/jarvis-client` |
| `JARVIS_TODO` | `C:/Users/lielc/Desktop/JARVIS-TODO.md` |
| `PORT` | `4747` |

Registered projects and agent emblems are stored in `projects.json` (machine-specific, gitignored).

## Design

`design/agent-board.design.html` is the untouched Claude Design reference (runs standalone with mock data). `design/build.js` turns it into `public/index.html` by swapping the mock layer for the real API: run `node design/build.js` after changing either. `DESIGN-PROMPT.md` is the prompt that produced it.

## Security

The server only listens on `127.0.0.1`, rejects requests whose Host header is not localhost, and requires an `X-Board` header on every POST so other websites cannot call it. It only reads files inside each project's output folders. It never executes anything: `/api/run` and `/api/stop` answer 501 until launching is built, and the Run box falls back to a sentence you paste into Claude Code.
