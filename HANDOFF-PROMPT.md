# Handoff prompt: work on the Agent Board

You are picking up work on **Agent Board**, a local web app that shows what a crew of AI agents is doing across several projects. The owner is Liel, a solo developer. Read this whole brief, then read the files it names before changing anything.

## Where it lives
- Repo: `C:\Users\lielc\Desktop\jarvis-agent-board` (its own git repo, branch `main`, no remote). Commit your work there; never push.
- Run: `node server.js` then open http://localhost:4747. `start.bat` does the same and opens Firefox. Zero dependencies, Node 18+.

## What it is
- A slim **folder strip** with one tab per project; the focused project fills the stage with its agents as small animated emblems (active ones forward, idle ones standing by). Clicking an agent opens a side panel with its task, step, type, missions and output documents (rendered as text). A Commits button opens recent commits.
- **New agent** and **Add project** dialogs create real files on disk. There is deliberately no launch button: agents run from Claude Code, the board only follows them.

## How the code fits together
- `server.js`: the whole backend. Reads each registered project's `.claude/agents/*.md` (the agents), `agent-status/<agent>.md` (live state: `state`, `task`, `step`, `updated`, `output`), `agent-missions/<agent>-*.md` (waiting missions) and docs folders (outputs). Serves a JSON API plus Server-Sent Events (`/api/events`, message `change` means refetch). The JARVIS project has its own folder mapping at the top of the file; other projects use `docs/**`.
- Registered projects, and each agent's `emblem` and `type`, are stored in `projects.json` (gitignored, machine-specific).
- `design/agent-board.design.html` is the untouched Claude Design reference (runs standalone with mock data). **`public/index.html` is generated.** Never edit it by hand: change `design/build.js` (which swaps the mock layer for the real API and removes demo controls) and run `node design/build.js`. If a change belongs in the design itself, say so and edit the reference copy deliberately.
- `DESIGN-PROMPT.md` is the prompt that produced the design; `README.md` documents folders, config and security.

## Decisions already made (do not reverse without asking Liel)
1. One project in focus at a time; other projects appear only as folder tabs with a small status dot.
2. Motion means work: only running agents animate; idle agents barely breathe. No ambient background animation. Respect `prefers-reduced-motion`.
3. **No launcher.** A headless launch endpoint was designed and then dropped on purpose: it would run unattended file-editing agents from a web page, and Liel decided agents are run from Claude Code. Do not add `/api/run` or any code that spawns agent processes.
4. New agents get an emblem from a picker (nine job emblems plus a neutral orb), stored with the agent.
5. Visual direction: near-black desk, hairline rules, one signal colour for activity (see the design file's tokens). Geist and Geist Mono.

## Security rules (keep them)
- Server listens on `127.0.0.1` only, rejects any request whose Host header is not localhost, and every POST requires the `X-Board: 1` header (and a matching Origin if present).
- It only reads files inside each project's output folders, resolved through fixed roots (no path from the client is trusted). Agent and project names are validated; new agent files are written with the exclusive-create flag so nothing is overwritten.
- The server never executes anything.

## Known gaps and ideas (suggestions, none approved)
- Not yet verified in Firefox itself, only in the in-app browser. Check `color-mix`, `<dialog>`, `inert` and the animations there, and the light theme.
- Phone width was only checked for horizontal scroll on an earlier version, not for the current design.
- The New agent and Add project dialogs were exercised through the API, not clicked through in the UI.
- Each refetch runs `git log` once per project; fine now, worth caching if projects multiply.
- No way yet to remove a project, edit or delete an agent, or reorder tabs.
- The focused project is not remembered across reloads (the earlier version kept view state in the URL hash).
- Agent `updated` uses the status file's modification time; agents that never write a status file show as idle.

## Working notes
- The agents are defined per project in `.claude\agents\`; the JARVIS ones are in `C:\Users\lielc\Desktop\personalAi-testing\.claude\agents\`. They write their own status files; the board only reads them.
- If you use a shell heredoc to write JavaScript, backslashes can get halved. Prefer the file Write and Edit tools for code containing `\n`, `\t` or Windows paths.
- Test creation endpoints against a throwaway project in a temp folder and remove it afterwards; do not add test agents to Liel's real projects.
- Keep changes small, run `node --check server.js` and rebuild with `node design/build.js`, then look at the page before calling it done. Report what you verified by running it versus by reading it.
