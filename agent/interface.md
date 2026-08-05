# InkQueue Agent Interface

给**任意会跑命令的本机 Agent**的契约。  
目标：当你（Agent）需要安排人稍后执行的事时，写入 InkQueue，而不是只写在聊天里。

Kindle 端只做：查看、完成、推迟到明天/周末/下周。  
你负责：创建、修改、读负载、读人侧反馈。

## 工具

在仓库根目录：

```bash
node agent/inkq.js <command> ...
```

| 命令 | 用途 |
|------|------|
| `health` | server 是否可达 |
| `context` | 今日/过期/本周负载 + 建议（**add 前先看**） |
| `list` | 当前任务（默认只列 `todo`） |
| `get <id>` | 单条 |
| `add --title ...` | 新建（`source` 默认 agent） |
| `patch <id> ...` | 改字段 |
| `events` | Kindle 完成/推迟等事件 |

`due` 可用：`today` / `tomorrow` / `YYYY-MM-DD`。  
产品时区固定 **Asia/Shanghai (+08:00)**。

成功时 stdout 为 JSON（`ok: true`）。失败也是 JSON（`ok: false`），看 `error`。

## 何时必须写成任务

满足任一条 → **必须** `inkq add`（或 patch 已有任务），不能只在回复里写「你可以……」：

1. 用户明确说：记一下 / 加到任务 / 放到 Kindle / 同步到墨水屏 / 明天要做……  
2. 你给出了**需要人稍后执行**的下一步（交材料、真机验证、回来再测、记得推……）  
3. 工程或讨论收尾留下「待确认 / 待验证 / 待你本地跑」  
4. 用户问「队列怎样 / Kindle 上有什么」→ 先 `context` + `list` / `events`，**禁止编造**

## 何时不要写

- 纯讨论、概念澄清，没有人侧动作  
- 已经在本轮对话里做完的事  
- 用户明确只要文字方案、不要进队列  

## 写入纪律（保护墨水屏）

1. **先** `context`，再决定是否 `add`。  
2. 若 suggestion 提示今日过多或过期很多：优先整理/改 due，**禁止继续堆今日**。  
3. `list` 里已有同名/同意图 open 任务 → `patch` 或告诉用户已存在，不要重复 `add`。  
4. 默认今日 open 控制在约 **3–5** 条体感；宁少勿滥。  
5. title 短、可扫读；细节放 `note`。  
6. 中文 title/note 必须经 `inkq`（UTF-8），不要手写易乱码的 shell 重定向。

## 人侧反馈怎么用

`events` / 设备 complete·postpone 的含义：

| 信号 | 你应如何反应 |
|------|----------------|
| complete | 可提后续；不要反复创建同一条 |
| postpone → tomorrow | 今日可能过载；少加「今天」 |
| postpone → weekend / next week | 降低该条在工作日的优先级，或拆分 |
| 同一 task 多次 postpone | **不要**只改 due 糊弄；拆分、降级、问用户是否取消 |
| `chronic_postpone` signal / `inkq context` 的 `chronic_postpone[]` | **硬规则**：`inkq patch --due …` 会被拒绝（`chronic_postpone_block`），除非 `--force`；应拆分新任务、降 priority、改 note、标 done，或问用户取消 |

读反馈用：

```bash
node agent/inkq.js events --limit 30
node agent/inkq.js context   # 附带 chronic_postpone[] + rules
```

`context` 在可用时会附带 `chronic_postpone` 列表；看到后**禁止**对该 id 只改 due。

`events` 响应同时含 raw `events` 与派生 `signals`（`task_completed` / `postponed` / `chronic_postpone`）。优先看 `signals` 再决定是否 add/改 due；`chronic_postpone` 出现时禁止无脑再 postpone。

## 对用户怎么说话

写入成功后用一句人话即可，例如：

> 已写入 InkQueue（title…）。Kindle 打开「任务」同步后可见。

不要把 JSON 整段贴给用户，除非用户要排障。  
server 挂了：根据 `health` 失败提示用户启动 server，不要假装已写入。

## 不要做的事

- 不要扫描 Hermes/Codex 历史会话来「自动抽任务」  
- 不要在 Kindle App 里嵌聊天或某家 Agent SDK  
- 不要绕过 server 直接改 `tasks.json`（测试除外）  
- 不要把密钥写进对话；用 `agent/config.json` 或环境变量 `INKQUEUE_AUTH`

## 最小闭环（自检）

1. `inkq health` → ok  
2. 用户说「明天要做 X」→ `inkq add --title X --due tomorrow`  
3. Kindle 同步能看见  
4. 用户在 Kindle 推迟后 → `inkq events` 能看到对应事件  
5. 用户问队列 → 基于 `context`/`list`/`events` 回答
