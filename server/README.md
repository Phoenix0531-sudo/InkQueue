# InkQueue Reference Server

InkQueue 的本地参考后端，用 JSON 文件保存任务，支持 Android 客户端、Agent 脚本和 webhook 联调。

## 启动

```bash
npm install
npm start
```

默认监听：

```text
http://localhost:8787
```

默认开发 token：`dev-token`。请求头：

```text
X-InkQueue-Token: dev-token
```

数据文件：`server/data/tasks.json`。

## 测试

```bash
npm test
```

测试覆盖：

- health / token 鉴权
- task 创建、snapshot、校验
- complete / postpone operations
- operation 幂等重放
- 服务端时间戳
- Agent webhook 创建、更新、event_id 去重
- CPA-only usage 相关接口

## API 示例

健康检查：

```bash
curl http://localhost:8787/v1/health
```

创建任务：

```bash
curl -X POST http://localhost:8787/v1/tasks \
  -H "Content-Type: application/json" \
  -H "X-InkQueue-Token: dev-token" \
  -d '{"title":"整理 BootSem 文档","due_date":"2026-08-03","due_time":"14:00","priority":"normal","source":"agent"}'
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

Agent webhook：

```bash
curl -X POST http://localhost:8787/v1/webhook/agent \
  -H "Content-Type: application/json" \
  -H "X-InkQueue-Token: dev-token" \
  -d '{"event_id":"agent-demo-001","task":{"title":"检查 Agent Webhook","due_date":"2026-08-03","priority":"high"}}'
```

重复发送同一 `event_id` 不会再次创建任务。完整协议见 [`docs/api.md`](../docs/api.md)，Webhook 示例见 [`tests/api-examples/webhook-agent.md`](../tests/api-examples/webhook-agent.md)。

## 数据与生产限制

- 当前后端是参考实现，不是生产多用户服务。
- JSON 文件适合本地测试，不适合高并发写入。
- operation id 会保存在 `operations` 数组中，用于幂等重放。
- 生产环境应把 operations 迁移到带唯一索引的数据库表。
- Webhook 当前与设备端共用 token；生产环境应增加独立 secret、HMAC 签名、时间窗和速率限制。
- 服务端最终时间固定为 `Asia/Shanghai`，设备提交的时间戳不会覆盖 `completed_at` / `updated_at`。
