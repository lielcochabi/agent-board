# Agent Board

Local web app (no dependencies, Node 18+) for managing AI agents across several projects.

- **Folder strip:** one tab per project. A small dot on each tab shows running, blocked, failed or just-finished work in that project.
- **Stage:** the focused project's agents as animated emblems. Active agents sit forward; idle ones stand by.
- **Agent panel:** current task and step and the agent's output documents rendered as text. Commits are behind the Commits button. The panel has a task box: it queues a run request, and Claude Code runs it in your own session (see Claude Code plugin). The board itself never starts anything.
- **Create:** "New agent" asks for a name, a **goal** and (optionally) **how it works**, plus what it may do (Researcher, Reviewer or Builder) and an emblem. Everything else comes from `agent-template.md`: edit that one file to change the rules every new agent gets. "Advanced" adds role, when-to-use, write scope and extra rules, or lets you write the whole prompt yourself. "+" adds a project folder.
- **Icons:** there is no icon library. Each new agent draws its own small animated emblem, based on its goal (or on a description you typed). The board writes `agent-emblems/<name>.request.md`, a self-contained brief generated from `icon-spec.md`; the agent follows it the first time it runs, or `/board:icons` does it for every waiting agent. The result is `agent-emblems/<name>.svg`. Until then the agent shows a plain orb. "Redraw icon" in the panel asks for a new one with your own description. Because the SVG is written by a model, the server only accepts a strict whitelist (fixed shapes, `currentColor`, a small set of animation classes, `viewBox="0 0 64 64"`) and rebuilds it from validated parts, so a drawn icon can never carry script, links or images. A rejected file shows the reason in the panel. Agents created before this change keep their old library emblem until you redraw them.
- **Edit / Remove:** the agent panel has Edit agent (reopens the form with the saved values and rewrites its files) and Remove (asks first; moves the definition, prompt and status file to `agent-removed/` in the project, so nothing is lost; outputs and commits stay). Agents written by hand are never overwritten: Edit is off for them.
- **Live:** changes on disk are pushed to the page over Server-Sent Events.

## Claude Code plugin

The repo is also a Claude Code plugin (name `board`) and a one-plugin marketplace:

```
/plugin marketplace add <path-or-repo-of-this-folder>
/plugin install board@agent-board
```

- `/board:open` starts the board, adds the current project and opens it.
- Type a task into an agent's panel and press **Queue it**. The board writes `agent-requests/<agent>-<time>.md` in the project (a plain file, nothing is executed). In Claude Code, `/board:run [agent]` starts the queued agents as subagents in your session, where you see them and approve permissions as usual. A SessionStart hook reminds Claude when requests are waiting.
- Hooks on SubagentStart / SubagentStop keep `agent-status/<agent>.md` current for agents defined in the project's `.claude/agents/`, so the board follows them even if the agent forgets to write its own status. An honest `blocked` / `failed` / `done` the agent wrote itself is never overwritten.
- When installed as a plugin, `projects.json` is kept in the plugin data folder so updates do not wipe it.

## Run

Double-click `start.bat` (opens Firefox, falls back to your default browser), or `npm start`, then open http://localhost:4747.

## How it reads a project

For each registered project folder:

| Path | Used for |
|---|---|
| `.claude/agents/*.md` | the agents (name, role from the description, tools decide the type) |
| `agent-status/<agent>.md` | live state: `state`, `task`, `step`, `updated`, `output` |
| `agent-missions/<agent>-*.md` | waiting missions |
| `agent-emblems/<agent>.svg`, `<agent>.request.md` | the agent's drawn emblem and the pending request for one |
| `agent-requests/<agent>-*.md` | run requests queued from the board (moved to `done/` by `/board:run`) |
| `docs/**` | outputs, attributed to an agent by first sub-folder name |

The JARVIS project has its own folder mapping (plans, QA, research, reviews...) defined in `server.js`.

## Config (environment variables)

| Variable | Default |
|---|---|
| `JARVIS_PROJECT` | unset (when set, adds the JARVIS folder mapping on first run) |
| `JARVIS_REPO` | `<JARVIS_PROJECT>/jarvis-client` |
| `JARVIS_TODO` | unset |
| `BOARD_DATA` | the repo folder (`CLAUDE_PLUGIN_DATA` when run as a plugin) |
| `PORT` | `4747` |

Registered projects and agent emblems are stored in `projects.json` (machine-specific, gitignored).

## Design

`design/agent-board.design.html` is the untouched Claude Design reference (runs standalone with mock data). `design/build.js` turns it into `public/index.html` by swapping the mock layer for the real API: run `node design/build.js` after changing either. `DESIGN-PROMPT.md` is the prompt that produced it.

## Security

The server only listens on `127.0.0.1`, rejects requests whose Host header is not localhost, and requires an `X-Board` header on every POST so other websites cannot call it. It only reads files inside each project's output folders. It never executes anything; it only reads files and, on request, writes new agent files and run-request files into a project. Agents start only when you run `/board:run` inside Claude Code.
