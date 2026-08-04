# InkQueue UI 调研报告 v0.7

> 目标：诚实回答"现在界面有点丑，能不能改进"。
> 调研产物，不是改代码 commit。代码改动清单在最后一节，等用户确认后才执行。

## 一、当前现状（对真实截图的像素级分析）

基于 `docs/screenshots/audit/a-today.png`（v0.6 APK 真机截屏）逐行扫描：

| 区域 | 坐标 | 内容 | 现存问题 |
|------|------|------|---------|
| Masthead | y=30–64 | "任务" 30sp + 状态 17sp | 标题与状态同高同行，状态气场被压成小字旁注 |
| Masthead rule | y=70 | 2px 横线 (992 黑像素) | OK |
| Tab labels | y=110–134 | 22sp 字 | **未选中 tab 用 `Typeface.DEFAULT`（不加粗）来表示"非选中"，跟 ACM 指南一致；但字体重量差太弱**，远看四个 tab 都像一样的灰字 |
| 选中 tab 下划线 | y=145 | 3px 高 × 248px 宽（仅 colW 宽度） | **下划线只占单栏宽，3px 偏细**——和 ACM CHI26 论文 §3.3.1 要求的"a thick black line under a currently selected tab"相比偏弱；读者第一眼反应不过来哪个被选中 |
| Tab bar rule | y=148 | 1px 横线 (992 黑像素) | OK |
| Section header | y=205–239 | "今日" 24sp bold + section rule | OK |
| Section 间距 | section_top=32 / section_bottom=14 | 顶 32、底 14 | **上下不对称**，"今日"标题"贴"到上方的 tab rule 很近，但离下方列表留白不够 |
| Task row | y=285–339 | 22sp bold title + 17sp meta | OK |
| Task 上下 padding | ROW_PAD_V=28 / row 1px rule | 每行 28px 顶留白 | **行间拥挤**——两条 1px 黑线之间夹住的视觉密度偏高，墨水屏看久了累 |
| Checkbox | 44×44px | 空心方框 1.5px stroke | **44px 方框在 22sp 字旁偏大**，抢视觉重心 |
| Footer rule | y=1244 | 2px 横线 (992) | OK |
| Footer label | y=1290–1308 | "同步" "设置" 22sp bold | **间距 30–60 黑像素/行很稀疏**；FOOTER_H=110 但触控区被 rule 吃掉，文字位置偏上留下面一截空 |

读者第一眼的直觉问题（诚实结论）：

1. **像"密集排版的内部工具"，不像一本安静的纸面手册。**
   每行紧贴两条线，看起来像 Excel。
2. **Tab 选中态不够强**——四个 tab 远看差不多，要凑近才能看出哪个加粗了。
3. **Checkbox 44px 太显眼**——视觉重量盖过了真正的任务标题。
4. **Footer 触控虽然 110px 但视觉小气**——文字稀疏，下半截真空区。
5. **页 masthead 头重脚轻**——"任务" 30sp 标题下方接 17sp 状态，状态被压成跟正文一样细。

## 二、调研依据：ACM CHI 2026 "A Dedicated E-Paper Design System for Mobile Phones"

源：doi:10.1145/3772318.3791459（2026）——是目前能查到的唯一一篇专门为 e-paper 显示屏做的设计系统论文。提取出与 InkQueue 直接相关的三条：

### §3.1 五条 e-paper 设计原则

1. **Show UI Controls** — 不靠隐藏手势，所有交互元素本身可见、可识别。
   InkQueue 现状基本满足（footer、tab 都可见）。但 long-press 进入设置不在 v0.6 暴露。**建议保留 long-press 但加一句 footer hint**。
2. **Stick to Black and White** — 纯黑 `#000` + 纯白 `#FFF`，不要用大面积灰色填充来表达状态；若必须分级，用 **dotted / raster patterns（点阵、虚线）** 代替灰。
   InkQueue 现状符合（非选中 tab 用 `Typeface.DEFAULT` 区分，而非灰字）。但代码里 `ink.setColor` 没有刻意写 `0x00000000` 此类 supress 端点，**需 memo 一行**。
3. **Fit Content to Reading Pacing on an E-Paper Screen** — 内容适合 e-paper 的"页"式阅读节奏，不要无限长滚动条。
   InkQueue 已经是 tab + 分页式，符合。但**当任务多时仍 scroll**——可在多任务时增加显式的"第 1/N 屏"指示。
4. **Replace Animations with Static Sequential Views** — 不用动画，每屏明确展示"当前状态 + 下一步该干什么"。
   InkQueue 全程无动画，符合。
5. **Avoid Large Dark Regions** — 大面积黑色会加剧 ghosting + 耗电 + 降速。
   InkQueue 现在 checkbox 44px stroke 方框 + tab 选中色块都不大，整体无大面积黑色，符合。但**未来如果做 toast 或进度条，要避免实心黑块**。

### §3.3.1 Navigation Bar（直接对应 InkQueue tab bar）

> 原文："we rely on contrast, keeping a **thick black line under a currently selected tab**, along with **greater font weight** replacing colored backgrounds with **typographic and line-based emphasis**."

对照 InkQueue：

