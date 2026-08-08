# InkQueue 开发说明

## 技术选择

Android 客户端：

- Java
- minSdkVersion 19
- Activity + 原生 View
- SQLiteOpenHelper
- SharedPreferences
- HttpURLConnection
- org.json

参考 server：

- Node.js 内置 `http` 模块
- JSON 文件持久化
- 无运行时 npm 依赖

## 本地工具链

仓库支持项目内本地工具链：

- `.tools/jdk`：Temurin JDK 17
- `.tools/android-sdk`：Android command-line tools、platform-tools、platforms、build-tools
- `.tools/gradle`：`android/gradlew` 自动下载 Gradle 8.7

这些目录不应提交。

## Android 构建

```bash
cd android
./gradlew assembleDebug
```

APK 输出：

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

如果使用外部 SDK，也可以设置：

```bash
export ANDROID_HOME=/path/to/android-sdk
```

## Server 运行

```bash
cd server
npm start
```

默认：

- 端口：`8787`
- Token：`dev-token`
- 数据文件：`server/data/tasks.json`

可通过环境变量覆盖：

```bash
INKQUEUE_PORT=8788 INKQUEUE_TOKEN=my-token npm start
```

## 测试

Server API 测试：

```bash
cd server
npm test
```

Android JVM 单元测试：

```bash
cd android
./gradlew testDebugUnitTest
```

已覆盖：

- DateUtils 推迟规则
- due_time 保留规则
- 首页分组规则
- JSON snapshot 解析
- JSON API：health / snapshot / create / operations / token 拒绝
- 操作幂等：重复 op_id 不重复改变任务时间戳
- 服务端时间：设备时间不会覆盖 completed_at / updated_at
- Agent Webhook：单任务、批量任务、更新和 event_id 去重

SQLiteOpenHelper 需要 Android runtime。无真机或模拟器时不运行 instrumented repository 测试，改为通过代码审查和 APK 构建验证编译正确性。


## 当前基线（v0.9.4）

- Android `versionName` 以 `android/app/build.gradle` 为准；debug APK 约 **55 KB** 量级（无 AndroidX）。
- 根目录 `npm test`：agent 单测（19）+ server API 单测（31）。
- Android JVM：`cd android && ./gradlew testDebugUnitTest`（29 测试，DateUtils / SectionedTaskList / SyncResult / JsonUtils / PendingOperation）。
- server 模块化于 `server/src/lib/`：`time.js` / `store.js` / `task.js` / `operations.js` / `agent.js` / `http.js` / `usage-routes.js`（cliproxy 仅在此处 require，可由 `INKQUEUE_DISABLE_USAGE=1` 关闭）。
- Server 硬化：`INKQUEUE_TOKEN_PREV`、store `.bak` 轮转/损坏自愈、operations 死信裁剪、**启动时主动 prune**（`start()` 读取 store 后立即 `pruneOperations` 并 `writeStore`）、`ignored_details`、events `device_id` 过滤。
- Agent CLI：`inkq complete` / `postpone` / `morning` / `events --device`（operations 协议，与设备同路径）。
- Autostart：`node scripts/server-ctl.js install` 写 wrapper；创建计划任务需**管理员**权限。

## 真机同步（防火墙开 8787）

Windows Defender 默认拦截 wlan 网段对本机 8787 的 inbound TCP，Kindle
会看到 `ECONNREFUSED`（~600 ms 拒绝，不是 timeout）。

一次性开法（管理员 PowerShell）：

```powershell
New-NetFirewallRule `
  -DisplayName "InkQueue Server (8787)" `
  -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8787 `
  -RemoteAddress 192.168.10.0/24 -Profile Private,Public -Enabled True
```

或可视化界面：`Win+R` → `wf.msc` → 入站规则 → 新建规则 → 端口 →
TCP → 特定本地端口 `8787` → 允许连接 → 勾选「专用」「公用」→
名称 `InkQueue Server (8787)`。

`adb reverse` 在 KOSP 4.4.2 的 adbd 上**不支持**（`adb reverse tcp:8787
tcp:8787` 直接 `error: closed`），所以必须走 Wi-Fi + 防火墙开洞。

## 真机调试（无 root）

APK 是 debuggable，但 KOSP 的 `run-as` 拿不到 packages.list → 报
`Package 'dev.inkqueue' is unknown`。读不到 `/data/data/dev.inkqueue/`
下的 prefs / db。绕法：

- 通过 `am start --es` 传配置（v0.9.8 起 `MainActivity` 接收
  `api_base_url` / `api_token` / `device_id` 三种 extras 自动写 prefs）；
- 看 `adb logcat -s InkQueueSyncClient:V InkQueueSync:V` 跟同步流程；
- `adb shell dumpsys window | grep mCurrentFocus` 确认前台 Activity。
