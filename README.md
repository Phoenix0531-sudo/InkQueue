# InkQueue

**CPA usage and task queue companion for e-ink devices**

[English](README.md) | [中文](README.zh-CN.md)

![CI](https://github.com/Phoenix0531-sudo/InkQueue/actions/workflows/ci.yml/badge.svg)
![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)

InkQueue 是一个面向旧安卓墨水屏设备的 Agent 同步任务队列 App。桌面显示名为 **任务**。

定位：**Agent-synced task queue for e-ink devices.**

用户主要通过 Agent 对话创建、整理、修改任务；Kindle Paperwhite 3 端只负责查看今日/本周/以后任务、查看详情、完成、推迟和同步。

## 目标设备

- Kindle Paperwhite 3
- KOSP / CracKDroid Android 4.4.2
- Android `minSdkVersion 19`
- 512MB RAM 级别
- 6 寸黑白墨水屏
- 触控和输入体验较差

## 为什么不用 Flutter / React Native / WebView

InkQueue 要在 Android 4.4.2 的旧墨水屏上稳定、快速、低内存运行。

因此 v0.1 只使用：

- 原生 Android Java
- Activity + TextView + ListView + LinearLayout
- SQLiteOpenHelper
- SharedPreferences
- HttpURLConnection
- org.json

不使用 Kotlin、Flutter、React Native、Jetpack Compose、AndroidX/AppCompat/Material Components，也不把 WebView 当主 UI。

## v0.1 功能

- 首页固定分组：今日 / 本周 / 以后
- 打开 App 先显示本地缓存，再后台同步
- 顶部显示最近同步时间
- 手动「同步」入口
- 任务详情页
- 完成任务
- 推迟到明天 / 周末 / 下周
- 离线 pending operation 队列
- SQLite 本地缓存
- 极简设置页：API 地址、Token、Device ID
- Node.js 参考 server
- API 文档和测试数据

不做：每日简报、RSS、AI 新闻、招聘机会雷达、微信读书功能、登录系统、多用户系统、子任务、日历、通知推送、图片 UI、动画 UI。

## 项目结构

```text
InkQueue/
  README.md
  docs/
    product-spec.md
    api.md
    development.md
  android/
    settings.gradle
    build.gradle
    gradlew
    app/
      build.gradle
      src/main/
        AndroidManifest.xml
        java/dev/inkqueue/
          MainActivity.java
          TaskDetailActivity.java
          SettingsActivity.java
          data/
          sync/
          ui/
          util/
        res/
      src/test/java/dev/inkqueue/
  server/
    README.md
    package.json
    src/server.js
    data/tasks.json
    test/api.test.js
  scripts/
    bootstrap-android-tools.sh
  tests/api-examples/
    snapshot.json
    operations.json
```

## 参考 server 启动

环境：Node.js 18+。

推荐用进程脚本（避免 8787 残留多实例）：

```bash
# 从仓库根目录
node scripts/server-ctl.js start
node scripts/server-ctl.js status
node scripts/server-ctl.js restart
node scripts/server-ctl.js stop
```

或直接：

```bash
cd server
npm start
```

默认：

- URL: `http://localhost:8787`（绑定 `0.0.0.0`，局域网可访问）
- Token: `dev-token`
- Header: `X-InkQueue-Token: dev-token`
- 数据文件: `server/data/tasks.json`
- 产品时区: **Asia/Shanghai**（服务端 `server_time` / 客户端分组与推迟均按北京时间）

健康检查：

```bash
curl http://localhost:8787/v1/health
```

创建测试任务（或一键样例）：

```bash
# 单条
curl -X POST http://localhost:8787/v1/tasks \
  -H "Content-Type: application/json" \
  -H "X-InkQueue-Token: dev-token" \
  -d '{"title":"整理 BootSem 文档","due_date":"2026-07-06","due_time":"14:00","project":"BootSem","priority":"normal"}'

# 一批样例（今日/本周/以后）
node scripts/seed-sample-tasks.js
```

拉取任务：

```bash
curl http://localhost:8787/v1/tasks/snapshot \
  -H "X-InkQueue-Token: dev-token"
```

上传完成/推迟操作：

```bash
curl -X POST http://localhost:8787/v1/tasks/operations \
  -H "Content-Type: application/json" \
  -H "X-InkQueue-Token: dev-token" \
  --data-binary @../tests/api-examples/operations.json
```

## CLIProxyAPI 健康 / 账号池面板

InkQueue server 读本机 CLIProxyAPI 账号池（默认 `~/.cli-proxy-api`）并探活 `http://127.0.0.1:18317/v1/models`。

**不重启 CLIProxyAPI 也能看账号池**（读本地 auth 目录 + `/v1/models`）。

若已配置 Management：

- CLIProxy `config.yaml`：`remote-management.secret-key`（启动后会 bcrypt 哈希）
- InkQueue `server/data/config.json`：`cliproxy_management_key`
- 面板会额外显示 runtime success/failed、auth_status、usage-queue

配置（`server/data/config.json`，已 gitignore）：

```json
{
  "cliproxy_base_url": "http://127.0.0.1:18317",
  "cliproxy_api_key": "sk-cliproxy-local",
  "cliproxy_auth_dir": "~/.cli-proxy-api",
  "cliproxy_management_key": "mg-cliproxy-local"
}
```

接口：

```bash
# 探活
curl http://localhost:8787/v1/cliproxy/health \
  -H "X-InkQueue-Token: dev-token"

# 账号池汇总 + 脱敏列表
curl http://localhost:8787/v1/cliproxy/pool \
  -H "X-InkQueue-Token: dev-token"

# Kindle 用量总接口（仅 CPA / cliproxyapi；force=1 跳过短缓存）
curl "http://localhost:8787/v1/usage?force=1" \
  -H "X-InkQueue-Token: dev-token"
```

浏览器管理面板：

```text
http://localhost:8787/admin/cliproxy?token=dev-token
```

### Codex 健康与额度（重要）

- `/v1/usage` **默认会探活 Codex**（最多 5 个账号），用 `chatgpt.com/backend-api/wham/usage` 校验 token 是否真可用。
- 仪表盘 **`codex_enabled` = 探活成功数**，不是 auth 目录文件数。文件里有 3 个、2 个 401 时显示 **可用 1 · 失效 2**。
- **InkQueue 不删除 / 不禁用 401 账号文件**。清理交给 CLIProxyAPI 或账号导入侧；文件消失后本服务自动不再计入。
- 额度百分比来自接口 `rate_limit.primary_window.used_percent`；窗口标签来自 `limit_window_seconds`（例如 `604800` → **7 天**）。**禁止写死「5 小时」**——当前 Plus 实测常为 7 天窗口，`secondary_window` 可能为 null。
- 累计「成功 N 次」是 CPA **调用次数**，不是账号数。

可选 query：

- `?force=1`：跳过 usage 短缓存（SYNC 默认带）
- `?codex_usage=1`：历史兼容；当前默认已探 Codex，语义等同强调额度详情

## Android 构建

本项目在 Windows + Git Bash 下验证。当前机器项目内已安装本地工具链：

- JDK: `.tools/jdk`，Temurin 17.0.19
- Android SDK: `.tools/android-sdk`
- adb: 37.0.0
- Gradle: `android/gradlew` 自动下载 `.tools/gradle-8.9`

如果 `.tools` 不存在，可先运行：

```bash
./scripts/bootstrap-android-tools.sh
```

构建 APK：

```bash
cd android
./gradlew assembleDebug
```

输出：

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

本机近期构建量级：约 **68KB**（无 AndroidX / 无重依赖）。具体 SHA 每次构建会变，以本地 `sha256sum` 为准。

## 安装到设备

先确认设备通过 ADB 连接：

```bash
adb devices
```

安装：

```bash
cd android
../.tools/android-sdk/platform-tools/adb.exe install -r app/build/outputs/apk/debug/app-debug.apk
```

或如果系统 `adb` 在 PATH 中：

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

启动后桌面显示名是「任务」。

## App 配置

进入 App 底部「设置」，或长按首页标题「任务」进入设置页。

默认值：

- API 地址：`http://10.0.2.2:8787`
- Token：`dev-token`
- Device ID：`kindle-pw3`

如果在真机 Kindle 上访问电脑局域网 server，把 API 地址改成电脑局域网 IP，例如：

```text
http://192.168.1.23:8787
```

v0.1 支持 HTTP，便于局域网测试；生产环境建议 HTTPS。

## 验证完成/推迟同步

1. 启动 server。
2. 用 `POST /v1/tasks` 创建任务。
3. 在 App 设置中填写电脑 IP、Token、Device ID。
4. 点击首页「同步」。
5. 进入任务详情页。
6. 点击「完成」或「推迟到明天/周末/下周」。
7. 再请求 snapshot 检查服务端数据变化：

```bash
curl http://localhost:8787/v1/tasks/snapshot \
  -H "X-InkQueue-Token: dev-token"
```

完成操作会把任务 `status` 改为 `done`；推迟操作只修改 `due_date`，保留原 `due_time`。

## 测试

Server API + CLIProxy 单元测试：

```bash
cd server
npm test
```

预期：全部 pass（含 Codex 额度窗口解析、`7天` 标签、探活计数语义）。

Android JVM 测试 + 构建：

```bash
cd android
./gradlew testDebugUnitTest assembleDebug
```

样例任务：

```bash
node scripts/seed-sample-tasks.js
```

## 已知限制

- 参考 server 使用 JSON 文件持久化，单 token，不是多用户生产后端。
- Android 客户端不提供 Kindle 端创建任务入口；任务由 Agent / `POST /v1/tasks` 写入。
- 无后台常驻推送；同步发生在打开 App、点 SYNC、或完成/推迟后（在线时）。
- 离线时本地操作入 pending 队列；上传失败累计 10 次后丢弃该 op，避免堵死队列。
- Codex 401 / 失效账号文件由 **CLIProxyAPI / CPAMP 侧**清理；InkQueue 只显示失效，不改 auth 目录。
- 当前本机 auth-dir 可能只有 Grok、无 Codex 文件，则仪表盘诚实显示 **Codex 可用 0**。
- Management 密钥错误会 401，连错多次会 IP 临时 ban（约 30 分钟）；解 ban / 重设 secret 在 CPA 侧。
- Grok 无稳定「剩余 %」接口字段；仪表盘以账号池容量为主。
- v0.1 支持局域网 HTTP；生产建议 HTTPS。

## Roadmap

- 生产后端可替换为 Cloudflare Worker + D1/KV。
- 更严格的 per-device token。
- Android instrumented repository 测试。
- Brief / RSS / 机会雷达等独立未来项目，不属于 InkQueue v0.1。

## License

[MIT](LICENSE) — free for commercial use with attribution.
