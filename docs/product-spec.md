# InkQueue v0.1 产品规格

InkQueue 是面向旧安卓墨水屏设备的 Agent 同步任务队列 App。桌面显示名为「任务」。目标设备是 Kindle Paperwhite 3，运行 KOSP / CracKDroid Android 4.4.2。

## 定位

InkQueue 不是通用 Todo App，也不是 WebView 网页壳。它是一个轻量任务终端：

```text
用户 -> Agent -> 云端任务数据 -> Kindle 墨水屏端查看/完成/推迟 -> 云端 -> Agent
```

Agent 负责创建、整理、修改任务；Kindle 端只负责查看和少量低输入操作。

## v0.1 范围

已纳入：

- 今日 / 本周 / 以后三段任务首页
- 任务详情页
- 完成任务
- 推迟到明天 / 周末 / 下周
- 本地 SQLite 缓存
- 离线 pending operation 队列
- 简单 token 同步
- 极简设置页：API 地址、Token、Device ID
- Node.js 参考 server
- API 文档和测试数据

不纳入：

- 每日简报、RSS、AI 新闻
- 招聘 / 国企 / 事业编 / 公务员机会雷达
- 登录、多用户、复杂云部署
- 子任务、日历视图、通知推送
- WebView 主 UI、Flutter、React Native、Kotlin、Compose、Material UI

## 设备约束

- Android minSdkVersion 19
- 512MB RAM 级别设备
- 6 寸黑白墨水屏
- 屏幕刷新慢、触控不灵敏、输入体验差

因此客户端只使用原生 Android Java、Activity、TextView、ListView、LinearLayout、SQLiteOpenHelper、SharedPreferences、HttpURLConnection、org.json。

## 信息架构

### 首页

固定分组：

1. 今日
2. 本周
3. 以后

规则：

- 首页先显示本地缓存，再后台同步。
- 首页不显示 `done` 或 `archived` 任务。
- 过期未完成任务进入「今日」顶部。
- `force_today` 或 `today` 为 true 时进入「今日」。
- 无 `due_date` 的任务进入「以后」。
- 首页不放完成/推迟按钮，避免误触。

### 详情页

展示任务标题、备注、时间、项目、优先级，并提供操作：

- 完成
- 推迟到明天
- 推迟到周末
- 推迟到下周
- 返回

完成/推迟先写本地 SQLite，再写 pending operation，然后异步尝试同步。

## 推迟规则

周起始日为周一，周末为周六。

- 明天：`due_date = 今天 + 1 天`
- 周末：周一至周五推迟到本周六；周六或周日推迟到下周六
- 下周：推迟到下周一
- 原任务有 `due_time` 则保留；没有则不新增

## UI 语言

InkQueue 使用「墨水屏工作手册」风格：白底黑字、大字号、高对比、少装饰、无动画、无阴影、无图片。层次主要依赖字号、字重、分隔线和留白。

建议字号：

- 页面标题：22sp
- 分组标题：18sp
- 任务标题：17sp
- 元信息：13sp / 14sp
- 详情正文：16sp
- 操作项：18sp

颜色：

- 背景：`#FFFFFF`
- 主文字：`#000000`
- 次级文字：`#333333`
- 分隔线：`#000000`

## 数据模型

核心任务字段：

```json
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
```

`due_date` 和 `due_time` 分开，便于全天任务和推迟逻辑。

## 同步策略

云端是主数据源；Kindle 是本地缓存 + 操作队列。

同步顺序：

1. App 打开后立即显示本地缓存。
2. 后台上传 pending operations。
3. 上传成功后拉取最新 snapshot。
4. 用 snapshot 替换本地任务表。
5. 上传失败则保留 pending operations。
6. 拉取失败则继续显示本地缓存。

v0.1 冲突规则：设备端完成/推迟只通过 operation 修改 `status/due_date/due_time/completed_at`，不覆盖 Agent 修改的标题和备注；最终 `updated_at` 由服务端写入。
