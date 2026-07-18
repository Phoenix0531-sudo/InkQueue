# InkQueue v0.1 API

参考 server 使用 HTTP JSON API，默认端口 `8787`。v0.1 使用简单 token：

```text
X-InkQueue-Token: dev-token
```

`GET /v1/health` 不需要 token；其他接口都需要 token。生产环境建议改用 HTTPS 和更长的随机 token。

错误响应使用 JSON：

```json
{
  "error": "invalid json"
}
```

日期必须是有效的 `YYYY-MM-DD`，时间必须是 `HH:mm`（24 小时制）。`status` 支持 `todo`、`done`、`archived`；`priority` 支持 `normal`、`high`。

## GET /v1/health

响应：

```json
{
  "ok": true
}
```

## GET /v1/tasks/snapshot

拉取完整任务快照。

请求：

```bash
curl http://localhost:8787/v1/tasks/snapshot \
  -H "X-InkQueue-Token: dev-token"
```

响应：

```json
{
  "server_time": "2026-07-05T08:12:00+08:00",
  "tasks": [
    {
      "id": "task_001",
      "title": "整理 BootSem 文档",
      "note": "给 juniors 的说明材料",
      "status": "todo",
      "due_date": "2026-07-05",
      "due_time": "14:00",
      "priority": "normal",
      "created_at": "2026-07-05T08:00:00+08:00",
      "updated_at": "2026-07-05T08:10:00+08:00",
      "completed_at": null,
      "source": "agent"
    }
  ]
}
```

## POST /v1/tasks/operations

设备端上传离线操作队列。服务端按数组顺序应用。

请求：

```json
{
  "device_id": "kindle-pw3",
  "operations": [
    {
      "id": "op_001",
      "type": "complete",
      "task_id": "task_001",
      "created_at": "2026-07-05T09:00:00+08:00",
      "payload": {
        "completed_at": "2026-07-05T09:00:00+08:00"
      }
    },
    {
      "id": "op_002",
      "type": "postpone",
      "task_id": "task_002",
      "created_at": "2026-07-05T09:01:00+08:00",
      "payload": {
        "due_date": "2026-07-06",
        "due_time": "14:00",
        "postpone_target": "tomorrow"
      }
    }
  ]
}
```

响应：

```json
{
  "server_time": "2026-07-05T09:02:00+08:00",
  "accepted": ["op_001", "op_002"],
  "ignored": [],
  "errors": []
}
```

如果任务已经不存在，服务端把 operation 放入 `ignored`，客户端可以删除本地 pending operation 并刷新 snapshot。

## POST /v1/tasks

Agent 添加任务。

请求：

```bash
curl -X POST http://localhost:8787/v1/tasks \
  -H "Content-Type: application/json" \
  -H "X-InkQueue-Token: dev-token" \
  -d '{"title":"整理 BootSem 文档","due_date":"2026-07-05","due_time":"14:00","priority":"normal"}'
```

响应：

```json
{
  "task": {
    "id": "task_generated",
    "title": "整理 BootSem 文档",
    "status": "todo"
  }
}
```

## PATCH /v1/tasks/:id

Agent 修改任务。支持字段：

- `title`
- `note`
- `status`
- `due_date`
- `due_time`
- `priority`
- `source`
- `force_today` / `today`

示例：

```bash
curl -X PATCH http://localhost:8787/v1/tasks/task_001 \
  -H "Content-Type: application/json" \
  -H "X-InkQueue-Token: dev-token" \
  -d '{"priority":"high","note":"补充提交注意事项"}'
```
