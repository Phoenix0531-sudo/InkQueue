# AGENTS.md — 打开本仓库时的 Agent 入口

你在 **InkQueue** 仓库里。这是「本机 Agent ↔ 局域网 server ↔ Kindle 墨水屏任务 App」的个人项目。

## 三层（不要混）

| 目录 | 给谁 | 做什么 |
|------|------|--------|
| `android/` | 设备 | 看任务、完成、推迟；不跑 Agent |
| `server/` | 真相源 | HTTP API、`tasks.json` |
| `agent/` | **你（任意 Agent）** | **唯一推荐出口：`inkq` CLI + `interface.md`** |

## 主路径（不需要 skill）

**不装 Hermes skill、不装 MCP、不绑任何一家 Agent。**  
会跑下面命令即可：

```bash
node scripts/server-ctl.js start   # 若 8787 未起
node agent/inkq.js health
node agent/inkq.js context
node agent/inkq.js add --title "示例" --due tomorrow
node agent/inkq.js list
node agent/inkq.js events --limit 20
```

必读契约：[`agent/interface.md`](agent/interface.md)  
层说明：[`agent/README.md`](agent/README.md)  
架构：[`docs/architecture.md`](docs/architecture.md)

## 明确不做

- **不要**为了 InkQueue 专门安装 skill / 默认 MCP（`agent/adapters/` 可选参考；`mcp-inkqueue` 仅宿主只认 MCP 时用，仍走 `lib/client.js`）
- **不要**扫描本机其它产品的全量会话来自动抽任务
- **不要**手写一长串 curl 当主路径（UTF-8/鉴权易翻车）；统一走 `inkq`
- 旧文 `docs/agent-prompt.md` 已废弃，以本文件 + `agent/` 为准
