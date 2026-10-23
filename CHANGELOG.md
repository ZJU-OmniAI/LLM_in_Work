# 更新记录 / Changelog

## 2026-10-23 — Word 0.7.6 · PowerPoint 0.3.3 · Excel 0.1.3 · Windows install fixes

- Fixes [#18](https://github.com/ZJU-OmniAI/LLM_in_Work/issues/18): on Chinese and other non-UTF-8 Windows systems, `install.ps1` read `manifest.xml` with the ANSI code page and failed to parse it, and running the installer a second time stopped at the folder-permission step with a `SeSecurityPrivilege` error. The installers now read the manifest as UTF-8 and write back only the folder's access rules; the background service reads `runtime.json` as UTF-8. CI now also runs the Windows install test under PowerShell 7, and a static check keeps `Set-Acl` and encoding-less `Get-Content` out of the Windows scripts.

中文：修复 #18：中文等非 UTF-8 的 Windows 上，安装脚本按系统编码读取 `manifest.xml` 导致解析失败；再次运行安装时在设置目录权限一步报 `SeSecurityPrivilege` 错误。现在按 UTF-8 读取清单、只写回目录的访问权限，后台服务也按 UTF-8 读取 `runtime.json`。CI 额外在 PowerShell 7 下跑一遍 Windows 安装测试，并用静态检查防止脚本里再出现 `Set-Acl` 或不指定编码的 `Get-Content`。

## 2026-10-22 — Text size in every assistant · PDF 0.10.1 · Overleaf 0.9.4 · Word 0.7.5 · PowerPoint 0.3.2 · Excel 0.1.2

- Every panel has **A− / A+** to make its text larger or smaller (80%–160%, 10% steps). The choice is remembered. Only the panel content scales: the panel width, the page or document layout, and the header buttons stay the same. In LLM_in_PDF the buttons are in the panel header; in Overleaf, Word, PowerPoint and Excel they are in Settings next to the language menu.

中文：所有助手面板新增「A− / A+」字号调节（80%–160%，每档 10%），选择会记住。只放大面板里的内容，面板宽度、网页或文档排版、顶部按钮都不变。LLM_in_PDF 的按钮在面板顶部，Overleaf、Word、PowerPoint、Excel 在设置里语言菜单旁边。

## 2026-10-22 — LLM_in_PDF 0.10.0 · Paper analysis like alphaXiv, charts and flowcharts

- The paper-reading prompt was rebuilt after comparing answers with alphaXiv's assistant on the same model and papers. Full explanations follow the argument rather than the paper's section order, put the experiment that best tests the main claim up front, check claims against the tables, open the critique with strengths and keep it to about a quarter of the answer, and cite page numbers from the reader's page-marked text. Follow-ups such as "I don't get it" get a plainer walk-through with an analogy and an example.
- Answers can draw bar and line charts (```chart JSON blocks, drawn locally as SVG) and Mermaid flowcharts (```mermaid). Mermaid 12.2.0 is bundled and loaded only when an answer contains a diagram; a diagram that fails to parse stays as code.
- An optional research profile (`~/.llm_in_pdf/profile.md`) lets a full explanation end with a sentence on how the paper relates to your own work.
- Claude runs with `--system-prompt` and Codex with `model_instructions_file`, replacing the coding-agent instructions. The Word, PowerPoint, Excel and Overleaf assistants also replace Claude Code's default system prompt with a short assistant role.

中文：按 alphaXiv 助手的做法重写读论文提示词（同模型、同论文对比验证）：按论证顺序讲、核心实验前置、对照表格核实主张、先讲亮点再讲要打折扣的地方、标注页码；"没看懂"时用类比和例子换个讲法。回答可以画柱状图、折线图和 Mermaid 流程图（Mermaid 随扩展打包、用到时才加载，画不出来时显示为代码）。可选的个人研究档案 `~/.llm_in_pdf/profile.md` 用于在结尾点出与你工作的关系。Claude/Codex 改用替换式系统提示词，Word、PowerPoint、Excel、Overleaf 助手也不再加载 Claude Code 的默认提示词。

## 2026-10-16 — Overleaf 0.9.3 · Write only the changed words

- Overleaf now applies only the changed spans, like the Word, PowerPoint and Excel add-ins, instead of rewriting the whole selection. Replies that change `\cite`/`\ref`/`\label` keys are flagged on the card.

中文：Overleaf 也只写入改动的片段（和 Word、PowerPoint、Excel 一致），不再整段重写；改写动了 `\cite`、`\ref`、`\label` 键名时卡片提醒。

## 2026-10-16 — Word 0.7.4 · Citations and tables

- Zotero/EndNote citation codes are no longer read as text, so manuscripts with many citations are not truncated. Applying a rewrite changes only the changed words and keeps citation fields; replies that change citations are not applied.
- A selection that includes tables is split into body-text and table targets instead of being refused.

中文：Word 读文字时去掉 Zotero/EndNote 引用的域代码，带大量引用的稿子不再被截断；应用改写只改变化的词、引用域保持完好，改动了引用的回复不能一键应用。选区里带表格时自动拆成正文和表格目标，不再报错。

## 2026-10-15 — Word 0.7.3 · PowerPoint 0.3.1 · Excel 0.1.1 · Long-passage diff and Clear target

- The Office add-ins use the same comparison as LLM_in_Overleaf 0.9.2: sentence by sentence, then word by word (Chinese character by character), with long unchanged stretches folded and the number of changes in the card title. Long passages in Word and long text boxes in PowerPoint no longer show as one deletion plus one insertion, and writing back keeps formatting word by word.
- Reply cards have **✕ Clear target** (plus a ✕ next to the target summary), so you can move to the next passage without applying. Earlier previews stay applicable; **🔁 Retry** on a card regenerates that card's own target.
- Word: English paragraphs keep bold, italic and other formatting when applied. Word wraps its exported HTML at about 80 columns, which previously made the pane fall back to plain text.

中文：Word、PowerPoint、Excel 跟上 Overleaf 0.9.2：长段落按句再按词（中文逐字）显示差异，未改动部分折叠；回复卡片新增「✕ 清除目标」，不应用也能去改下一段，之前的预览仍可应用，卡片上的重试只针对它自己的目标。Word 英文段落应用后不再丢加粗、斜体等格式。

## 2026-10-14 — LLM_in_Overleaf 0.9.2 · Long-passage diff and Clear selection

- Long selections now get a word-level diff (Chinese character by character) instead of "too large to compare"; unchanged stretches are folded and the preview shows how many places changed.
- The reply card has **✕ Clear selection** (and the selection summary has a ✕), so you can move to the next passage without applying first. Earlier previews remain applicable after a check that their original text is unchanged.

中文：Overleaf 长选段也能看到逐词/逐字差异，未改动部分折叠；回复卡片新增「✕ 清除选段」，不应用也能去改下一段，之前的预览仍可应用。

## 2026-10-08 — LLM_in_PDF 0.9.2 · Interactive paper reading

- Clarify the PDF introduction in the English/Chinese READMEs, store metadata, listing and popup: read local PDFs and papers from arXiv and other platforms in Chrome, interactively using a local Claude Code or Codex agent for questions about selected passages and figures.
- Refresh publication materials and PDF promotional copy. Version 0.9.2 changes descriptive copy and version identifiers; document handling, permissions and data flow are unchanged.

中文：明确 LLM_in_PDF 帮助用户在 Chrome 中阅读本地 PDF 和 arXiv 等平台论文，交互式调用本机 Claude Code、Codex，选择局部文字、图表或公式进行问答与追问。同步中英文介绍、弹窗和发布材料。

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
