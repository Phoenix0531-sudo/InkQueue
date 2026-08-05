# mcp-inkqueue — 可选 MCP 薄外壳

**不是主路径。** 日常继续：

```bash
node agent/inkq.js …
```

本目录只在「宿主只认 MCP tools」时使用。协议实现 1:1 对齐 `inkq` 动词，HTTP **只**走 `agent/lib/client.js`，禁止第二套客户端。

## 特点

- 纯 **stdio** MCP（换行分隔 JSON-RPC，对齐 Hermes / 官方 Python mcp SDK）
- **零依赖**（不装 `@modelcontextprotocol/sdk`）
- tools：`health` / `context` / `list` / `get` / `add` / `patch` / `events`
- `events` 含 raw + 派生 `signals`
- auth 用环境变量 / 配置文件；tool 参数里的 `auth` 仅排障用，**不要**写进对话

## 启动

```bash
# 仓库根
node agent/adapters/mcp-inkqueue/index.js
```

或：

```bash
cd agent/adapters/mcp-inkqueue
npm start
```

配置与 CLI 相同：

1. tool 参数 `base_url` / `auth`（可选）
2. `INKQUEUE_BASE_URL` / `INKQUEUE_AUTH`
3. `~/.inkqueue/config.json` 或 `agent/config.json`
4. 默认 `http://127.0.0.1:8787` + `dev-token`

## Hermes / 任意 MCP 宿主示例

```json
{
  "mcpServers": {
    "inkqueue": {
      "command": "node",
      "args": ["D:/3_Code_Projects/InkQueue/agent/adapters/mcp-inkqueue/index.js"],
      "env": {
        "INKQUEUE_BASE_URL": "http://127.0.0.1:8787",
        "INKQUEUE_AUTH": "dev-token"
      }
    }
  }
}
```

路径按本机仓库改。**不要**把生产 token 提交进仓。

## 自检

```bash
# server 需已起
node agent/adapters/mcp-inkqueue/test-smoke.js
```

## 与 inkq 的关系

| | inkq CLI | mcp-inkqueue |
|---|---|---|
| 主路径 | **是** | 否 |
| 协议 | 命令行 + stdout JSON | MCP tools |
| HTTP | `lib/client.js` | 同一 `lib/client.js` |
| 契约 | `interface.md` | 同契约，只换调用壳 |

新增 Agent ≠ 新增协议：只可能多一个外壳。
