# InkQueue

**CPA usage + agent task queue companion for e-ink (native Android)**

[English](README.md) | [中文](README.zh-CN.md)

![CI](https://github.com/Phoenix0531-sudo/InkQueue/actions/workflows/ci.yml/badge.svg)
![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)

InkQueue is an **agent-synced task queue** and CPA usage companion for old e-ink Androids (Kindle PW3 / KOSP 4.4.2). Desktop label: **任务**.

Humans talk to an agent to create/edit tasks; the device only lists today / week / later, opens detail, completes, snoozes, and syncs. Native Android only — **no** Flutter / RN / WebView in v0.1.

## Why this exists

512MB-class e-ink devices need a tiny native shell. Agent orchestration and CPA accounting stay on the Node server; the client stays dumb and fast.

## Features

- Native Android client (`android/`), `minSdkVersion 19`
- Node server under `server/` for queue + usage APIs
- Task model oriented around agent-written payloads
- Scripts for local bring-up

## Install / run

```bash
git clone https://github.com/Phoenix0531-sudo/InkQueue.git
cd InkQueue/server
npm install
npm start
# build/install android/ with Android Studio or gradle
```

See `server/README.md` and `android/` for ports and tokens.

## Tests

```bash
# server unit tests when present
cd server && npm test
# repo-level pytest if Python helpers exist
pytest tests/ || true
```

## Project layout

```
android/
server/
scripts/
tasks/
tests/
```

## What this is not

- Not a general GTD cloud like Todoist
- Not a cross-platform Flutter app

## License

MIT. Free for commercial use with attribution. See [LICENSE](LICENSE).
