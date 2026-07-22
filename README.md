# InkQueue

**Local-first queue service for agent / e-ink device workflows — Node server + Android client.**

[English](README.md) | [中文](README.zh-CN.md)

[![CI](https://github.com/Phoenix0531-sudo/InkQueue/actions/workflows/ci.yml/badge.svg)](https://github.com/Phoenix0531-sudo/InkQueue/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Internal tooling portfolio piece: a **Node** service under `server/` with npm test CI, Android client experiments under `android/`, plus `scripts/` and `tasks/` helpers. Ports and tokens are environment-specific — keep secrets out of git.

## Preview

![InkQueue](docs/screenshots/preview.png)

## Layout

```
server/      # Node service (primary CI path)
android/     # client experiments
scripts/ tasks/ docs/ tests/
```

## Install / test

```bash
git clone https://github.com/Phoenix0531-sudo/InkQueue.git
cd InkQueue/server
npm install
npm test
# start command: see server README / package.json scripts
```

## License

MIT. See [LICENSE](LICENSE).
