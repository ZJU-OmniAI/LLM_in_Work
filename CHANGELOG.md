# 更新记录 / Changelog

## 2026-10-08 — Chrome publication preparation · Overleaf / PDF 0.9.1

- Prepare separate extension upload ZIPs and local companion bundles, with resource validation, checksums and tests against the extracted packages.
- Align the bilingual store descriptions with the project's purpose: bring local Claude Code / Codex agents into existing workflows, with precise selections, reviewed edits and in-place questions. PDF supports questions without editing the original document.
- Add store graphics, real-model demonstration screenshots, a privacy policy, permission explanations and reviewer instructions. These materials do not represent Chrome Web Store approval.
- Support explicit store extension IDs in both native installers and PDF HTTP CORS. Popups show installation commands for their actual ID; existing development IDs are preserved.

中文：Overleaf、PDF 升至 0.9.1，补齐发布包及商店材料；介绍强调将本机 Agent 接入工作流，实现精确、局部可控的修改和问答。修复商店扩展 ID 与本机桥授权可能不一致的问题，保留原开发版 ID；尚未提交商店审核。

## 2026-10-07 — LLM_in_PDF joins LLM_in_Work

- Import `paper_read` as **LLM_in_PDF 0.9.0**: online/local PDF and paper webpage reading, passage and figure questions, Markdown/math rendering, document history and export.
- Keep extension identity, conversation storage and legacy `PAPER_READ_*` environment settings compatible; new settings use `LLM_IN_PDF_*`.
- Add a quoted macOS/Linux native installer, bundled third-party licenses and PDF CI on Linux/macOS/Windows, including Linux browser regressions. Windows uses the HTTP fallback.
- Restrict the PDF HTTP fallback to loopback hosts and the fixed extension origin, require JSON, and report malformed prompts without terminating the server.
- Update English/Chinese guides, the repository overview and the narrated demo with the fifth assistant.

中文：将 `paper_read` 以 `LLM_in_PDF` 纳入仓库；保留扩展 ID、会话与旧环境变量，新增安装及浏览器回归，更新中英文文档与五模块介绍视频。

## 2026-10-02 — LLM_in_PowerPoint 0.3.0

- **PowerPoint: whole-slide redesign.** “Polish this slide” and “lay it out again” now re-lay out the slide instead of touching up a few properties: the model can add cards, accent bars and lines, move bullets unchanged into cards, delete stray lines and emptied text boxes, format single paragraphs, set autofit and margins, and change table styles. Big changes are checked once from a new image of the slide and fixed; the card shows before and after. Undo puts back a backup of the whole slide, speaker notes included. Chinese text in new shapes no longer falls back to SimSun.

中文：PowerPoint 的「调整版式」可以整页重排了：能加卡片、色条和线条，把要点原样搬进卡片（不改一个字），删掉多余的线，按段落设格式，调自动调整和边距，换表格样式。大改应用后自动截图自查一轮并修正，卡片上显示改前和改后；撤销时整页原样换回（备注也在）。新建文字的中文不再变成宋体。

## 2026-10-01 — LLM_in_PowerPoint 0.2.0

- **New in PowerPoint: Format mode.** Change how a slide looks, not only its words. Select shapes (or nothing for the whole slide) and ask, for example, “make this black border lighter and thinner”. The model sees an image of the slide and a formatting list of its shapes and returns a plan: position and size, rotation, fill, border, font, alignment, stacking order, table shading/borders/header, and the background colour. The plan is previewed as old → new with colour swatches; out-of-range values and shapes outside the selection are rejected. **↩ Undo** puts the old formatting back, including mixed font sizes and colours character by character; text colour drawn by a table style cannot be read and is the one exception (the card warns before applying).

中文：PowerPoint 新增「调整版式」模式，改格式不改文字。选中形状（不选就是整页），说「把这个黑框改浅一点、细一点」之类的要求；模型看到本页截图和每个形状的格式清单，给出修改方案（位置大小、旋转、填充、边框、字体、对齐、上下层次、表格底色/边框/表头、背景色）。方案按「旧值 → 新值」带色块预览，不合理的数值和没选中的形状会被拦下；应用后一键撤销，混用的字号和颜色也能逐字恢复。

## 2026-10-01 — LLM_in_Excel 0.1.0

