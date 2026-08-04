# InkQueue API v0.2

参考 server 使用 HTTP JSON API，默认端口 `8787`。除 `/v1/health` 外，接口都需要在请求头提供实际 token：

```text
X-InkQueue-Token: <INKQUEUE_TOKEN>
```

开发环境默认 token 是 `dev-token`；生产环境必须替换为随机长 token，并使用 HTTPS。产品时区固定为 `Asia/Shanghai`（`+08:00`）。

## GET /v1/health

```bash
curl http://localhost:8787/v1/health
```

```json
{"ok":true}
```

## GET /v1/tasks/snapshot

设备启动时先读本地 SQLite，再拉取云端完整快照：

```bash
curl http://localhost:8787/v1/tasks/snapshot \
  -H "X-InkQueue-Token: dev-token"
```

## POST /v1/tasks/operations

Kindle 上传本地完成/推迟操作。服务端按照数组顺序应用，`id` 是幂等键。

```json
{
  "device_id": "kindle-pw3",
  "operations": [
    {
      "id": "op_001",
      "type": "complete",
      "task_id": "task_001",
      "payload": {}
    },
    {
      "id": "op_002",
      "type": "postpone",
      "task_id": "task_002",
      "payload": {
        "due_date": "2026-08-08",
        "due_time": "14:00",
        "postpone_target": "weekend"
      }
    }
  ]
}
```

### 时间戳规则

- 客户端的 `created_at`、`payload.completed_at` 即使存在，也不会覆盖服务端时间。
- 服务端应用操作时生成 `updated_at`。
- `complete` 操作的 `completed_at` 由服务端生成。
- 客户端仍然保留本地 SQLite 的入队时间用于排序和重试，但不会上传该字段。

### 幂等规则

- 第一次收到 `op_001`：返回 `accepted: ["op_001"]`，并应用任务状态变化。
- 再次收到同一个 `op_001`：仍返回 `accepted: ["op_001"]`，但不会再次修改任务，也不会刷新 `updated_at`。
- 已归档或不存在的任务：返回 `ignored`，客户端可以删除本地 pending operation。
- 操作格式错误：返回 `errors`，客户端递增 `retry_count`；达到上限后丢弃并写日志。

参考 server 在 JSON 数据文件中保留轻量 `operations` 数组作为已应用操作记录。生产后端可替换成带 TTL/唯一索引的操作表。

## POST /v1/tasks

Agent 或人工脚本创建任务：

```bash
curl -X POST http://localhost:8787/v1/tasks \
  -H "Content-Type: application/json" \
  -H "X-InkQueue-Token: dev-token" \
  -d '{"title":"整理 BootSem 文档","due_date":"2026-08-03","due_time":"14:00","priority":"normal","source":"agent"}'
```

## PATCH /v1/tasks/:id

Agent 修改已有任务：

```bash
curl -X PATCH http://localhost:8787/v1/tasks/task_001 \
  -H "Content-Type: application/json" \
  -H "X-InkQueue-Token: dev-token" \
  -d '{"title":"更新后的任务标题","priority":"high"}'
```

## POST /v1/webhook/agent

将 n8n、Zapier、Coze、个人 Agent 脚本等产生的任务接入 InkQueue。

认证仍使用 `X-InkQueue-Token`。支持三种请求形状。

### 单任务

```json
{
  "event_id": "agent-event-001",
  "task": {
    "title": "整理 Agent 输出",
    "note": "把结果归档到项目文档",
    "due_date": "2026-08-03",
    "priority": "high"
  }
}
```

### 批量任务

```json
{
  "event_id": "agent-event-002",
  "tasks": [
    {"title":"任务 A","due_date":"2026-08-03"},
    {"title":"任务 B","due_date":"2026-08-04"}
  ]
}
```

### 更新已有任务

带有已存在 `id` 的 task 会执行更新；不带 `id` 会创建新任务：

```json
{
  "task": {
    "id": "task_001",
    "title": "Agent 修改后的标题",
    "priority": "high"
  }
}
```

响应：

```json
{
  "server_time": "2026-08-01T16:00:00+08:00",
  "event_id": "agent-event-001",
  "duplicate": false,
  "created": [],
  "updated": []
}
```

`event_id`、`idempotency_key`、`eventId` 任意一个都可以作为 webhook 幂等键。重复发送同一个事件只返回：

```json
{
  "duplicate": true,
  "created": [],
  "updated": []
}
```

单次 webhook 最多 50 个任务。每个任务必须有非空 `title`；日期、时间、状态、优先级按任务 API 的规则校验。

## 生产替换建议

v0.2 参考 server 使用 JSON 文件，重点是本地端到端联调。生产环境建议：

