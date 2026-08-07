# InkQueue 优化建议清单（2026-07-21 更新）

> 旧版（含 OpenCode 重复代码、Usage 仪表盘未实现、/v1/usage 无缓存）已过时。
> 401 Codex 账号文件**不由 InkQueue 删除**——由 CLIProxyAPI / CPAMP / 账号管理侧自行清理；
> InkQueue 只做探活并显示「可用 / 失效」。

## 已完成（本轮）

- [x] Codex 探活：`codex_enabled` = 真实可用数，不是 auth 文件数
- [x] 额度窗口按 `limit_window_seconds` 标注（当前 Plus 为 **7 天**，禁止硬编码 5h）
- [x] CPA-only `/v1/usage`，Kindle 中文小仪表盘
- [x] AsyncTask `isFinishing` / cancel + discovery `onDestroy` 关 socket
- [x] 同步前网络检查（离线跳过 auto-sync）
- [x] pending op 重试上限（10 次后丢弃，避免堵队列）
- [x] 时区固定 `Asia/Shanghai`（Android + server `nowIso`）
- [x] 空密钥统计行不展示
- [x] `scripts/server-ctl.js` start/stop/restart（**只认 `INKQUEUE_PORT`，不读通用 `PORT`**）
- [x] `scripts/seed-sample-tasks.js` 样例任务
- [x] Codex 解析 / 探活计数单测
- [x] 文档对齐 README / api.md；容量文案去掉「5h」

## 与 CPAMP 的边界

- CPA 已托管 **CPA Manager Plus** 面板（`config.yaml` → `panel-github-repository: seakee/CPA-Manager-Plus`，入口 `http://127.0.0.1:18317/management.html`）。
- InkQueue **不替代** CPAMP：不删账号、不改 auth 目录、不负责账号巡检自动化。
- InkQueue 只从本机 `auth-dir` + `/v1/models`（+ 可选 Management API）读状态给 Kindle。
- Management 密钥：明文写在 `server/data/config.json` 的 `cliproxy_management_key`，须与 CPA 启动时 bcrypt 哈希前的 secret 一致；错误密钥会导致 401，连错多次会 IP 临时 ban（约 30 分钟）。

## 当前环境观察（2026-07-21 晚）

- `~/.cli-proxy-api`：**1000 个 xai 文件，0 个 codex**；`dead/` 下也是 xai（无 codex）。
- 因此 `/v1/usage` 显示 **Codex 可用 0** 是诚实结果，不是探测 bug。
- Management API：`mg-cliproxy-local` 当前返回 `invalid management key`；多次失败后出现 `IP banned ... 30m`。
  - 解 ban / 重设 secret 在 **CLIProxy / CPAMP 侧**做，InkQueue 不改 CPA 配置。
- 账号池仍够用（Grok 1000）。

## 不在本项目处理

- 删除 / 禁用 CLIProxy `~/.cli-proxy-api` 里 401 的 Codex 文件  
  → 交给 CLIProxyAPI / CPAMP / 账号导入脚本；文件消失后 InkQueue 自动不再计入。
- Grok 单账号「剩余 %」（接口无稳定等价字段）
- 每日简报 / RSS / 招聘雷达
- 重置 CPA management secret / 解 IP ban（在 CPA 侧操作）

## 后续可选（P2）

- Android instrumented SQLite 测试
- 生产 HTTPS + 非 `dev-token`
- AlarmManager 定时静默同步（注意墨水屏耗电）
- Agent 侧固定写任务 prompt 模板再精修