- **New: LLM_in_Excel.** The same workflow for spreadsheets: add one or several cell ranges (Cmd/Ctrl multi-select), including empty columns to fill, describe the change, review a cell preview with the old values struck through, and apply. Clean up names and regions, sort rows into categories, write formulas, fill blanks, fix typos or translate. Only changed cells are written, as if typed: number formats stay, IDs like `00123` stay text, and every applied edit has a one-click Undo that also restores number formats. **Workbook Q&A** summarizes, finds problems, explains formulas and suggests charts, citing cell addresses.
- Runs as its own local service on `127.0.0.1:8397`. On macOS it reuses the trusted certificate of LLM_in_Word or LLM_in_PowerPoint.
- **Demo videos updated** (English and Chinese narration): they now cover Word, PowerPoint, Excel and Overleaf, recorded in the real desktop apps.

中文：新增 **LLM_in_Excel**：选中一块或几块单元格区域（也可以是要填写的空白列），说出要做什么，预览里划掉旧值、显示新值，确认后应用。可以清洗整理、分类打标、写公式、补全空白、修错别字、翻译。只写入有变化的单元格，写法和手动输入一致：数字格式不变，`00123` 这样的编号仍是文本；每处修改都能一键撤销（连数字格式一起恢复）。「表格问答」可以总结、找异常、解释公式、推荐图表，回答注明单元格地址。独立服务 `127.0.0.1:8397`，macOS 上沿用 Word 版或 PowerPoint 版已信任的证书。演示视频（中英文讲解）同步更新，新增 PowerPoint 和 Excel 两段真实操作录屏。

## 2026-10-01 — LLM_in_PowerPoint 0.1.0

- **New: LLM_in_PowerPoint.** The Word workflow for slides: add selected words, text boxes, tables, groups or whole slides (up to 16 targets across slides), review a diff per target, and apply. Only the changed words are written, so fonts, colours, bold figures and bullet levels stay; every applied edit has a one-click Undo. Tables change cell by cell and can gain or lose rows. **Slide image** lets the model see the slide; **Presentation Q&A** writes speaker notes, checks consistency and finds typos.
- Runs as its own local service on `127.0.0.1:8387`, next to LLM_in_Word. On macOS it reuses LLM_in_Word's trusted certificate, so installing both needs one password prompt.

中文：新增 **LLM_in_PowerPoint**：选中文字、文本框、表格、分组或整页（最多 16 处，可跨页），每处一份差异，应用时只改变化的字词，字体、颜色、加粗和要点层级都保留，还能一键撤销；表格按单元格改、可增删行；可附当前页截图；演示文稿问答可写讲稿、查一致性。独立服务 `127.0.0.1:8387`，macOS 上沿用 Word 版已信任的证书。

## 2026-09-30 — LLM_in_Word 0.7.2

- **A roomier Word pane, laid out like LLM_in_Overleaf:** one summary row at the top; model, language, mode and targets move into a floating **Settings** card. The conversation gets about three times the height.
- **Codex from the desktop apps:** both assistants now find the Codex CLI bundled with the Codex and ChatGPT apps.

中文：Word 侧栏改成和 Overleaf 一样的布局，顶部只留一行，设置和目标收进浮层卡片，对话区高度约为原来的三倍；两个助手都能找到 Codex / ChatGPT 桌面应用自带的 Codex CLI。

## 2026-09-30 — LLM_in_Overleaf 0.9.0 · LLM_in_Word 0.7.1

- **Overleaf in English:** a full English interface with a live English / 中文 switch.
- **Explanations in your language:** both assistants reply in the language of your instruction and keep the document's language in replacements.
- **Safer Overleaf backend:** Claude runs without your MCP servers or extra tools; stricter process lifecycle, timeouts and actionable errors.
- **Overleaf on Windows and Linux:** new installers with a self-check and uninstall option; CI covers all three platforms.
- **Documentation:** redesigned overview, demo videos with Chinese and English narration, bilingual security and contributing guides.

中文：Overleaf 新增英文界面；两个助手的说明文字跟随指令语言；Overleaf 后端安全加固；Overleaf 支持 Windows / Linux 安装；重做总览文档并附中英文讲解的演示视频。

## 2026-09-26 — LLM_in_Work

- Rename the repository from LLM_in_Word to LLM_in_Work, preserving its Git history.
- Move the Word add-in into `LLM_in_Word/`.
- Add the Overleaf extension as `LLM_in_Overleaf/`.
- Add English and Chinese overview pages and separate feature / installation guides.
- Update repository links, installation paths, package metadata and per-project CI.

Project history: [Word](LLM_in_Word/CHANGELOG.md) · [Overleaf](LLM_in_Overleaf/CHANGELOG.md).
