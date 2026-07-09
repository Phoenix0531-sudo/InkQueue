# InkQueue Reference Server

v0.1 参考后端，用 JSON 文件保存任务，方便 Android 客户端和 Agent 本地联调。

## 启动

```bash
npm start
```

默认监听：

```text
http://localhost:8787
```

默认 token：

```text
dev-token
```

## 测试

```bash
npm test
```

## 示例

健康检查：

```bash
curl http://localhost:8787/v1/health
```

创建任务：

```bash
curl -X POST http://localhost:8787/v1/tasks \
  -H "Content-Type: application/json" \
  -H "X-InkQueue-Token: dev-token" \
  -d '{"title":"整理 BootSem 文档","due_date":"2026-07-06","due_time":"14:00","project":"BootSem","priority":"normal"}'
```

拉取 snapshot：

```bash
curl http://localhost:8787/v1/tasks/snapshot \
  -H "X-InkQueue-Token: dev-token"
```

上传 operations：

```bash
curl -X POST http://localhost:8787/v1/tasks/operations \
  -H "Content-Type: application/json" \
  -H "X-InkQueue-Token: dev-token" \
  --data-binary @../tests/api-examples/operations.json
```
