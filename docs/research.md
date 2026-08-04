# InkQueue 同类产品调研与用户需求分析

> 调研时间：2026-08-01
> 调研方法：GitHub API + Firecrawl agent + 搜索引擎摘要
> 调研范围：墨水屏专用 App、极简 Android Todo、Agent-synced/Local-first 系统、用户讨论帖

---

## 一、GitHub 调研结果

### 1.1 墨水屏专用 App / Kindle Hack 工具

| 项目 | Stars | 技术栈 | 与 InkQueue 关系 |
|---|---|---|---|
| [number317/BookLauncher](https://github.com/number317/BookLauncher) | 2 | JS+Java(RN) | **最相关** — CracKDroid/Android 4.4 专用启动器，InkQueue 必须与之共存 |
| [gezimos/inkOS](https://github.com/gezimos/inkOS) | 441 | Kotlin, Android 10-16 | 文本式 E-ink launcher，美学可参考但 Kotlin 不符合约束 |
| [perduewu-ops/kindle-side-card](https://github.com/perduewu-ops/kindle-side-card) | 32 | Python | Kindle 当副屏 — 反向参考，InkQueue 要当主屏 |
| [vroland/epdiy](https://github.com/vroland/epdiy) | 1.9k | C/ESP-IDF | 硬件驱动板，非软件定位 |
| [PaperTTY](https://github.com/...papertty) | ~1k | Python | 在 e-ink 上渲染 TTY/VNC，非任务管理 |
| [liguobao/kanshan-kindle-crackdroid](https://github.com/liguobao/kanshan-kindle-crackdroid) | ~1 | Shell | KPW3 刷机指南，InkQueue 的基础设施 |
| [Ooonana/Guide-to-installing-android-on-kindle](https://github.com/Ooonana/...) | 21 | - | CracKDroid 安装指南 |

**关键发现**：BookLauncher 是与 InkQueue 目标设备完全一致的启动器，但它是 EN/UI、未涉及任务管理。KOSP/CracKDroid 生态里**没有一个专门的中文任务管理 App**。

### 1.2 极简 Android Todo (原生 Java, 无重依赖)

| 项目 | Stars | 技术栈 | minSdk | 借鉴点 |
|---|---|---|---|---|
| [avjinder/Minimal-Todo](https://github.com/avjinder/Minimal-Todo) | 2.2k | Java+Material+SQLite | 16 | 最受参考；但 Material 风格不适合墨水屏 |
| [todotxt/todo.txt-android](https://github.com/todotxt/todo.txt-android) | 1.2k | Java+Dropbox+纯文本 | - | **plain-text + sync 哲学**最接近 InkQueue 理念；Dropbox SDK 太重 |
| [luong-komorebi/Minitask](https://github.com/luong-komorebi/Minitask) | 28 | Java+SQLite | 21 | 体积控制典范 (<5MB) |
| [Malenea/ToDoList](https://github.com/Malenea/ToDoList) | 0 | Java+SQLite+RecyclerView | **19** | **约束最接近 InkQueue**，但功能太简 |
| [udacity/ToDoList](https://github.com/udacity/ToDoList) | 9 | Java+ContentProvider+SQLite | - | 教学级 ContentProvider 模式 |

**关键发现**：11 个纯 Java todo 项目里**只有 2 个 minSdk ≤ 19**，**没有一个为墨水屏优化过 UI**。这就是 InkQueue 的细分赛道。

### 1.3 Local-first / Server-synced 系统

| 项目/资源 | 技术栈 | 借鉴点 |
|---|---|---|
| [sqliteai/sqlite-sync](https://github.com/sqliteai/sqlite-sync) | SQL CRDT | CRDT 离线冲突解决思路；但对 512MB RAM 太重 |
| [github.com/topics/offline-sync](https://github.com/topics/offline-sync) | 多语言 | 队列+sync 模式 — InkQueue 已采用 (pending_operations) |
| SyncVault (Swift) | Swift | iOS 端队列 API 自动重放 |
| HN "Offline First" 讨论 | - | 概念参考：local DB + 周期 sync |

**关键发现**：InkQueue 的 Snapshot+Operations API 模式是现代 local-first 系统的标准模式（参考 Replicache/ElectricSQL），但**没有一个 local-first 框架是为 Android 4.4 / 512MB RAM 设计的**。

### 1.4 墨水屏用户讨论帖（搜索摘要）

| 来源 | 标题 | 用户期待 |
|---|---|---|
| Reddit r/eink | "eInk device as a task manager always on display?" | 想要常显任务列表，减少开手机次数 |
| Reddit r/eink | "Best e-ink tablet for To Do Lists" | Supernote todo 被评 "mediocre at best" |
| Reddit r/eink | "E-Ink for task management" | 想要小屏+触控+可划掉任务 |
| Reddit r/eink | "E-Ink tablet for Task/To-Do within notes?" | 想在笔记里嵌任务 |
| Facebook Supernote | "Best e-ink device for planning and calendar syncing?" | 寻找同步好的方案 |
| MacPowerUsers | Boox 使用体验 | "Syncing could not really understand how it works" |

---

## 二、用户痛点总结

### 2.1 墨水屏做任务管理的痛点（来自搜索摘要）

1. **输入差** — 所有现有墨水屏 todo 都要手写（Supernote/Boox/reMarkable），慢且易错
2. **同步差** — Boox Sync "could not really understand how it works"
3. **要手写** — reMarkable/Supernote 没有键盘或 AI 输入，全靠笔
4. **无 AI** — 现有墨水屏 todo 没有一个有 AI Agent 维护
5. **价格贵** — reMarkable $449、Boox $400+，旧 Kindle 几乎免费
6. **触控不灵** — 墨水屏触控延迟高，小按钮误触多
7. **常显期待** — 用户反复提到 "always on display"，想当桌面任务板

### 2.2 旧 Android 设备用户的特殊困境

- Android 4.4 (API 19) 是大量现代 App 的最低支持线
- minSdk 19 的纯 Java todo 项目在 GitHub 上极少（11 个里只有 2 个）
- 现代 Todoist/TickTick/Apple Reminders 都假设彩色屏+流畅触控+Android 8+
- **InkQueue 的细分赛道真实存在但竞争稀少**

### 2.3 现有产品的不足

| 产品 | 不足 |
|---|---|
| Supernote To-Do | "mediocre"，要手写，无 AI，无自动同步 |
| Boox To-Do + Sync | 同步体验糟糕，难以理解 |
| reMarkable planner | 需要手写，无 AI，无自动同步，$449 |
| Kindle Scribe | 没有原生 todo |
| Todoist/TickTick | 假设彩色屏+流畅触控，墨水屏体验差 |
| Motion/SkedPal (AI) | 都是手机 App，无墨水屏适配 |

---

## 三、值得借鉴的核心能力与方法论

### 3.1 设计思路层面

#### a) "Plain-text single source of truth"（todo.txt 哲学）
- **来源**：todotxt/todo.txt-android
- **思路**：一个 .txt 文件作为唯一数据源，所有 UI 是文件的视图
- **InkQueue 借鉴**：云端 snapshot 即唯一数据源，本地 SQLite 是缓存层
- **可复制性**：高（已实现）

#### b) "Touch target ≥ 48dp, 最少元素"（墨水屏美学）
- **来源**：inkOS、BookLauncher、r/eink 用户反复反馈
- **思路**：墨水屏触控不灵，触控目标必须大，元素必须少
- **InkQueue 借鉴**：已实现 56dp（超过 Google 推荐的 48dp 最小值）
- **可复制性**：高（已实现）

#### c) "Local-first, sync-later"
- **来源**：sqlite-sync、SyncVault、offline-sync topic
- **思路**：本地写优先，后台 sync，离线可继续操作
- **InkQueue 借鉴**：pending_operations 队列 + "已保存，联网后同步" 文案
- **可复制性**：高（已实现）

#### d) "MinSdk 19 + 无 AndroidX" 是真实细分赛道
- **来源**：Minimal-Todo (minSdk 16)、Malenea/ToDoList (minSdk 19)
- **思路**：旧设备用户群体还在，但 Google 主流已放弃
- **InkQueue 借鉴**：已遵循，且更克制（连 RecyclerView 都不用，用 ListView）
- **可复制性**：高

### 3.2 流程层面

#### e) "操作幂等性"
- **来源**：CRDT 系统（sqlite-sync、Yjs）
- **思路**：同一操作多次应用结果一致 → pending_operations 用 op_id 去重
- **InkQueue 状态**：已部分实现（服务端 accepted/ignored 列表）
- **改进空间**：客户端保留 op_id 状态，重连后只重传未确认的

#### f) "Snapshot + Operations" 双端点 API
- **来源**：Replicache、ElectricSQL、现代 local-first 系统
- **思路**：GET snapshot 全量拉取，POST operations 增量上传
- **InkQueue 状态**：已采用（`/v1/tasks/snapshot` + `/v1/tasks/operations`）
- **可复制性**：高（这是行业标准模式）

#### g) "Time-to-first-byte 优先"
- **来源**：offline-first 通用实践
- **思路**：启动先显示本地缓存，不等网络
- **InkQueue 状态**：已实现（renderLocalFirst）

### 3.3 工程实践层面

#### h) "无 Kotlin / 无 Compose / 无 AndroidX" 是真实细分
- 11 个纯 Java todo 项目里只有 2 个 minSdk ≤ 19
- 说明 Google 主流已经放弃旧设备，但旧设备用户群体还在
- InkQueue 在这个细分里几乎是空白市场的占据者

---

## 四、可复制的流程与设计思路

### 4.1 已直接复制并实现

| 流程 | 来源项目 | InkQueue 状态 |
|---|---|---|
| 本地缓存优先显示 | offline-first 通用 | ✅ 已实现 |
| pending_operations 队列 | offline-sync topic | ✅ 已实现 |
| Snapshot + Operations API | Replicache/ElectricSQL 模式 | ✅ 已实现 |
| 大触控目标 + 黑白高对比 | inkOS, BookLauncher | ✅ 已实现 (56dp) |
| minSdk 19 + 无 AndroidX | Minimal-Todo, Malenea | ✅ 已实现 |
| plain-text 哲学（云端为源） | todo.txt | ✅ 已实现（SQLite 缓存 + JSON 源） |
| 无弹窗确认非破坏性操作 | 通用 UX 实践 | ✅ 已实现 |

### 4.2 已调研但尚未采用（需评估）

| 流程 | 来源 | 评估 |
|---|---|---|
| CRDT 冲突解决 | sqlite-sync, Yjs | 太重，512MB RAM 不适合；v0.1 用简化 Last-Write-Wins 已够 |
| plain-text 单文件存储 | todo.txt | SQLite 更适合查询+排序+索引 |
| 嵌入笔记内任务 | Supernote 用户期待 | v0.1 范围外；但 Task 已有 note 字段可支持 |
| 常显模式 (always-on) | Reddit r/eink 用户期待 | 需要修改 Activity 为 screensaver；v0.2 候选 |
| ContentProvider 数据共享 | Udacity ToDoList | 让其他 App 读任务；v0.2 候选 |
| Dropbox SDK 云同步 | todo.txt-android | 太重，且 Dropbox 在国内不可用；自建 server 更合适 |

---

## 五、InkQueue 的差异化定位

### 5.1 当前市场空白

基于调研，**墨水屏 + 任务管理 + 旧设备 + 中文** 这个交集市场上：

| 维度 | 现有产品 | InkQueue |
|---|---|---|
| 墨水屏优化 UI | reMarkable/Boox (彩色+手写) | 黑白+触控+无手写 |
| AI Agent 维护 | 无（Motion/SkedPal 都是手机 App） | **核心：Agent 是主写入者** |
| 旧 Android 4.4 支持 | 几乎为零 | minSdk 19 |
| 离线优先 + Sync | todo.txt+Dropbox / sqlite-sync | pending_ops + 自建 server |
| 中文 UI | 几乎为零（Boox/Supernote 都是 EN） | 全中文 |
| 设备只读+轻操作 | 无（都要在设备上写） | Kindle 端只完成/推迟/同步 |

### 5.2 真正的差异化机会

1. **"Agent 是主写入者，设备是只读+轻操作终端"** — 在所有调研项目里独一无二
   - 现有 todo app 都假设用户在设备上创建任务
   - InkQueue 反转：Agent 创建，Kindle 只完成/推迟
   - 这正好规避了墨水屏输入差的最大痛点

2. **"为中文用户的 Kindle 墨水屏做全中文纸面排版"**
   - 所有开源参考项目都是英文 UI
   - 中文墨水屏 todo 几乎为零
   - InkQueue 的"任务"标题 + 今日/本周/以后分组 + 白底黑字纸面美学是细分里的差异化

3. **"极轻量 + minSdk 19"** 占据了一个细分赛道
   - GitHub 上 11 个纯 Java todo 里只有 2 个支持 minSdk ≤19
   - 没有一个是为墨水屏优化过 UI 的
   - InkQueue APK 47KB 几乎是最小的 todo app

---

## 六、创新方向

### 6.1 模式优化与迭代

#### A. 操作幂等性强化（学自 CRDT 系统）
- **当前**：pending_operations 用 op_id 服务端去重
- **改进**：客户端也保留 op_id 状态，重连后只重传未确认的，避免重复上传
- **工作量**：小（SyncClient 加去重逻辑）
- **价值**：稳定性大幅提升，特别是弱网场景

#### B. "常显模式" (Always-on Display)（学自 Reddit 用户期待）
- **用户声音**：r/eink 反复提到 "always on display"
- **改进**：MainActivity 增加 `FLAG_KEEP_SCREEN_ON` + 可选 screensaver 模式
- **效果**：让 Kindle 当桌面任务板使用，合上盖子也显示
- **工作量**：中（需评估耗电）
- **价值**：直击 r/eink 用户最常提的需求

#### C. 时区漂移防护（学自 sqlite-sync 时间戳设计）
- **当前**：created_at 由客户端生成，可能时区不准
- **改进**：客户端只发"操作意图"，服务端盖时间戳
- **工作量**：小
- **价值**：避免 Agent + Kindle 时区不一致导致任务排序错乱

#### D. 视觉优化：墨水屏专用字体（学自 inkOS 美学）
- **当前**：用系统默认 sans
- **改进**：内置一个开源墨水屏优化字体（如 Source Han Serif）
- **工作量**：中（需评估 APK 大小）
- **价值**：墨水屏上衬线体比无衬线更清晰

### 6.2 新应用场景

#### E. Kindle 副屏模式（学自 kindle-side-card）
- **场景**：让 InkQueue 当 PC 的副屏 todo 板
- **实现**：PC 端发送任务到 server，Kindle 显示
- **工作量**：中（已有 server，需加 PC 客户端或浏览器入口）
- **价值**：扩大使用场景，从"移动 todo"变成"桌面专注板"

#### F. 多设备共享队列（学自 todo.txt 多端）
- **场景**：多个 Kindle 共享同一份任务列表（如家庭任务、团队任务）
- **实现**：需加 device_id 隔离 + 多用户 token
- **工作量**：中
- **价值**：v0.1 用户基数小，延后到 v0.3

#### G. Agent Webhook 接收器（新方向）
- **场景**：让 InkQueue server 接收 n8n/Zapier/Coze 等 Agent 平台的 webhook
- **实现**：Agent 在任意平台触发 → 任务自动同步到 Kindle
- **工作量**：小（server 已有 POST /v1/tasks）
- **价值**：让"Agent 同步"真正可用，打通 Agent 生态

#### H. 极简 Pomodoro 计时器（学自 r/eink "可划掉" 期待）
- **场景**：在任务详情页加"开始 25 分钟专注"按钮
- **实现**：不需要计时结束提醒（墨水屏不适合通知），只记录开始/结束时间到任务 note
- **工作量**：小
- **价值**：墨水屏专注工具的天然延伸

### 6.3 不推荐的方向

- ❌ **手写输入**（Supernote/Boox 路线）— InkQueue 设备输入差，手写体验更差
- ❌ **复杂日历视图** — 墨水屏不适合月历网格，刷新慢
- ❌ **子任务/嵌套** — v0.1 spec 明确排除
- ❌ **CRDT 实时协同** — RAM 不够，且 InkQueue 是单 Agent 写入模式不需要
- ❌ **通知推送** — Kindle 系统不支持 FCM，且墨水屏不适合通知

---

## 七、对 InkQueue v0.2 的优先级建议

按"价值/工作量"比排序：

| 优先级 | 项目 | 工作量 | 价值 |
|---|---|---|---|
| P0 | 操作幂等性强化 + 时区漂移防护 | 小 | 稳定性大幅提升 |
| P1 | Agent Webhook 接收器 | 小 | 让"Agent 同步"真正可用 |
| P2 | 常显模式（FLAG_KEEP_SCREEN_ON） | 中 | r/eink 用户最常提的需求 |
| P3 | PC 副屏模式 | 中 | 扩大使用场景 |
| P4 | 极简 Pomodoro | 小 | 墨水屏专注工具延伸 |
| P5 | 多设备共享队列 | 中 | 用户基数小，延后 |

---

## 八、调研结论

InkQueue 在调研的市场中处于一个真实但小的细分赛道：

- **需求真实**：r/eink 上反复出现"墨水屏做任务管理"的帖子，用户痛点（输入差、同步差、要手写）真实
- **竞争稀少**：GitHub 上 11 个纯 Java todo 里只有 2 个支持 minSdk ≤19，没有一个为墨水屏优化
- **差异化清晰**：Agent 作为主写入者 + Kindle 作为只读终端 这个定位在所有调研项目里独一无二
- **可借鉴充足**：todo.txt 的 plain-text 哲学、offline-first 的队列+snapshot 模式、inkOS 的墨水屏美学都已成熟可复制

InkQueue v0.1 的核心架构（Snapshot + Operations API、pending_operations 队列、白底黑字纸面 UI、minSdk 19 无依赖）已经吸收了同类项目的最佳实践。

**v0.2 应该**：
1. 强化稳定性（幂等性、时区）
2. 打通 Agent 生态（webhook 接收器）
3. 探索墨水屏独有场景（常显、副屏）

---

## 附录：调研数据来源

### GitHub API 搜索（unset proxy 后可用）
- `https://api.github.com/search/repositories?q=...`
- 搜索关键词：eink android app kindle、minimal android todo java、kindle paperwhite hack、task sync server sqlite

### Firecrawl Agent 任务
- Job 1: 墨水屏专用 App 调研（34 个项目，含 KOSP/CracKDroid 5 个、e-ink Android apps 12 个、Kindle 相关 15 个）
- Job 2: 极简 Android Todo 调研（11 个项目，5 个无 AndroidX，2 个 minSdk ≤19）

### 搜索引擎摘要（无法直接抓取 Reddit 原帖）
- Reddit r/eink 多个帖子标题 + 描述（robots.txt 禁止抓取）
- Facebook Supernote group 帖子标题
- MacPowerUsers 论坛帖子
- Boox/reMarkable 评测文章

### 调研限制
- Reddit/Facebook 原帖无法直接抓取（robots.txt + Cloudflare 拦截）
- GitHub MCP token 失效，改用公共 API（60 次/小时限速）
- 部分结论基于搜索引擎摘要推断，非原帖全文