| 论文要求 | InkQueue 现状 | 评分 |
|---------|--------------|------|
| thick black line | 3px 高、248px 宽 | ⚠️ 偏细 |
| greater font weight (选中 tab) | bold vs 默认 | ⚠️ 区分弱 |
| 不用彩色背景 | 无 | ✓ |
| icon + label | 只有文字 | ✓（InkQueue 不需要图标，更克制） |

→ **结论：选中态要做两件增量**：(a) tab 下划线加粗到 5px；(b) 加大选中/未选中字的字号差（26sp 加粗 vs 22sp 不加粗）。

### §3.3.2 Top App Bar

> 原文："we emphasize titles and primary actions through **font weight and spacing** rather than color or shadow."

InkQueue masthead 现状：30sp title 与 17sp status 同 baseline，status 被视觉压没。**建议状态单独成一行，字号提到 18sp，与 title 之间留 8sp 空隙**——title 不再被压。

### §3.3.3 Scrollbar / 分页

论文中（A-D 三种 scrapybar）都用"**discrete, paged scrolling**"替代连续滚动。InkQueue 现在如果任务很多会变成单一长画布——一旦超过 4–5 条，**首页就违反了 e-paper"页"心智模型**。v0.7 暂不做翻页（避免界面引入新控件），但需要在多任务时**仅渲染首屏可见**，下方加一句"还有 N 项 · 长按同步查看全屏"提示。

## 三、v0.7 改进方案（代码级，待确认执行）

按 ACM 指南对照 InkQueue 现状，给出**14 条改动**，分三档：

### A. 必做（视觉层级立刻变好）

1. **Tab 下划线 3px → 5px**，并把选中 tab 字号从 22sp → 26sp bold，未选中 22sp regular（更大字号差，更易识别）。
2. **Tab bar 高 68 → 92**，给 tab label 居中留呼吸空间。
3. **Section 上下对称间距**：section_pad_top 32→48，section_pad_bottom 14→22，"今日"下方与首个 task 之间多 8px，避免"贴"。
4. **Task row 留白** ROW_PAD_V 28→36，并把行间 rule 1px 加上"上下各 8px 留白"（视觉上 rule 不再压住文字行）。
5. **Checkbox 44 → 36px**，stroke 1.5 → 2px，方框变小但更清晰，让出视觉重量给标题。
6. **Checkbox 与 title 间距** CHECK_GAP 22 → 24（与缩小后的 checkbox 配合，视觉平衡）。

### B. 强烈推荐（提升"安静"感）

7. **Footer 字号** 22 → 26sp，触控区 110 → 140px，让 footer 看起来像"两个大触控区"而非"底部小字"。
8. **Footer 去掉中间竖线**——论文一致推荐"line-based emphasis 取代分隔区"，两个大字本身就够分隔，不需要画线。
9. **Masthead status 单独成行**：title 30sp 不变，下方 8px 处加 status 18sp 居右；rule 下移。
10. **Title 30 → 32sp**，让 masthead 顶部更"封面感"。

### C. 锦上添花（如果还有时间）

11. **多任务指示**：超过首屏可见条数时，footer 上方加一行小字"还有 N 项可同步查看"——这是 ACM §3.3.3 分页指示的精神。
12. **状态颜色 memo**：在 InkMainView 顶部加 `private static final int PURE_BLACK = 0xFF000000;` 常量，所有 `ink.setColor` 用它——避免未来误用灰度。
13. **Detail 页同步应用相同 metric**：section 间距、字号、checkbox 缩小（如有）。
14. **Detail 页"操作"按钮的 stroke**：从细线方框改成"两边内描 1.5px + 中央跨线 0.5px"——更工程手册感。

## 四、PIL 模拟对比

两组 mockup 已生成（非精确，仅 layout 草图，真机渲染仍需看截图）：

- `docs/design/A-current-v0.6.png` — 复刻当前 v0.6 layout
- `docs/design/B-acm-epaper-v0.7.png` — 应用上述改动后的提案
- `docs/design/compare-A-vs-B.png` — 缩小 1/3 的并列对比

> 声明：PIL truetype 缩放 ≠ Kindle e-ink 真实 sp 渲染，仅作 layout 占位参考。最终验证还需要 v0.7 改完走真机截屏像素 diff。

## 五、不做的事（防止AI 过度设计）

- ❌ 不引入图标系统（论文虽秀了 icon，但 InkQueue 走"纸面手册"风，不需要）。
- ❌ 不引入动画、不引入 dotted pattern 灰阶（v0.7 没有需要分级的场景）。
- ❌ 不引入 vertical/horizontal scrollbar 控件（v0.7 不做翻页）。
- ❌ 不引入 GMD 任何 Material 组件。
- ❌ 不改任务数据模型、不改 sync 协议、不改功能集——**只动 paint + layout 常量**。

## 六、改动文件预估

只动两个文件，不动逻辑：

- `android/.../ui/InkMainView.java` — 改 16 个常量值 + masthead 改两行绘制 + footer 去竖线
- `android/.../ui/InkDetailView.java` — 改对应常量保持视觉一致

预计：30–50 行改动，构建一次，真机截屏一次，对比端口带宽即可收敛。

---

待用户确认是否执行上述 14 条；执行后产出 v0.7 截屏与 v0.6 像素 diff 对比。
