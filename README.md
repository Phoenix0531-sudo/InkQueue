# InkQueue

**Agent-synced task queue for e-ink devices.**

A minimal task terminal for Kindle Paperwhite 3 (Android 4.4.2, KOSP/CracKDroid) where the AI Agent remotely maintains task data and the e-ink device handles lightweight viewing, completion, and postponement.

v0.9.1 · JVM + 30 server + 16 agent triage tests green · ~96 KB APK · minSdk 19 · zero AndroidX · agent CLI `inkq` · partial refresh · 今日已做 · LAN discover · chronic hard rules · triage · audit fields · webhook envelope

---

## Why

E-ink Kindles make poor touchscreens but excellent reading surfaces. Modern Material-style task apps overwhelm these devices — heavy dependencies, slow refresh, low contrast. InkQueue flips the model: the **Agent** does the heavy lifting (creating, organizing tasks through conversation), while the **Kindle** acts as a quiet display terminal for viewing, completing, and postponing.

| Constraint | Choice |
|---|---|
| Target device | Kindle Paperwhite 3, 6" e-ink, 512 MB RAM |
| OS | Android 4.4.2 (API 19) |
| Language | Java (no Kotlin, no Flutter, no Compose) |
| UI framework | Native `Activity` + Canvas self-draw (`InkMainView` / `InkDetailView`); Settings keeps `EditText` |
| HTTP | `HttpURLConnection` |
| JSON | `org.json` (Android built-in) |
| Storage | `SQLiteOpenHelper` + `SharedPreferences` |
| AndroidX / AppCompat / Material | **Not used** |

---

## Features (v0.8.2)

- Tabs: overdue / today / this week / later (Canvas self-draw, large e-ink type)
- Tap title for detail; tap checkbox to complete; long-press to postpone
- Complete + postpone tomorrow / weekend / next week (local first, then sync)
- Offline operation queue with visible “待同步 N 条”
- Settings: API base URL, token, device ID (same design system as main UI)
- Agent interface layer: `node agent/inkq.js` + `agent/interface.md` (**no skill required**)
- Events + agent context APIs for closed-loop scheduling
- Real device verified on Kindle Paperwhite 3 (KOSP / CracKDroid, Android 4.4.2)

---

## Layout

```
InkQueue/
  README.md
  AGENTS.md              # one-page entry for any coding agent
  agent/                 # Agent interface layer (CLI + contract + thin adapters)
    inkq.js              # universal CLI: health/context/list/add/patch/events
    interface.md         # when an agent MUST write a task
    adapters/            # optional: skill snippets + mcp-inkqueue (not main path)
  docs/
    architecture.md      # system diagram (android / server / agent)
    product-spec.md      # product requirements
    api.md               # REST API reference (snapshot / operations / webhook)
    development.md       # build & test guide
    screenshots/         # real device captures
  android/
    settings.gradle
    build.gradle
    app/
      build.gradle       # minSdk 19, no AndroidX
      src/main/
        AndroidManifest.xml
        java/dev/inkqueue/
          MainActivity.java          # task list home
          TaskDetailActivity.java    # detail + actions
          SettingsActivity.java      # API URL / token / device ID
          data/
            Task.java                 # task model
            TaskRepository.java       # SQLite CRUD
            InkQueueDatabase.java     # schema v2
            PendingOperation.java     # operation queue entry
            OperationQueue.java
          sync/
            SyncClient.java           # HttpURLConnection client
            SyncResult.java
            SyncService.java          # orchestration: post ops, fetch snapshot
          ui/
            InkMainView.java          # Canvas home (tabs / list / footer)
            InkDetailView.java        # Canvas detail + actions
            SectionedTaskList.java    # overdue/today/week/later grouping
          util/
            DateUtils.java            # Asia/Shanghai timezone, postpone rules
            JsonUtils.java            # org.json snapshot parser
            IdUtils.java
            TimeProvider.java
        res/
          values/
            strings.xml
            colors.xml
            styles.xml
  server/
    README.md
    package.json
    src/
      server.js            # Node HTTP server (built-ins; JSON file store)
    data/
      tasks.json
    test/
      api.test.js          # 28 Node tests
  scripts/
    server-ctl.js
  tests/
    api-examples/
      snapshot.json
      operations.json
      webhook-agent.md
```

