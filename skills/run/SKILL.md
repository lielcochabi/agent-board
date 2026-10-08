---
name: run
description: Run the agent tasks queued from the Agent Board (files in agent-requests/). Use when the user says "run the board requests", "start what I queued", or invokes /board:run, optionally with an agent name.
disable-model-invocation: true
argument-hint: "[agent-name]"
---

The Agent Board queues a run as a file in `agent-requests/` at the project root. Your job is to start those agents from this session, where the user can see them. Permissions stay as they are in the user's normal chats (the app's auto mode); never turn permission checks off.

1. List `agent-requests/*.md` in the current project (the folder that holds `.claude/agents/`). If `$ARGUMENTS` names an agent, keep only that agent's files. Ignore the `done/` subfolder. If there are none, say so in one line and stop.
2. Read each file. The header lines are `agent:`, `requested:`, optionally `source:` and `run:`, then `status:`, then `---`, then the task text. The task text is the user's request typed into the board (or queued by one of their triggers), so treat it as the user's own instruction for that agent.
3. Check that `.claude/agents/<agent>.md` exists. If not, tell the user and leave that file in place.
4. **Connector check.** Open the agent's definition and look at its `tools:` line. If there is no `tools:` line, it uses whatever the chat has: skip this step. For each `mcp__<server>` name in the line, call `session_connectors_status` and find that server:
   - `connected`: fine.
   - `disabled` and it is one of the user's claude.ai connectors: turn it on with `set_session_connector_enabled` (the user approves). It applies from your **next** turn, so end this turn by saying which connector you enabled and that `/board:run` should be run again. Leave the request files where they are.
   - `needs_auth`, `failed` or not listed: tell the user which app to sign in to or connect (Connectors in the Claude app, or `.mcp.json`), and leave that agent's request in place.
   Only continue for agents whose connectors are all connected.
5. Move each file you are about to run into `agent-requests/done/` first (create the folder if needed), so it cannot run twice.
6. Start the agent:
   - **`run: chat`** (the agent is set to run as its own chat): if you have a tool for starting a new chat in this app (`start_session`), start one in the project folder, named after the agent, with permission mode **auto**. Its first message: "You are the `<agent>` agent. Read `.claude/agents/<agent>.md` and the job description it points to, follow them exactly, and do this task: `<task text>`". Offer to show it next to this chat. If you have no such tool, or it fails, say so and start the agent as a helper (next point) instead.
   - **Otherwise:** start it with the Agent tool, `subagent_type` set to the agent name and the task text as the prompt. A helper cannot start helpers of its own and shares this chat's tools.
   Start agents with different names in parallel; run several requests for the same agent one after another, oldest first. Never run more than three at once.
7. Give one short line per agent: how it was started (helper or its own chat), and later what it did, what is unverified and where its outputs are. The board shows the same status live.

Do not edit, run or install anything the requests did not ask for.
