# Prompt for Claude Design: Agent Board

Design a single-screen local web app called **Agent Board**. It is the control room for one person (a solo developer) who manages a crew of AI agents across several software projects. They glance at it all day to answer three questions: who is working right now, what did they produce, and what needs my attention.

## The big idea
The screen is divided by **project folder**. Each project is its own calm "bay" that contains only its own agents. Only one project bay is in focus at a time (decided: not all projects at once); the others are collapsed into a slim folder strip so the screen never feels full. Inside the focused bay, each agent is a **small animated emblem that represents its job**, with a futuristic, restrained, sci-fi control-room feel. It should feel alive when agents work and nearly still when they are idle.

## Feel
Futuristic, quiet, precise. Think mission-control HUD meets Linear: near-black desk, hairline rules, one signal colour for activity, soft glow only on things that are active. Generous empty space. Motion is slow and meaningful, never decorative noise. Dark by default, with a considered light theme.

Not wanted: card grids with big numbers, purple-to-blue gradient heroes, neon overload, dense tables, a sidebar crammed with everything.

## Layout
1. **Folder strip (top or left, slim):** one tab per project, shaped like a folder tab, with the project name, a small status dot that is the ONLY way activity in other projects is signalled (pulsing signal colour = something running, amber = blocked, red = failed, a brief check = something just finished, no dot = all idle). No notifications, no inbox. A "+" tab adds a project.
2. **Focused project bay (the main stage):** the agents laid out as a loose crew, not a table. Active agents sit forward and larger; idle agents are small, dim emblems with just a name. A "+ New agent" emblem slot sits at the end.
3. **Agent detail (slides in from the right when you click an agent):** current task, current step, last update time, then a clean list of that agent's output documents. Opening a document shows it as readable text in the same panel. Closing returns to the stage. Nothing else is on screen.
4. **Commits** live behind a small secondary control, not on the main screen.

Everything not essential is one click away, never visible by default.

## The agents (each emblem is animated to reflect what the agent does)
Design a distinct emblem and a distinct idle, working, done, blocked and failed animation for each. Keep them simple geometric line art that shares one visual language (same stroke weight, same glow rule).

| Agent | Job | Emblem idea (working animation) |
|---|---|---|
| scout | Researcher, investigates before anything is built | Radar or telescope reticle; a sweep line rotates and pings small points |
| compass | Planner, turns research into a build plan | Compass rose; the needle swings then locks onto a bearing, dotted route lines draw themselves |
| forge | Builder, writes the code | Anvil or hex-lattice; sparks and a lattice that assembles block by block |
| echo | Voice and prompt specialist | Audio waveform or concentric sound rings that pulse and shape-shift |
| sentry | Tester / QA | Shield with a scanning beam; checkmarks tick in along a test line |
| warden | Code reviewer | Balance scales or a lens; scales tilt and settle, flagged lines glow briefly |
| herald | Release manager | Beacon or horn; a signal ring expands outward when shipping |
| scribe | Docs keeper | Pen drawing ink lines that become text rows |
| custodian | Code quality auditor | Magnifier over a grid; cells light up as they are inspected |

New agents get their emblem from an **Appearance picker in the New agent form**: the nine emblems above plus a neutral orb, shown as a row of small selectable previews that animate on hover. The choice is stored with the agent (field `emblem`) and never changes on its own.

## States (must be readable without colour alone)
- **idle:** dim, nearly still: only a very slow breathing outline. No ambient background animation anywhere. Movement must mean "this agent is working", so running agents are the only things that really move.
- **running:** emblem animates, soft glow in the signal colour, small live step text under the name.
- **done:** settles into a calm filled state with a check, glow fades.
- **blocked:** amber, animation paused mid-motion, a small "waiting" mark.
- **failed:** red, a single flicker then still, a small "x" mark.
Respect `prefers-reduced-motion`: replace motion with static state glyphs.

## Run control
Each agent's detail panel has a **Run** control: a task text box ("What should it do?") and a Run button. While an agent runs started this way, its emblem animates and the step line streams short progress text; when finished it settles to done and links to its newest output. If launching is unavailable (not set up, or the server refuses), the same control falls back to showing a ready-to-copy sentence for pasting into Claude Code. Design both the live and the fallback state. Include a clear stop control while running.

## Content shown on screen (real data, not placeholders)
Each agent has: `name`, `role`, `emblem`, `state` (idle | running | done | blocked | failed), `task` (one line), `step` (one line), `updated` (timestamp), `missions` (number of waiting mission files). Each output document has: `name`, `kind` (Plans, QA, Research, Reviews, Audits, Missions, Docs), `agent`, `mtime`. Projects have: `name`, `root` folder path.

Use this realistic sample:
- Project **JARVIS**: scout (idle), compass (done: "voice context budget plan"), forge (done: "Fix OmniRoute response parse failure"), echo (idle, 2 missions), sentry (idle, 2 missions), warden, herald, scribe, custodian (idle).
- Project **Trading bot**: one agent "backtester" (running: "Running 2023 sample, step 4 of 9").
- Project **Smart cane**: no agents yet, shows the empty bay with a "+ New agent" prompt.

## Create flows (small, calm modal sheets)
- **New agent:** project, name, role, "when should it be used", type (Researcher / Reviewer / Builder, this controls tool permissions), appearance (emblem picker), "what does it do" text, optional write scope. Primary button "Create agent".
- **Add project:** name and folder path.
Show friendly inline errors. After creating an agent, show a one-line hint on how to run it in Claude Code.

## Technical constraints
- Plain HTML, CSS and vanilla JavaScript in a single page, no framework or build step, so it can drop into an existing Node server that serves `/public`.
- Data comes from a local JSON API (`/api/projects`, `/api/state?project=ID`, `/api/file?id=...`) and live updates arrive over Server-Sent Events (`/api/events`, message "change" means refetch). Design with this in mind; mock the data in the file.
- Animations in CSS or SVG (no heavy libraries). Smooth at 60fps with 10+ agents.
- Responsive: works at phone width; the folder strip becomes a horizontal scroller and the detail panel becomes a full-screen sheet.
- Accessible: visible focus rings, real buttons, state announced as text (not only colour or motion), good contrast in both themes.
- Fonts: Geist and Geist Mono from Google Fonts, or propose a better pairing with a stated reason.

## Deliver
A single HTML file with the full interactive design (project switching, agent detail panel, both modals, all five states shown on sample agents, dark and light themes), plus a short note on the motion rules so a developer can implement them.