---

## Build the Android APK

Requirements: JDK 17+, Android SDK with `platform-tools` and `platforms;android-35`, Gradle 8.x (a wrapper is included under `android/`).

```bash
cd android
./gradlew clean testDebugUnitTest assembleDebug --rerun-tasks
```

The debug APK lands at:

```
android/app/build/outputs/apk/debug/app-debug.apk
```

Verified build / device result (this repo, 2026-08-05):

```
APK: android/app/build/outputs/apk/debug/app-debug.apk
versionName 0.8.2 / versionCode 82
size ~96,000 bytes (~96 KB)
JVM unit tests green (DateUtils / SectionedTaskList / PendingOperation / JsonUtils / SyncResult)
Node server tests 30/30 (events / context / webhook envelope)
Agent triage tests 16/16 (lib/triage.js pure logic)
Root npm test orchestrates agent + server suites
Kindle PW3 e2e: snapshot sync + complete + postpone via inkq-written tasks
```

---

## Start the reference server

```bash
cd server
npm install
npm start          # default port 8787
# or
INKQUEUE_PORT=9000 npm start
```

Health check:

```bash
curl http://localhost:8787/v1/health
# {"ok":true}
```

Run server tests:

```bash
npm test
# 28 passing
```

---

## Configure the app

On first launch the app expects a server URL. Open **设置** (long-press the title, or tap the **设置** footer button) and set:

| Field | Default | Example |
|---|---|---|
| API 地址 | empty | `http://192.168.x.x:8787` |
| Token | `dev-token` | `dev-token` |
| 设备 ID | `kindle-pw3` | `kindle-pw3` |

For LAN testing the URL is `http://<your-PC-WLAN-IP>:8787`. The Kindle and the PC must be on the same subnet. On Windows, allow inbound TCP on port 8787 through the firewall:

```powershell
# Run in an elevated PowerShell
netsh advfirewall firewall add rule name="InkQueue TCP 8787" dir=in action=allow protocol=TCP localport=8787
```

Production should use HTTPS with a real proxy in front of the Node server.

---

## Install the APK on a Kindle

```bash
# Enable ADB on the Kindle (Developer Options → ADB over WiFi or USB)
adb connect <kindle-ip>:5555     # or use USB
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

The home-screen icon is labeled **任务**.

---

## Create a task (via the Agent webhook)

```bash
curl -X POST http://localhost:8787/v1/webhook/agent \
  -H "Content-Type: application/json" \
  -H "X-InkQueue-Token: dev-token" \
  -d '{
    "event_id": "demo-001",
    "task": {
      "title": "整理 BootSem 文档",
      "note": "给 juniors 的说明材料",
      "due_date": "2026-08-02",
      "due_time": "14:00",
      "priority": "normal"
    }
  }'
```

Or use the older create endpoint:

```bash
curl -X POST http://localhost:8787/v1/tasks \
  -H "Content-Type: application/json" \
  -H "X-InkQueue-Token: dev-token" \
  -d '{"title":"看盐构造 DEM 论文","due_date":"2026-08-02","due_time":"晚上","priority":"normal"}'
