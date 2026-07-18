# InkQueue 优化建议清单

## P0 — 必须改（错误/缺陷）

### 1. fetchOpenCodeUsage() 代码重复
- **位置:** `server/src/server.js:76-93`
- **问题:** try/catch 分支中的 fallback 返回数据完全一样，代码重复 3 次
- **建议:** 提取 `const FALLBACK = {...}` 常量

### 2. Auth0 client_id 未经验证
- **位置:** `server/src/server.js:112`
- **问题:** 硬编码 `p2gNDZ5pN4P6TMg7bT6Xg8T8T8T8T8T8T8T8T8`，如果其他 Codex 版本用了不同 client_id 则 refresh 失败
- **建议:** 从 Auth0 配置中读取，或尝试从 `auth.json` 的 `audience`/`scope` 推断

### 3. MainActivity 没有 onDestroy 清理
- **位置:** `MainActivity.java:167-193`
- **问题:** `ServerDiscovery` 持有 UDP socket，Activity 销毁时不会自动停止；可能在后台持续发广播
- **建议:** 在 `onDestroy()` 中调用 `if (discovery != null) discovery.stop()`

### 4. Server 启动时没有验证 config.json
- **位置:** `server.js`
- **问题:** config.json 缺失或格式损坏时静默忽略，不报错
- **建议:** 启动时验证 config.json，如果缺少 opencode_api_key 则打印 warning

---

## P1 — 建议改（性能/健壮性）

### 5. /v1/usage 无缓存
- **位置:** `server.js:340`
- **问题:** 每次调用都发起 2 次外部 HTTP 请求；OpenCode API 如果将来上线，每次都要 200ms+
- **建议:** 加 30 秒内存缓存，`fetchUsage()` 检查缓存是否过期再决定是否重新请求

### 6. bonjour 应改为 optionalDependencies
- **位置:** `server/package.json`
- **问题:** `bonjour` 在 `dependencies` 中，但它不是核心功能（只是 mDNS 发现额外通道，且已有 UDP 兜底）
- **建议:** 移到 `optionalDependencies`，`npm install` 出错也不会导致安装失败

### 7. expandHome() 在 Windows 有坑
- **位置:** `server.js:96`
- **问题:** `~` 在 Git Bash 中已经被展开，但 cmd/powershell 中需要 `%USERPROFILE%`
- **建议:** 用 `os.homedir()` 替代手工处理（Node 内置方法，跨平台）

### 8. Android AsyncTask 没有取消机制
- **位置:** `MainActivity.java:147-164` 及其他多处
- **问题:** Activity 销毁后 AsyncTask 仍可能执行 `onPostExecute`，尝试更新已销毁的 View
- **建议:** 检查 `isFinishing()` 或使用弱引用

### 9. 没有网络检查就同步
- **位置:** `MainActivity.java:139`
- **问题:** 自动同步时没有检查 WiFi 是否在线，墨水屏可能徒劳唤醒 WiFi 并浪费电
- **建议:** `syncInBackground` 前检查 `ConnectivityManager`，离线直接跳过

### 10. Server/usage 错误键名不一致
- **位置:** `server.js:68, 132, 145, 161, 164, 169`
- **问题:** 有的返回 `error: 'string'`，有的返回 `windows: {}`，有的返回 `data: {...}`。Android 端解析时难以统一处理
- **建议:** 统一返回格式：`{ provider, error, data, windows }`，`data` 放结构化结果，`windows` 放降级数据

---

## P2 — 可做但优先级低

### 11. config.json 中 token 明文存储
- **问题:** OpenCode API key 和未来可能加的其他 key 明存放在 JSON 文件中
- **建议:** 如果做生产部署，用环境变量更安全。目前仅局域网使用，风险可控

### 12. 缺少 instrumented SQLite 测试
- **问题:** `TaskRepository` 依赖 Android SQLite，只能在真机/模拟器上跑
- **建议:** 后续可加 `androidTest` 测试

### 13. Server 缺少 /v1/usage 的单元测试
- **建议:** 在 `server/test/api.test.js` 中加 `/v1/usage` 的基本请求测试（mock 外部 API）

### 14. 首页 Usage 仪表盘未实现
- **建议:** 后续开发：在标题下方加 UsageAdapter 展示用量百分比条

### 15. AlarmManager 定时刷新未实现
- **建议:** 后续开发：每隔 N 分钟自动 SyncService + fetchUsage

---

## 优先级排序

```
立即：P0#1(去重) + P0#3(onDestroy) + P0#4(启动验证)
   ↓
下轮：P1#5(缓存) + P1#6(optional deps) + P1#7(expandHome) + P1#9(网络检查)
   ↓
以后：P1#8(AsyncTask) + P2 项
```
