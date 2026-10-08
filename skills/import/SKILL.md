---
name: import
description: Send your Claude scheduled tasks and chats (the Code-tab sessions in the Claude app) to the Agent Board so they can be turned into agents. Use for /board:import or when the user asks to import chats or scheduled tasks into the board.
disable-model-invocation: true
---

The board cannot see your chats or scheduled tasks by itself. This command reads the lists with the Claude app's own tools and posts them to the local board, where the **Import** button turns each one into an agent. Nothing is created until the user picks an item in the board.

1. Gather the lists. These tools exist only in the Claude desktop app; if they are not available, say so and stop.
   - Scheduled tasks: call `list_scheduled_tasks`. For each task, read the file at its `path` (its SKILL.md) to get the prompt. Keep `taskId`, `title`, `description`, `schedule`, `cronExpression` and the prompt text.
   - Chats: call `list_sessions` (limit 30, not archived). Keep `sessionId`, `title`, `cwd`, `lastActivityAt` (as a number of milliseconds) and `link`. Do **not** read the chats' contents.
2. Write one JSON file in the scratchpad or temp folder: `{"items":[ ... ]}` where each item is `{"kind":"scheduled","id":"<taskId>","title":...,"description":...,"prompt":...,"cron":"<cronExpression>","schedule":"<schedule>"}` or `{"kind":"session","id":"<sessionId>","title":...,"cwd":...,"lastActivity":<ms>,"link":"<link>"}`.
3. Post it to the board (start it first with `/board:open` if it is not running):
   `curl -s -X POST http://localhost:4747/api/imports -H "x-board: 1" -H "content-type: application/json" --data @<file>`
4. Tell the user how many scheduled tasks and chats were sent, and to press **Import** in the board.

Plain chats on claude.ai are not visible to Claude Code. If the user wants those as agents, they use **New agent** in the board and describe what the chat was for.
