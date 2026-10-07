---
name: icons
description: Draw the emblems requested from the Agent Board (files in agent-emblems/*.request.md). Use for /board:icons, or when the user says "draw the agent icons" or asks for a new icon for an agent.
disable-model-invocation: true
argument-hint: "[agent-name]"
---

The Agent Board asks for an agent's icon by writing `agent-emblems/<agent>.request.md` in the project root. Each request file is a complete, self-contained drawing brief: it names the exact SVG file to write, the allowed format and animation classes, and what the user asked for.

1. List `agent-emblems/*.request.md` in the current project (the folder that holds `.claude/agents/`). If `$ARGUMENTS` names an agent, keep only that one. If there are none, say so in one line and stop.
2. For each request, read the file and follow it exactly. Draw one emblem per agent. Several can be drawn in parallel by separate subagents if there are many, but a single one is fine to do here.
3. Write only the two things each request names: the `.svg` file, and moving the request into `agent-emblems/done/`.
4. Finish with one line per agent saying what you drew. The board picks the icons up live.

Do not touch anything else in the project.
