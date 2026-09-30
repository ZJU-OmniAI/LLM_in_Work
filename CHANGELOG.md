# 更新记录 / Changelog

## 2026-10-01 — LLM_in_Excel 0.1.0

- **New: LLM_in_Excel.** The same workflow for spreadsheets: add one or several cell ranges (Cmd/Ctrl multi-select), including empty columns to fill, describe the change, review a cell preview with the old values struck through, and apply. Clean up names and regions, sort rows into categories, write formulas, fill blanks, fix typos or translate. Only changed cells are written, as if typed: number formats stay, IDs like `00123` stay text, and every applied edit has a one-click Undo that also restores number formats. **Workbook Q&A** summarizes, finds problems, explains formulas and suggests charts, citing cell addresses.
- Runs as its own local service on `127.0.0.1:8397`. On macOS it reuses the trusted certificate of LLM_in_Word or LLM_in_PowerPoint.

中文：新增 **LLM_in_Excel**：选中一块或几块单元格区域（也可以是要填写的空白列），说出要做什么，预览里划掉旧值、显示新值，确认后应用。可以清洗整理、分类打标、写公式、补全空白、修错别字、翻译。只写入有变化的单元格，写法和手动输入一致：数字格式不变，`00123` 这样的编号仍是文本；每处修改都能一键撤销（连数字格式一起恢复）。「表格问答」可以总结、找异常、解释公式、推荐图表，回答注明单元格地址。独立服务 `127.0.0.1:8397`，macOS 上沿用 Word 版或 PowerPoint 版已信任的证书。

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
