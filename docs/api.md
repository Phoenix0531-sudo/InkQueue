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

## CLIProxyAPI 健康 / 账号池 / 用量

v0.1 额外提供 CLIProxyAPI 监控接口。当前默认：

- 读本地 `~/.cli-proxy-api/*.json` 账号池
- 探活 `http://127.0.0.1:18317/v1/models`
- 若配置了 `cliproxy_management_key`，再读 Management API：
  - `/v0/management/get-auth-status`
  - `/v0/management/auth-files`（success/failed/unavailable）
  - `/v0/management/usage-statistics-enabled`
  - `/v0/management/api-key-usage`
  - `/v0/management/usage-queue`

配置见 `server/data/config.json`：

```json
{
  "cliproxy_base_url": "http://127.0.0.1:18317",
  "cliproxy_api_key": "sk-cliproxy-local",
  "cliproxy_auth_dir": "~/.cli-proxy-api",
  "cliproxy_management_key": "mg-cliproxy-local",
  "proxy": "http://127.0.0.1:7890"
}
```

CLIProxyAPI 侧：

```yaml
remote-management:
  allow-remote: false
  secret-key: "mg-cliproxy-local"   # 启动后会被 bcrypt 哈希写回
```

`secret-key` 改完后需重启 CLIProxyAPI 一次。`allow-remote: false` 时仅本机可访问 Management。
### GET /v1/cliproxy/health

```bash
curl http://localhost:8787/v1/cliproxy/health \
  -H "X-InkQueue-Token: dev-token"
```

返回 `ok`、延迟、`model_count`、模型抽样。

### GET /v1/cliproxy/pool

```bash
curl http://localhost:8787/v1/cliproxy/pool \
  -H "X-InkQueue-Token: dev-token"
```

返回账号池汇总（按 type 计数、启用/禁用/token 过期）和脱敏账号列表。

**Codex 探活：** `/v1/usage` 默认会探测 Codex 账号是否真实可用（`wham/usage`）。  
`codex_enabled` = 探活成功数；`codex_dead` = 401 等失败数。  
**InkQueue 不会删除 CLIProxy auth 目录里的 401 文件**——由 CLIProxy / 账号侧自行清理。

额度标签：

- 字段：`rate_limit.primary_window.used_percent`、`limit_window_seconds`
- 例：`limit_window_seconds = 604800` → 展示「7天」，**不是**写死的 5 小时

Query：

- `?force=1`：跳过 usage 短缓存（约 8s）
- `?codex_usage=1`：兼容参数；当前默认已探 Codex

### GET /v1/usage

Kindle 首页仪表盘数据源。**仅返回 `cliproxyapi` provider**（CPA 账号池），不再混入 OpenCode/ChatGPT 条。

```bash
curl "http://localhost:8787/v1/usage?force=1" \
  -H "X-InkQueue-Token: dev-token"
```

`data` 关键字段包括：`codex_enabled`、`codex_dead`、`codex_total`、`xai_enabled`、`total_accounts`、`success`/`failed`（累计调用次数）、`lines`（中文文案）、`codex_quota`（有效号额度摘要）。

### GET /admin/cliproxy

浏览器管理面板：

```text
http://localhost:8787/admin/cliproxy?token=dev-token
```

也可用 Header：`X-InkQueue-Token: dev-token`。

注意：

- 响应中的邮箱已脱敏，不会返回 access_token / refresh_token
- 当前不会改写或重启 CLIProxyAPI
- 产品时区固定 **Asia/Shanghai**
