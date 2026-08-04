# InkQueue 架构

## 总览

```text
┌──────────────────────────────────────────────┐
│  你 / 任意本机 Agent / 纯 shell                │
│  主路径：node agent/inkq.js  + interface.md   │
│  （不需要 skill）                              │
└─────────────────┬────────────────────────────┘
                  │ HTTP JSON
                  ▼
┌──────────────────────────────────────────────┐
│  server/   :8787                              │
│  snapshot · tasks · operations · events       │
│  agent/context · webhook/agent                │
└─────────────────┬────────────────────────────┘
                  │ Wi‑Fi（无 adb reverse）
                  ▼
┌──────────────────────────────────────────────┐
│  android/  Kindle PW3 App（minSdk 19）         │
│  本地 SQLite 缓存 + pending operations         │
│  完成 / 推迟 → 回传 server                     │
└──────────────────────────────────────────────┘
```

## 目录边界

| 路径 | 职责 | 不放什么 |
|------|------|----------|
| `android/` | 墨水屏 UI 与同步客户端 | Agent skill、Node 服务 |
| `server/` | API 与持久化 | 某家 Agent 的专用 SDK |
| `agent/` | **通用出口：`inkq` + 契约** | App 资源、Gradle |
| `agent/adapters/` | 可选参考，**默认不用** | 主协议 |
| `scripts/` | 启停、种子数据、工具链 | Agent 协议正文 |
| `docs/` | 人读产品/API/设计 | 可执行 CLI |
| `tests/` | 测试与 api 示例 | 生产配置密钥 |

原则：**待在一起（单仓），分层清楚。主路径不绑 skill。**

## 数据流

1. `inkq add` → `POST /v1/tasks`
2. Kindle 同步 → `GET /v1/tasks/snapshot` → 本地展示
3. 人：完成/推迟 → 本地 pending → `POST /v1/tasks/operations`
4. `inkq events` / `context` → 读人侧信号，再决定是否重排

## 明确非目标

- **不**要求安装 Hermes/Codex skill
- **不**读取任何 Agent 历史会话库
- App **不**内嵌聊天模型
- 不绑单一 Agent 品牌
