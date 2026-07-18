# InkQueue

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

环境：Node.js 18+。本机验证使用 Node `v24.17.0`。

```bash
cd server
npm start
```

默认：

- URL: `http://localhost:8787`
- Token: `dev-token`
- Header: `X-InkQueue-Token: dev-token`
- 数据文件: `server/data/tasks.json`

健康检查：

```bash
curl http://localhost:8787/v1/health
```

创建测试任务：

```bash
curl -X POST http://localhost:8787/v1/tasks \
  -H "Content-Type: application/json" \
  -H "X-InkQueue-Token: dev-token" \
  -d '{"title":"整理 BootSem 文档","due_date":"2026-07-06","due_time":"14:00","project":"BootSem","priority":"normal"}'
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

本机已构建出的 APK：

- 大小：`36808` bytes
- SHA-256：`a8f9129bdda134d1bbb5b688c802360407848933dda5048cb6ac5dc4ca35f539`

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

Server API 测试：

```bash
cd server
npm test
```

本机真实输出摘要：

```text
✔ health endpoint returns ok without token
✔ snapshot rejects missing token
✔ create task, snapshot, complete and postpone operations
tests 3, pass 3, fail 0
```

Android JVM 测试：

```bash
cd android
./gradlew testDebugUnitTest
```

本机真实测试结果：

```text
TEST-dev.inkqueue.ui.SectionedTaskListTest.xml: tests=2 failures=0 skipped=0
TEST-dev.inkqueue.util.DateUtilsTest.xml: tests=7 failures=0 skipped=0
TEST-dev.inkqueue.util.JsonUtilsTest.xml: tests=1 failures=0 skipped=0
TOTAL tests=10 failures=0 skipped=0
```

Android 构建验证：

```bash
cd android
./gradlew testDebugUnitTest assembleDebug
```

本机真实输出：

```text
BUILD SUCCESSFUL
```

Android lint 验证：

```bash
cd android
./gradlew lintDebug
```

本机真实输出：

```text
BUILD SUCCESSFUL
```

API curl 端到端验证摘要：

```text
health={  "ok": true}
created_task=task_mrbecrf2_e41a283f
snapshot_count=2
operations={ "accepted": ["op_test_complete"], "ignored": [], "errors": [] }
final_status=done
```

## 已知限制

- 当前环境 `adb devices` 没有检测到真机或模拟器，因此没有完成真机安装/点击测试。
- SQLite Repository 的 instrumented 测试需要 Android runtime；当前 v0.1 通过 JVM 逻辑测试、server API 测试和 APK 编译验证。
- v0.1 是单设备/单 token 参考实现，不是多用户生产后端。
- 参考 server 使用 JSON 文件持久化，不适合高并发。
- Android 客户端不提供 Kindle 端创建任务入口，任务创建主要由 Agent/Server API 完成。
- 无后台常驻服务和推送；同步发生在打开 App、点击同步或完成/推迟后。

## Roadmap

- 生产后端可替换为 Cloudflare Worker + D1/KV。
- 可增加更严格的 per-device token 管理。
- 可增加 Android instrumented repository 测试。
- 可增加 Brief / RSS / 机会雷达等独立未来项目，但不属于 InkQueue v0.1。
