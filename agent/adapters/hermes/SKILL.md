---
name: inkqueue
description: "Manage Bao's InkQueue e-ink task queue (Kindle TodoList). Use when the user mentions 任务, Kindle, 墨水屏, InkQueue, todo, later/明天要做, or when you leave human follow-ups that should appear on the device."
---

# inkqueue

Drive the **InkQueue** server so tasks show up on the Kindle e-ink app.  
You do **not** read other products' session logs. You **call the CLI** when a human-side commitment should be queued.

## Repo

```text
D:/3_Code_Projects/InkQueue
```

CLI (from repo root, or absolute path):

```bash
node agent/inkq.js health
node agent/inkq.js context
node agent/inkq.js list
node agent/inkq.js add --title "..." --due tomorrow
node agent/inkq.js events --limit 20
```

Full contract: `agent/interface.md`（必须遵守「何时必须写成任务」与写入纪律）.

## Workflow

1. If server may be down: `node agent/inkq.js health`  
   - On unreachable: tell user to run `node scripts/server-ctl.js start` (do not invent success).  
2. Before adding: `node agent/inkq.js context` — honor `suggestion.note`.  
3. Create with UTF-8 via inkq only (never broken curl encoding):  
   `node agent/inkq.js add --title "..." [--note "..."] [--due today|tomorrow|YYYY-MM-DD] [--time HH:mm] [--priority high]`  
4. After device use / when user asks status: `events` + `list`.  
5. Reply briefly in 中文 if the user writes 中文: 已写入，Kindle 同步后可见.

## Do not

- Fabricate the queue without calling `list`/`context`
- Spam today's due dates when context says overload
- Put secrets in chat; CLI reads config/env
