# InkQueue（可选片段 — 贴进项目 AGENTS.md 或 Codex 说明）

本机任务队列在仓库 `D:/3_Code_Projects/InkQueue`。

需要把「稍后由人执行」的步骤落到 Kindle 墨水屏时：

```bash
node D:/3_Code_Projects/InkQueue/agent/inkq.js context
node D:/3_Code_Projects/InkQueue/agent/inkq.js add --title "..." --due tomorrow
```

契约见：`D:/3_Code_Projects/InkQueue/agent/interface.md`

- 只通过 `inkq` 写队列，不要手改 `server/data/tasks.json`
- 工程收尾的「待真机验证 / 待你确认」应 `add`，不要只留在终端输出
- 不读取、不依赖 Hermes 会话文件
