# InkQueue e2e log

## v0.8.2 真机回归 + SQLite leak（2026-08-04 早）

APK：`app-debug.apk` 49,826B (version 0.8.2)  
Server：`:8787`  
设备：Kindle PW3 (`06702091551305IY`)

1. **SQLite leak** — `InkQueueDatabase` / `TaskRepository` 单例；连续同步 + 完成/推迟，logcat **0** 次 connection leak。  
2. **同步** — 冷启动自动同步、手动 sync、详情完成/推迟、`due_time` 保留、批量过期推迟。  
3. **截屏** — `docs/screenshots/v082-*.png`。

## Agent 接口层 + 真机闭环（2026-08-04 晚，无 skill）

同仓新增 `agent/`（`inkq.js` + `interface.md`）。**不装 Hermes skill**，主路径纯 CLI。

### 验证步骤（实测）

1. `node scripts/server-ctl.js start` → `:8787`  
2. `node agent/test-inkq-smoke.js` → **All inkq smoke checks passed**  
3. `node agent/inkq.js add` 写 2 条今日任务（UTF-8 标题）  
4. Kindle 在线；设备能 `busybox wget http://<WLAN-IP>:8787/v1/health` → `{"ok":true}`  
5. App 冷启动自动 `GET /v1/tasks/snapshot` **code=200**，本地 SQLite 出现：
   - `task_msejg976_…` 核对 InkQueue agent 层文档是否一致  
   - `task_msejg9b1_…` Kindle 同步看今日队列  
   - `last_sync_time=2026-08-04T19:54:38+08:00`  
6. **完成**：列表勾选 → `POST operations ops=1 accepted=1` → server `status=done`，event `complete`  
7. **推迟**：长按 →「推迟到明天」→ `accepted=1` → `due_date=2026-08-05`，event `postpone`  
8. `node agent/inkq.js list --due today` → **0**；events 含上述 complete/postpone  

### 结论

**inkq → server → Kindle → operations → events → inkq** 闭环在真机跑通。  
adapters/ 仅可选参考，默认不用。