```

Pull the snapshot to verify:

```bash
curl -H "X-InkQueue-Token: dev-token" http://localhost:8787/v1/tasks/snapshot
```

### Preferred path for agents (or plain shell)

**No skill required.** Do **not** hand-roll curl. Use the in-repo CLI:

```bash
node agent/inkq.js health
node agent/inkq.js context
node agent/inkq.js add --title "整理 BootSem 文档" --due tomorrow --time 14:00
node agent/inkq.js list
node agent/inkq.js events --limit 20
```

- Contract: [`agent/interface.md`](agent/interface.md)
- Architecture: [`docs/architecture.md`](docs/architecture.md)
- Smoke: `node agent/test-inkq-smoke.js` (server up)
- `agent/adapters/` is optional reference only — default path does not install any skill

Kindle never talks to any agent product; agents only talk to `server/` via `inkq`.

---

## Verify completion / postponement sync

The device writes pending operations locally first (instant UI feedback), then replays them on the next sync. The server owns `completed_at` and `updated_at` — device-supplied timestamps are ignored for authoritative state.

1. Open the app on the Kindle. The home page loads from local cache, then background-syncs.
2. Tap a task to open **任务详情**.
3. Tap **完成**. The task disappears from the home list, and `last_sync_time` updates.
4. Server-side, `GET /v1/tasks/snapshot` now shows the task with `status: "done"` and a server-stamped `completed_at`.
5. Repeat with **推迟到明天** / **推迟到周末** / **推迟到下周** and confirm `due_date` moves on the server.

### Real-device E2E results (2026-08-01, Kindle Paperwhite 3 / KOSP)

Operation: complete `提交竞赛材料` (`task_mrup8n8w_7d46ccb9`)

| Field | Before | After |
|---|---|---|
| `status` | `todo` | `done` |
| `completed_at` | `null` | `2026-08-01T22:35:52+08:00` (server-stamped) |
| `updated_at` | `2026-07-21T21:38:32+08:00` | `2026-08-01T22:35:52+08:00` |
| Device `pending_operations` | 0 queued | 0 (cleared after ack) |
| Device `last_sync_time` | stale | `2026-08-01T22:35:52+08:00` |

Operation: postpone `修改新文章` (`task_mrup8na0_d8f6813f`) to tomorrow

| Field | Before | After |
|---|---|---|
| `due_date` | `2026-07-12` | `2026-08-02` (tomorrow, Asia/Shanghai) |
| `due_time` | `null` | `null` (preserved) |
| `updated_at` | `2026-07-21T21:38:32+08:00` | `2026-08-01T22:37:08+08:00` |
| Device local state | mirrored server after sync | ✓ |

UI dump after the operations confirmed: title `任务`, status `已同步 22:35`, sections `今日` / `本周`, footer buttons `同步` / `设置` — no CPA dashboard content.

### v0.3 real-device E2E results (2026-08-02, Kindle Paperwhite 3 / KOSP)

**P1 翻页主页**: four tabs `过期 / 今日 / 本周 / 以后` each rendered as its own `ViewFlipper` page; auto-opens to `过期` if there are overdue tasks, otherwise `今日`:

```
任务  ·  已同步 09:04
过期  今日  本周  以后
─────
已过期
全部推迟到今天   ← P6 bulk-action row
全部推迟到明天
□  跑大宛齐高宽比数据
   已过期 21 天
