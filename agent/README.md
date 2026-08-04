# agent/ — InkQueue 的 Agent 接口层

这一层让**任意本机 Agent**（或纯 shell）稳定读写任务队列。

**主路径 = `inkq.js` + `interface.md`。不需要 skill。**

Kindle App **不**认识 Hermes/Codex；它只同步 `server/`。  
InkQueue **不**读取任何 Agent 的会话库；需要落队列时**主动**调 CLI。

## 在整仓中的位置

```text
InkQueue/
  android/     墨水屏客户端（执行面：看 / 完成 / 推迟）
  server/      HTTP API + 任务真相源
  agent/       ★ 给 Agent 的出口与契约（本目录）
  docs/        人读文档
  scripts/     运维（启停 server），不是 Agent 协议
```

```text
你 / 任意 Agent
        │  直接 terminal 调 inkq（推荐）
        ▼
   agent/inkq.js  ──require──►  agent/lib/client.js
        │  HTTP
        ▼
   server :8787  ──Wi‑Fi──►  Kindle App
```

## 目录

| 路径 | 作用 |
|------|------|
| `inkq.js` | **主入口** CLI：health / context / list / add / patch / events / get |
| `lib/client.js` | 共享 HTTP + 配置解析（CLI / 未来 MCP 共用，禁止第二套协议） |
| `interface.md` | **何时必须写成任务** 的硬契约 |
| `config.example.json` | 配置样例 → 可复制为 `config.json` 或 `~/.inkqueue/config.json` |
| `test-inkq-smoke.js` | 活 server 冒烟 |
| `adapters/` | **可选、默认不用**。某家产品想塞说明书时参考；不装也能用 |

## 快速用

```bash
node scripts/server-ctl.js start

node agent/inkq.js health
node agent/inkq.js context
node agent/inkq.js list
node agent/inkq.js add --title "整理 BootSem 文档" --due tomorrow --time 14:00 --priority high
node agent/inkq.js events --limit 20
```

stdout = JSON；stderr = 短提示。

配置优先级：`--base-url` / `--auth` → `INKQUEUE_BASE_URL` / `INKQUEUE_AUTH` → 配置文件 → 默认 `http://127.0.0.1:8787` + `dev-token`。

配置文件查找：`INKQUEUE_CONFIG` → `~/.inkqueue/config.json` → `agent/config.json` → `server/data/agent-config.json`。

## 原则

1. **不绑 Agent 品牌**；skill 不是产品面  
2. **不读会话**；只提供出口与规则  
3. **先 context 再 add**，保护墨水屏队列长度  
4. **只走 server 已有 API**，不另起协议  
5. 旧 `docs/agent-prompt.md` 废弃；HTTP 细节仍见 `docs/api.md`
