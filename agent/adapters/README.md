# adapters/ — 可选参考，默认不用

**InkQueue 主路径不依赖任何 skill / adapter / MCP。**

日常请直接：

```bash
node agent/inkq.js …
```

并遵守 `../interface.md`。HTTP 只在 `../lib/client.js`。

本目录仅在「某家 Agent 产品强制要求 skill / MCP / 规则文件形态」时使用。  
**不要安装、不要当依赖、不要在文档里当主流程宣传。**

| 路径 | 说明 |
|------|------|
| `hermes/SKILL.md` | 若你坚持用 Hermes skill 形态，可自行复制；非必需 |
| `codex/AGENTS.snippet.md` | 可粘贴片段；非必需 |
| `mcp-inkqueue/` | 可选 **stdio MCP 薄外壳**（零依赖，tools 对齐 inkq）；仅宿主只认 MCP 时用 |

新增 Agent ≠ 新增协议：只可能多一份可选说明书或外壳，**禁止** fork `inkq.js` / 再写一套 HTTP。
