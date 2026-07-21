# InkQueue

**面向墨水屏设备的 CPA 用量与任务队列伴侣**

[English](README.md) | [中文](README.zh-CN.md)

![CI](https://github.com/Phoenix0531-sudo/InkQueue/actions/workflows/ci.yml/badge.svg)
![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)

面向墨水屏设备的 CPA 用量与任务队列伴侣。

> 作者：[Phoenix0531-sudo](https://github.com/Phoenix0531-sudo) · 欢迎学习、二次开发与**商业使用**，请保留本仓库署名与许可证声明。

## 技术栈

Python/服务 · Android

## 功能特性

- 任务队列与用量展示
- 与 CPA / 代理配套
- Android 端友好

## 快速开始

```bash
git clone https://github.com/Phoenix0531-sudo/InkQueue.git
cd InkQueue
```

```bash
cd server
# 按 server 目录启动 API / 队列服务
```

更完整的英文说明见 [README.md](README.md)。

## 仓库结构（摘要）

```
InkQueue/
├─ .github/
├─ android/
├─ docs/
├─ scripts/
├─ server/
├─ tasks/
├─ tests/
├─ LICENSE
├─ README.md
├─ README.zh-CN.md
```

## 测试

```bash
pip install pytest
pytest -q
```

仓库内 `tests/` 至少包含 smoke 测试；有完整测试套件时以 CI 为准。

## CI

GitHub Actions（`push` / `pull_request`）会：

- 安装依赖（requirements / pyproject）
- 运行 `pytest`（**硬失败**）
- 尽力做语法/结构检查

## 许可证

[MIT](LICENSE) — 可自由使用、修改、分发与**商用**，需保留版权与许可声明（提及本仓库 / 作者即可）。

## 关于

维护者：[Phoenix0531-sudo](https://github.com/Phoenix0531-sudo)