```

**P2 + P3 + P4**: tap `□` (92×92px independent View) on `修改新文章` → server `status=todo→done`, Toast `已完成`, task disappears; tapping title still opens detail page; long-press title opens AlertDialog `推迟到明天 / 推迟到周末 / 推迟到下周`; when 今日 has only does-nothing open tasks, page reads `今天的事做完了。`

**P6 批量推迟**: tap `全部推迟到今天` → UI immediately shows `没有过期任务。`; server updates overdue task `due_date=2026-07-12 → 2026-08-02`, `updated_at=2026-08-02T09:05:26+08:00` (server-stamped).

**P5 /v1/events**: Agent polling/confirms new events carry full `type` (complete/postpone), `task_id`, `task_title`, `occurred_at`, `payload` (e.g. `{due_date, postpone_target}`). Test session after device completed `修改新文章`:

```json
{
  "event_id": "op_1785632760234_5c22bf",
  "type": "complete",
  "task_id": "task_mrup8na0_d8f6813f",
  "task_title": "修改新文章",
  "occurred_at": "2026-08-02T09:06:03+08:00",
  "payload": {}
}
```

**P7 /v1/agent/context**: Agent views current rhythm before pushing new tasks:

```json
{
  "today_date": "2026-08-02",
  "open": { "overdue": 1, "today": 1, "this_week": 0, "later": 1, "total": 3 },
  "done_total": 10,
  "completed_last_7d": 5,
  "device_activity_24h": { "completes": 1, "postpones": 0 },
  "suggestion": { "note": "节奏正常，可继续按过去 7 天节奏安排本周任务" }
}
```

**P8 outbound agent webhook**: server forwards each device event to a configurable `agent_webhook_url` (fire-and-forget). Unit test `P8 outbound agent webhook fires on complete operation with envelope` 30/30 passing (envelope `inkqueue.device_event.v1`).

Test totals (2026-08-05):
- Android: version 0.8.2 / ~96 KB APK; JVM unit tests green
- Node API tests: 30/30 (events / context / webhook envelope covered)
- Agent triage tests: 16/16 (`agent/lib/triage.js` pure logic)
- Root `npm test` orchestrates both suites
- Agent layer: `node agent/test-inkq-smoke.js` live pass (no skill required)
- Device e2e: inkq add → Kindle sync → complete/postpone → `inkq events`

### v0.6 device screenshots (Kindle Paperwhite 3, 1072×1448 e-ink)

v0.6 把 Canvas 自绘推进到了"墨水屏工作手册"的标准:全部字号上调一档(masthead 24→30sp, tabs/section 17/18→22/24sp, task title 17→22sp, meta 13→17sp, detail title 22→26sp, actions 18→22sp),PAD 36→40,checkbox 32→44px,row 行高 56→68/76,触控区都≥68px。同时按"墨水屏工作手册哲学"实现四件事:

1. **常亮"桌面"模式(default-on)** — MainActivity 加 `FLAG_KEEP_SCREEN_ON` + `screenBrightness=0.25` + 1小时 `PARTIAL_WAKE_LOCK`。Kindle 在桌上常亮当"今日任务板",不是手机"App 关掉后再打开"心智。
2. **离线队列可见** — masthead 状态行除了"已同步 HH:mm",还会显示" · 待同步 N 条"。让 PendingOperation 这套机制不是黑箱,墨水屏用户能"看见"自己的本地操作等在哪。
3. **详情页列出"最后由 Agent 更新 HH:mm"** — Task 的 `updated_at` 是 server-owned 字段,详情页 meta 列从 3 行扩到 4 行,把"Agent 14:10"这条信息明示出来。配合 PendingOperation + 服务端幂等 id,把 server-owned timestamp 暴露给用户而不是藏在日志里。
4. **字变大** — 前面字号方案。

- 今日 page — `docs/screenshots/main-today.png` — `任务 · 待同步 2 条 已同步 HH:mm / 今日 / 任务标题 22sp / 元 17sp / 同步 / 设置 22sp`
- 过期 page — `docs/screenshots/main-overdue.png` — `已过期 / 没有过期任务。`
- 本周 page — `docs/screenshots/main-week.png` — `本周 / 本周没有任务。`
- 以后 page — `docs/screenshots/main-later.png`
- 长按推迟 AlertDialog — `docs/screenshots/main-longpress.png`
- 任务详情 page — `docs/screenshots/main-detail.png` — Canvas 自绘 4 行 meta 列:时间/项目/优先级/**更新 (Agent HH:mm)**
- 设置 page — `docs/screenshots/main-settings.png` — 同步地址 / Token / 设备 ID 三个 20sp EditText 坐在 1px 黑基线上,22sp 保存/返回按钮

**字号增幅证据**(`main-today.png` 对比 v5):
- y=[40-59] 从 269 黑像素 ↑ → 668 (title 30sp 字面变大 ~2.5x)
- y=[220-239] 从 0 ↑ → 1146 (24sp section header 比原来更靠下且字面更宽)
- y=[280-299] 从 111 ↑ → 1386 (22sp task title + 17sp meta pixel count ~12x)

WAKE_LOCK 权限已在 AndroidManifest 声明。`PREFS.always_on=true` 是默认值,设置页暂未暴露 toggle按钮(因为 settings 已经够多输入了,空一行加 toggle 会更挤)——v0.6.1 计划加。

### v0.7 device screenshots (Kindle Paperwhite 3, 1072×1448 e-ink)

v0.7 把已知 14 条改动一次性落地，依据 ACM CHI'26 e-paper 设计系统论文 §3.3.1 Navigation Bar / §3.3.3 Scrollbar / §3.4 Buttons 的实验结论。详见 `docs/design/ui-audit-v0.7.md`。

**改动清单（A 档 layout / B 档 weight / C 档 hierarchy）**

| # | 档 | 改动 | 原值 → 新值 | ACM 依据 |
|---|---|---|---|---|
| 1 | A | masthead 顶部留白 | 32 → 58 | §3.3.2 spacing over color |
| 2 | A | masthead 标题字号 | 30 → 32 | §3.3.2 font weight |
| 3 | A | masthead status 行 | title 同行小字 → 独立成行 | §3.3.2 |
| 4 | A | masthead status 字号 | 17 → 18 | §3.3.2 |
| 5 | A | footer 去掉中间竖线分隔 | 1px 竖线 → 仅两段大字号区 | §3.3.1 no gray/colored backgrounds |
| 6 | A | row 行内 padding | 28 → 36 | §3.3.4 button row height |
| 7 | A | section 上下 padding | 32/14 → 48/22 | §3.3.2 |
| 8 | B | tab bar 高度 | 68 → 92 | §3.3.1 |
| 9 | B | tab 选中下划线粗细 | 3px → 5px | §3.3.1 thick black line |
| 10 | B | tab 选中/未选中字号差异化 | 全 22sp → 选中 26sp bold / 未选 22sp | §3.3.1 bold text for selected |
| 11 | B | footer 字号 + 高度 | 22sp @ 110 → 26sp @ 140 | §3.3.4 button row height |
| 12 | B | checkbox 尺寸 + stroke | 44px @ 1.5 → 36px @ 2.0 stroke | §3.3.1 contrast |
| 13 | C | section / task / meta 字号 | 24/22/17 → 28/24/18 | §3.3.2 font weight hierarchy |
| 14 | C | 多任务提示 | 无 → footer 上方 `还有 N 项 · 长按同步查看全屏` | §3.3.3 discrete paged scroll |

另：所有 `Color.BLACK` 替换为 `PURE_BLACK = 0xFF000000`，强制 e-ink 100% 对比度（两处构造函数）。

- 今日 page — `docs/screenshots/v7-today.png` — 23,240B / 15,728 黑像素
- 过期 page — `docs/screenshots/v7-overdue.png` — 22,952B / 14,548 黑像素
- 本周 page — `docs/screenshots/v7-week.png` — 22,055B / 13,840 黑像素
- 以后 page — `docs/screenshots/v7-later.png` — 23,159B / 15,621 黑像素
- 任务详情 page — `docs/screenshots/v7-detail.png` — 29,596B / 19,047 黑像素
- 设置 page — `docs/screenshots/v7-settings.png` — 73,580B / 86,105 黑像素（v0.7 未改 settings）

**v0.6 vs v0.7 像素黑量增量证据**：今日 +1,544 (+11%) / 过期 +1,695 (+13%) / 本周 +1,285 (+10%) / 以后 +1,545 (+11%) / 详情 +2,135 (+13%) / 设置 +0 (未改)。汇编后 `compileDebugJavaWithJavac` 通过，APK 78,306 字节（v0.6 是 77,810B，+496B）。`adb install -r` 成功在 Kindle PW3 (06702091551305IY)，对应 `InkMainView.java` 21,034B / `InkDetailView.java` 10,705B。

**Known regression caveat**：masthead 因 title+status 拆成两行，整体下移 ~80px，tab bar 从 y=52 移到 y=136，task row rules 从 y=325 移到 y=493。这是预期的——但 Kindle 4.4 「header 只占一行」的老用户第一次开 v0.7 会感觉布局变化，需提示这是设计调整。Settings 页未在 v0.7 改（14 条改动聚焦 InkMainView/InkDetailView）。Vision API 因 429 限流本次未能做带视觉的对比验证，证据来自源码常量分析 + PIL 像素扫描两套独立手段。

### v0.8 device screenshots (Kindle Paperwhite 3, 1072×1448 e-ink)

v0.7 没有触及 SettingsActivity——它还是 v0.5 时代的 ScrollView + LinearLayout + TextView/EditText 结构，跟 InkMainView/InkDetailView 的 v0.7 设计系统完全脱节。v0.8 把 SettingsActivity 拉进同一个设计系统，统一字号、行高、padding、rule 粗细、加粗权重——但**保留 ScrollView/LinearLayout/EditText** 而非换成纯 Canvas 自绘，因为 EditText 必须挂到 Android 软键盘输入法（这是 settings 唯一需要键盘的页面，不是查看页）。

**改动清单**（10 条 — SettingsActivity 对齐 v0.7 设计系统）：

| # | 改动 | 原值 (v0.7) → 新值 (v0.8) | 同步源 |
|---|---|---|---|
| 1 | 返回任务 link 字号 | 18 → 20sp | InkDetailView.BACK_SP |
| 2 | 设置 标题字号 | 30 → 32sp | InkMainView.TITLE_SP |
| 3 | masthead rule 粗细 | 1px → 2px | InkMainView.RULE_MASTHEAD_H |
| 4 | masthead rule 位置 | y=286 → y=300 | 同步 v0.7 masthead 下移 |
| 5 | 字段 label 字号 | 18 → 20sp + 加粗 | InkDetailView.META_KEY_SP |
| 6 | 字段 value 字号 | 20 → 22sp | InkDetailView.META_VAL_SP |
| 7 | 字段间距 | 22 → 30px | v0.7 SECTION_GAP |
| 8 | 保存 action 字号 | 22 → 26sp bold | InkMainView.FOOTER_SP |
| 9 | 返回 action 字号 | 22 → 24sp | InkDetailView.BACK_BTN_SP |
| 10 | action rule 粗细 + 行高 | 1px @ 72 → 2px @ 84 | InkDetailView.ACTION_ROW_H |

另：所有 `Color.BLACK` 替换为 `PURE_BLACK = 0xFF000000`，关闭 ScrollView 的水平/竖直 scrollbars（避免 v0.7 settings 截图上出现的 scroll 条 artifact）。

- 设置 page — `docs/screenshots/v8-settings.png` — 74,312B / 95,385 黑像素

**v0.7 → v0.8 像素黑量增量证据**（按 y 段量化）：
- 系统+back link+标题 y=60-250：6,641 → 6,504 (-137, 系统 bar 残影略减但视觉一致)
- 规则+第一字段 label y=250-470：6,052 → 8,479 (**+2,427**, label 20sp bold 出来)
- 第一字段 value+第二 label y=470-660：54,292 → 60,323 (**+6,031**, value 22sp + label 加粗)
- 第二/三字段+action 开始 y=660-820：2,059 → 1,945 (-114, 间距更紧凑)
- **action rows 保存/返回 y=820-940：3,301 → 4,428 (+1,127, 「保存」action label 真的画出来了 — v0.7 这里只有 1px rule 后接空白，v0.7 实际上没显示 action 标签)**
- 系统 bottom y=940-1448：13,706 → 13,706 (0, 跟 v0.7 一致)

总黑像素增量 +9,280 (+10.8%)，集中在三个有意义的区域：字段 label/value 加粗加大、action row 加粗加大并真显示出来。**v0.7 settings 有一个隐性 bug：action row 「保存」/「返回」因 ScrollView 焦点抢占被挤到屏幕外看不到 — v0.8 通过重新设计 layout 把它们拉回 y=830-854 可见区域**。APK 78,623 字节（v0.7 是 78,306B，+317B）。`adb install -r` 成功在 Kindle PW3，SettingsActivity 重启正常进入，back link 触控仍正常返回 MainActivity。

---


### Outbound webhook (device → Agent)

When Kindle uploads `complete` / `postpone`, the server POSTs a fire-and-forget envelope to:

- env `INKQUEUE_AGENT_WEBHOOK_URL`, or
- `agent_webhook_url` in `server/data/config.json`

Envelope shape:

```json
{
  "schema": "inkqueue.device_event.v1",
  "server_time": "2026-08-05T09:00:00+08:00",
  "event": {
    "event_id": "op_…",
    "type": "complete",
    "task_id": "task_…",
    "task_title": "…",
    "occurred_at": "…",
    "payload": {}
  },
  "signal": {
    "kind": "task_completed",
    "task_id": "task_…",
    "title": "…",
    "at": "…",
    "advice": "可提后续；勿重复 add 同意图"
  }
}
```

Local sink for testing:

```bash
node scripts/webhook-echo.js
# then set agent_webhook_url to the printed URL and complete a task
```

Agent can still poll `GET /v1/events` / `inkq events`; webhook is the reverse real-time path.

## Known limitations (v0.9.1)

- No push notifications — sync is pull-only on app open or manual tap.
- No multi-user / auth system — single `X-InkQueue-Token` shared between Agent and device.
- The reference server persists to a JSON file; production can swap D1/KV or a real DB.
- Project field is shown when present; empty project is fine.
- Postponement moves `due_date` and **preserves** existing `due_time` (does not invent one).
- Pending-operation replay is best-effort; ops that fail many consecutive syncs are dropped.
- ADB on KOSP/CracKDroid can drop to `offline` after sleep; wake the device to restore.
- HTTP cleartext is for LAN testing. Prefer HTTPS in production.
- Agent layer does **not** scan chat history; agents must actively call `inkq`.
- Partial refresh is best-effort on stock Android 4.4 (no vendor e-ink partial API); still dirties less than full `invalidate()`.
- LAN UDP discovery needs server running and same Wi‑Fi; some APs block broadcast.

---

## Roadmap

### Shipped core
- v0.1–v0.2: native Java client, snapshot/operations, server-owned timestamps, inbound agent webhook
- v0.3: tab pages, checkbox complete, long-press postpone, bulk overdue, `/v1/events`, `/v1/agent/context`, outbound webhook
- v0.4–v0.5: Canvas self-draw main/detail (no ListView/TextView primary UI)
- v0.6–v0.7: larger type, always-on desk mode, e-paper design-system pass
- v0.8 / v0.8.2: Settings design-system alignment; SQLite singleton (no connection leak); ~50 KB APK on PW3

### Shipped (agent interface layer, 2026-08-04)
- `agent/inkq.js` universal CLI (health/context/list/get/add/patch/events)
- `agent/interface.md` hard contract: unfinished human actions must become tasks
- `AGENTS.md` + `docs/architecture.md` — same-repo, clear layers, **no skill required**
- Live smoke + Kindle e2e: inkq add → device sync → complete/postpone → events

### Future (separate projects, not InkQueue core)
- Daily briefing app / RSS / career radar / WeChat Reading sidecar

### Shipped (v0.9.1 protocol deepen)
- Conflict v2: agent text vs device lifecycle field ownership; client preserves pending local status/due on snapshot
- Commitment fields: optional `why` / `source_session` on add
- `inkq triage [--apply] [--today-cap N]` bulk rearrange
- Outbound webhook envelope `inkqueue.device_event.v1` (HTTPS-capable)

### Shipped (v0.9.0 experience pass)
- Partial list reflow + checkbox flash on complete/postpone (less full-screen flash)
- Tab **已做** — today’s completed archive
- `inkq context` surfaces `chronic_postpone[]`; due-only patch blocked unless `--force`
- `server-ctl install|uninstall` — Windows logon auto-start
- Settings **探测同步地址** (UDP `InkQueue:ping` → server pong)

### Later candidates (same product)
- Vendor e-ink partial refresh API if available on KOSP
- Optional MCP wrapper around `inkq` (shipped thin; keep optional)

---

## License

MIT. See [LICENSE](LICENSE).
