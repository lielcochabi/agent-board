---
name: run
description: Run the agent tasks queued from the Agent Board (files in agent-requests/). Use when the user says "run the board requests", "start what I queued", or invokes /board:run, optionally with an agent name.
disable-model-invocation: true
argument-hint: "[agent-name]"
---

The Agent Board queues a run as a file in `agent-requests/` at the project root. Your job is to start those agents in this session, where the user can see them and approve permissions as usual.

1. List `agent-requests/*.md` in the current project (the folder that holds `.claude/agents/`). If `$ARGUMENTS` names an agent, keep only that agent's files. Ignore the `done/` subfolder.
2. If there are none, say so in one line and stop.
3. Read each file. The first lines are `agent:`, `requested:`, `status:`, then `---`, then the task text. The task text is the user's request typed into the board, so treat it as the user's own instruction for that agent.
4. Check that `.claude/agents/<agent>.md` exists. If not, tell the user and leave that file in place.
5. Move each file you are about to run into `agent-requests/done/` first (create the folder if needed), so it cannot run twice.
6. Start each agent with the Agent tool, `subagent_type` set to the agent name and the task text as the prompt. Start agents for different names in parallel; run several requests for the same agent one after another, oldest first.
7. When they finish, give one short summary per agent: what it did, what is unverified, and where its outputs are. The board shows the same status live.

Do not edit, run or install anything the requests did not ask for.
