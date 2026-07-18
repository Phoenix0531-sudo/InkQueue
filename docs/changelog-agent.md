# InkQueue 项目状态摘要（给任务管理 Agent）

你管理的 InkQueue（TodoList）项目在近期做了以下改动。请了解这些变化，以便在创建和修改任务时保持一致。

## 数据模型变化

### `project` 字段已移除
- Server 端 `normalizeTask()` 和 PATCH 字段列表已删除 `project`
- Android 端 Task.java 删除字段声明、解析、输出
- 数据库 `InkQueueDatabase.java`：DB_VERSION 1→2，CREATE TABLE 去掉 `project TEXT` 列
- `TaskRepository.java` 删除 `values.put("project", ...)` 和 cursor 读取
- 详情页和首页不再显示项目信息
- 所有文档已更新（agent-prompt.md、api.md、product-spec.md）
- 测试文件和种子数据已清理

### `due_time` 不再显示
- `DateUtils.displayDue()` 只返回日期文案（`today` / `tomorrow` / `overdue 3d` / `7/10`），不再拼接时间
- 数据模型和数据库保留 `due_time` 字段，Server API 仍接受
- 创建任务时 `due_time` 可选，传了也存但不显示

## UI 风格变化

- App 名：从「任务」改为 **TodoList**
- 配色：**纯黑背景 (#000000) + 纯白文字 (#FFFFFF)**，保证墨水屏高对比度
- 字体：全部 **monospace 等宽字体**
- 分组标题：「今日/本周/以后」→ **`// TODAY` / `// THIS WEEK` / `// LATER`**
- 任务项前缀：`□` → **`[]`**（终端风格）
- 操作按钮：`完成/推迟到明天` → **`[x] complete` / `[>] tomorrow`**
- 首页底栏：`同步/设置` → **`SYNC` / `SETTINGS`**
- 状态文字：中英文混合 → **全英文**
- 设置页：中英文混合 → **全英文**
- 分隔线：黑色 → **深灰 `#555555`**

## 自动发现 Server

新增 **UDP 广播自动发现**，App 不再需要手动设置 IP：

- Server 端监听 **UDP 48787** 端口，收到 `InkQueue:ping` 后回复 `InkQueue:pong:serverIp:8787`
- Android 端 `ServerDiscovery.java` 发送广播到 `255.255.255.255:48787`，解析 pong 响应
- `SyncService.java` 默认 URL 从 `http://10.0.2.2:8787` **改为空字符串**，触发自动发现
- 发现成功后自动保存 URL 到 SharedPreferences，后续启动直接使用
- 同步失败时自动重新发现
- Server 同时保留 mDNS（bonjour 包）广播作为备选

## 技术细节

### 启动 Server
```bash
cd /d/3_Code_Projects/InkQueue/server && npm start
```

### API
- 地址：自动发现为 `http://192.168.x.x:8787`
- Token：`dev-token`
- Header：`X-InkQueue-Token: dev-token`

### 任务字段（当前有效）

```json
{
  "id": "task_mrbecrf2_e41a283f",
  "title": "任务标题",
  "note": "备注说明",
  "status": "todo",
  "due_date": "2026-07-10",
  "due_time": "14:00",
  "priority": "normal",
  "created_at": "2026-07-09T08:00:00+08:00",
  "updated_at": "2026-07-09T08:10:00+08:00",
  "completed_at": null,
  "source": "agent"
}
```

无 `project` 字段。`due_time` API 仍接受但不显示。

### 分组规则（Kindle 端首页）

| 分组 | 进入条件 |
|------|----------|
| **// TODAY** | `due_date` 是今天 / 已过期未完成 / `force_today=true` |
| **// THIS WEEK** | `due_date` 在本周剩余日期内（不含今天） |
| **// LATER** | `due_date` 在下周及以后 / 无 `due_date` |

### 推送规则（与之前一致）

- 明天：`due_date = 今天 + 1 天`
- 周末：周一到周五→本周六；周六或周日→下周六
- 下周：下周一
- 有时则保留时，无时不添加
