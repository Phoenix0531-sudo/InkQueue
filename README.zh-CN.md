# InkQueue

**墨水屏 CPA 用量 + Agent 任务队列伴侣（原生 Android）**

[English](README.md) | [中文](README.zh-CN.md)

![CI](https://github.com/Phoenix0531-sudo/InkQueue/actions/workflows/ci.yml/badge.svg)
![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)

InkQueue 是面向旧安卓墨水屏（Kindle PW3 / KOSP 4.4.2）的 **Agent 同步任务队列** 与 CPA 用量伴侣。桌面显示名：**任务**。

人主要通过 Agent 创建/整理任务；设备只负责任务列表（今日/本周/以后）、详情、完成、推迟与同步。v0.1 **仅原生 Android**，不用 Flutter / RN / WebView。

## 为什么做这个

512MB 级墨水屏需要极小原生壳。Agent 编排与 CPA 记账放在 Node 服务端；客户端保持简单快速。

## 功能

- 原生 Android（`android/`），`minSdkVersion 19`  
- `server/` Node 队列与用量 API  
- 面向 Agent 写入的任务模型  
- 本地拉起脚本  

## 安装 / 运行

```bash
git clone https://github.com/Phoenix0531-sudo/InkQueue.git
cd InkQueue/server
npm install
npm start
```

端口与 token 见 `server/README.md`、`android/`。

## 目录结构

```
android/
server/
scripts/
tasks/
tests/
```

## 明确不做

- 非 Todoist 类通用云 GTD  
- 非跨端 Flutter 应用  

## 许可证

MIT。可在署名前提下商用。见 [LICENSE](LICENSE)。
