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
- API health / snapshot / create / operations / token 拒绝

SQLiteOpenHelper 需要 Android runtime。无真机或模拟器时不运行 instrumented repository 测试，改为通过代码审查和 APK 构建验证编译正确性。
