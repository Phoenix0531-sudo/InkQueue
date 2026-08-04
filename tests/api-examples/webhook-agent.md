# InkQueue Agent Webhook 示例

参考 server 已启动后执行：

```bash
curl -X POST http://localhost:8787/v1/webhook/agent \
  -H "Content-Type: application/json" \
  -H "X-InkQueue-Token: dev-token" \
  -d '{"event_id":"demo-agent-001","task":{"title":"检查 Agent Webhook","note":"这是通过 webhook 写入的任务","due_date":"2026-08-03","priority":"high"}}'
```

重复使用 `event_id` 不会创建第二个任务：

```bash
curl -X POST http://localhost:8787/v1/webhook/agent \
  -H "Content-Type: application/json" \
  -H "X-InkQueue-Token: dev-token" \
  -d '{"event_id":"demo-agent-001","task":{"title":"不会重复创建"}}'
```

批量写入：

```bash
curl -X POST http://localhost:8787/v1/webhook/agent \
  -H "Content-Type: application/json" \
  -H "X-InkQueue-Token: dev-token" \
  -d '{"event_id":"demo-agent-batch-001","tasks":[{"title":"任务 A"},{"title":"任务 B","priority":"high"}]}'
```
