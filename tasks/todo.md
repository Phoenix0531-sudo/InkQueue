# InkQueue tasks (living)

## Done (2026-07-21 hardening)

- [x] Codex probe: usable count ≠ file count; 401 shown as 失效
- [x] Quota window label from `limit_window_seconds` (7天 when 604800)
- [x] Do not delete 401 auth files from InkQueue (CLIProxy owns cleanup)
- [x] Docs aligned (README / api / review-optimization)
- [x] AsyncTask lifecycle + discovery socket stop onDestroy
- [x] Online check before auto-sync / discovery
- [x] Pending op retry cap (10)
- [x] Asia/Shanghai timezone on Android + server nowIso
- [x] CPA dashboard: hide empty key-usage / zero disabled rows
- [x] scripts/server-ctl.js + seed-sample-tasks.js
- [x] Unit tests for Codex parse + reconcile semantics

## Optional later

- [ ] Instrumented SQLite tests on device
- [ ] HTTPS / non-dev token for non-LAN
- [ ] Silent AlarmManager sync (power-aware)
