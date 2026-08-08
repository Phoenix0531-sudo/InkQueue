# StoreBackend 抽象

v0.9.6 起 server 的持久层抽到 `server/src/lib/backends/`。`store.js` 退化为工厂薄入口：
所有 server.js / 测试仍调 `require('./lib/store').create({ dataFile })`，
返回对象暴露 `readStore / writeStore / operationStore / emptyStore / ensureDataFile / backupPath / rotateStoreBackups / tryLoadStoreFrom / DATA_FILE` —— 与 v0.1–v0.9.5 期间 `store.js` 自己实现这堆方法时的签名**完全一致**，无破坏。

## 接口契约

任何新 backend 必须实现（参考 `backends/json-file.js`）：

```js
interface StoreBackend {
  emptyStore():       { tasks: [], operations: [] };
  ensureDataFile():   void;
  readStore():        { tasks: Array, operations: Array };
  writeStore(store):  void;
  operationStore(store): Array;   // 返回 store.operations 的 live 引用
  backupPath(slot?):  string;
  rotateStoreBackups(): void;
  tryLoadStoreFrom(filePath): store;
  DATA_FILE:          string;
}
```

## 选取

`INKQUEUE_STORE_BACKEND` 环境变量选 backend：

- `json-file`（默认）→ `lib/backends/json-file.js`：`.tmp` 原子 rename + 三层 `.bak/.bak.1/.bak.2` 备份 + 损坏自愈 + 超过 `INKQUEUE_MAX_STORE_BYTES` 警告 + mtime bump 配合 If-Modified-Since。
- `d1` / `sqlite` → stub（`d1.js` / `sqlite.js`），**当场抛 NotImplementedError**，仅文档化生产路径，不可上线。

## 文件

- `json-file.js` — 默认实现，v0.9.5 行为搬至此
- `d1.js`        — Cloudflare D1 stub，附未来 SQL schema 草案
- `sqlite.js`    — SQLite stub，附 better-sqlite3 计划草案

加新 backend：实现接口 → 在 `store.js` 的 `selectBackend` 里加 case → 真测 → 把 stub 删 stub 注释。