1. 将 `operations` 迁移到 SQLite/D1/PostgreSQL 表，并为 operation id 建唯一索引。
2. 为 webhook 单独配置 secret，而不是和 Kindle token 共用。
3. 对 webhook 增加请求签名（HMAC）、时间窗和 IP/速率限制。
4. 保留服务端时间作为最终时间，设备时间只用于本地 UI。
5. 继续保持 Snapshot + Operations 协议，避免旧 Kindle 客户端升级压力。

---

## v0.3 新增端点

### GET /v1/events

Agent 出站事件流。返回设备在 server 端处理过的完成/推迟事件，Agent 可以轮询这个端点了解用户在墨水屏上做了什么。

```bash
curl http://localhost:8787/v1/events \
  -H "X-InkQueue-Token: dev-token"

# 增量拉取
curl "http://localhost:8787/v1/events?since=2026-08-02T09:05:30+08:00&limit=50" \
  -H "X-InkQueue-Token: dev-token"
```

响应：

```json
{
  "server_time": "2026-08-02T09:06:03+08:00",
  "events": [
    {
      "event_id": "op_1785632760234_5c22bf",
      "type": "complete",
      "task_id": "task_mrup8na0_d8f6813f",
      "task_title": "修改新文章",
      "occurred_at": "2026-08-02T09:06:03+08:00",
      "payload": {}
    },
    {
      "event_id": "op_xxx",
      "type": "postpone",
      "task_id": "task_yyy",
      "task_title": "跑大宛齐高宽比数据",
      "occurred_at": "2026-08-02T09:05:26+08:00",
      "payload": {
        "due_date": "2026-08-02",
        "postpone_target": "today"
      }
    }
  ],
  "latest_event_at": "2026-08-02T09:06:03+08:00"
}
```

参数：
- `since=<ISO8601>`: 只返回 `occurred_at` 之后的事件。建议 Agent 持久化 `latest_event_at` 作为下一次轮询的 `since` 值。
- `limit=N`: 只返回最近 N 个事件（保留尾部）。

`type` 取值：`complete`、`postpone`。`event_id` 等同于操作 id，是幂等键。Agent 可以安全重放。

### GET /v1/agent/context

Agent 调度上下文。给 Agent 决定推多少任务、什么节奏用的统计视图。

```bash
curl http://localhost:8787/v1/agent/context \
  -H "X-InkQueue-Token: dev-token"
```

响应：

```json
{
  "server_time": "2026-08-02T09:06:30+08:00",
  "today_date": "2026-08-02",
  "open": {
    "overdue": 1,
    "today": 1,
    "this_week": 0,
    "later": 1,
    "total": 3
  },
  "done_total": 10,
  "completed_last_7d": 5,
  "device_activity_24h": {
    "completes": 1,
    "postpones": 0
  },
  "suggestion": {
    "note": "今日任务偏少，建议补 2-3 个今日任务"
  }
}
```

`suggestion.note` 是给 Agent 看的轻量建议：

- 过期任务 ≥ 5：建议优先清过期
- 今日为 0：建议补 2-3 个今日任务
- 今日 ≥ 8：建议控制在 3-5 个（墨水屏用户处理节奏有限）
- 推迟 > 完成：核对任务日期合理性
- 否则：节奏正常

Agent 应在打 webhook 之前先查 `/v1/agent/context` 看用户当前节奏，避免推送过多。

### Outbound Agent Webhook（v0.3，stretch）

Server 在处理设备完成/推迟操作时，如果 `data/config.json` 配了 `agent_webhook_url` 字段（或环境变量 `INKQUEUE_AGENT_WEBHOOK_URL`），会 fire-and-forget POST 一个事件给该 URL：

```json
{
  "event_id": "op_xxx",
  "type": "complete",
  "task_id": "task_yyy",
  "task_title": "整理材料",
  "occurred_at": "2026-08-02T09:06:03+08:00",
  "payload": {}
}
```

这是 push 通道，与 `/v1/events` 轮询通道互补。Server 不重试、不阻塞响应；Agent 端须自己幂等处理。

生产建议：
- 配置 `agent_webhook_url` 时同步设置 HMAC secret + 签名头。
- 推荐同时启用 `/v1/events` 轮询作为兜底（fire-and-forget 可能丢）。
- 单独为 webhook 设 secret，不要和 Kindle 端的 `X-InkQueue-Token` 共用。

## CLIProxyAPI 监控接口

InkQueue 还提供 CPA-only 的 `/v1/usage`、`/v1/cliproxy/health`、`/v1/cliproxy/pool` 和 `/admin/cliproxy`，用于本地账号池状态展示。相关接口不会返回 access token、refresh token 或原始 id token，也不会删除 CLIProxy auth 文件。额度窗口标签必须来自 CPA 返回的 `limit_window_seconds`，不硬编码为 5 小时。
