# InkQueue 用量仪表盘实现调研

## OpenCode Go 用量获取
CodexBar、Cockpit Tools、tokscale 等工具都走同一条路：**读本地 SQLite**

### 数据库位置
- Windows: `%APPDATA%\opencode\opencode.db`
- macOS/Linux: `~/.local/share/opencode/opencode.db`

### 表结构
opencode.db 包含 session/message/part 表，每行记录有 token 消耗或 cost 字段。
CodexBar 读取后按时间窗口聚合，对比计划限制算出百分比。

**OpenCode Go 计划限制（官方文档）：**
- 5-hour rolling: `$12`
- Weekly: `$30`  
- Monthly: `$60`

### 实现方式
- Node.js 用 `better-sqlite3` 读取本地 SQLite
- 按时间窗口求和 cost → 计算百分比
- 不需要网络请求，离线可用

## ChatGPT Plus 用量获取
CodexBar 走 `~/.codex/auth.json` OAuth → `chatgpt.com/backend-api/wham/usage`

### 网络问题
- chatgpt.com 在国内被屏蔽
- CodexBar 是 macOS 原生 App，自动走系统代理设置
- Node.js `fetch` 不走系统代理，所以连不上

### 解决方案
Node.js 18+ 的 `fetch` 支持 `HTTP_PROXY` / `HTTPS_PROXY` 环境变量。
用户在 config.json 中配置代理地址（如 `http://127.0.0.1:7890`）即可。

## 推荐方案
1. 安装 `better-sqlite3` npm 包
2. Server 启动时读取 `%APPDATA%/opencode/opencode.db`
3. 按时间窗口聚合 token 消耗 → 计算百分比
4. 配置 `HTTP_PROXY` 环境变量 → 代理访问 chatgpt.com
