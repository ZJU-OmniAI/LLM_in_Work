# 更新记录

## 0.3.0 — 2026-10-02

**Whole-slide redesign in Format mode.** 0.2.0 could only adjust properties of existing shapes, so “polish this slide” produced small touch-ups. Format mode can now re-lay out a slide.

- **Small changes vs. redesigns.** The prompt tells specific requests (“lighter border”) apart from redesigns (“polish”, “lay out again”, “too cluttered”) and gives the model a layout brief: margins and grid, size hierarchy, palette, common layouts (bullet cards, text left / picture right, big numbers, process, tables), and how to estimate whether text fits.
- **New operations.** Add rectangles, rounded rectangles (with corner size), ovals, lines and text boxes; move paragraphs **unchanged** from an existing shape into a new card (`"from": {"id": "3", "para": "2"}`, keeping bold and colours); delete stray lines, empty shapes and text boxes whose every paragraph was moved; format some paragraphs only (`"para": "2-4"`, bullets off); text box margins, word wrap and autofit; a different table style. Typed text is limited to short labels, so the model cannot write content.
- **Checks.** Pictures keep their aspect ratio, shapes are kept on the slide, titles, pictures and tables cannot be deleted, and a text shape is only deleted when all its paragraphs were moved.
- **Self-check round.** After applying a big change, the pane sends a new image of the slide, the new formatting list and the geometry problems it detects (overlaps, off-slide, edge-touching) back to the model, applies its fix if any, and shows the slide before and after on the card. The card says so honestly when the check found problems it could not fix.
- **Whole-slide undo.** Structural plans back the slide up with `slide.exportAsBase64()` (PowerPointApi 1.8) and undo by inserting the backup in its place: identical rendering, speaker notes kept. This also makes style-drawn table text and gradient fills undoable. Undo asks first if the slide changed after applying.
- **Chinese fonts.** Latin font names are applied to Latin characters only, and Chinese text in new shapes gets the slide's Chinese font (or Microsoft YaHei), because PowerPoint otherwise shows it in SimSun.
- Presets **整页美化 / Polish slide** and **重新排版 / New layout**.
- Tested in real PowerPoint 16.109 on a text-heavy Chinese slide, three scattered boxes with a table, and an English chart slide; offline tests now cover redesign, self-check, whole-slide undo and fonts (104 tests).

中文摘要：版式模式可以整页重排了。以前只能改现有形状的属性，「美化这一页」只会小修小补；现在能新增卡片、色块和线条，把要点原样搬进卡片（不改一个字），删掉多余的线和已搬空的文本框，按段落设格式，调文本框边距和自动调整，换表格样式。大改应用后自动截图自查一轮并修正，卡片上显示改前和改后；撤销时用应用前的整页备份原样换回（备注也在）。新建文字的中文不再落成宋体。

## 0.2.0 — 2026-10-01

**Format mode: change how a slide looks, not just its words.** A third mode, **调整版式 / Format**, sits between Rewrite and Q&A.

- **Scope follows the selection.** Select one or more shapes, or nothing for the whole slide (including its background). The pane shows the scope and attaches an image of the slide automatically.
- **The model sees the formatting.** Each shape is listed as one JSON line: type, name, position and size, rotation, fill, border, font (with `"mixed"` where runs differ), alignment, and for tables the header/body shading and border colours; plus theme colours and the background.
- **Plans, not free text.** The reply carries a ```` ```format ```` JSON plan: geometry, rotation, fill, border (`line`, or `"none"`), font, alignment, stacking order, table regions (`cells`: `all`, `header`, `body`, `first-col`, `last-row`, `r2c1:r4c3`) with shading, font, alignment and `border` sides, and the slide background. Out-of-scope shapes and out-of-range values are rejected with an explanation.
- **Preview as old → new.** One block per shape, one row per property, with colour swatches. Gradient, pattern and picture fills (and non-solid backgrounds) that Undo cannot restore are flagged.
- **✅ Apply / ↩ Undo.** Every original value is recorded first, including mixed fonts character by character, stacking order and whether the background followed the master. Editing the shapes after the plan was generated triggers a confirmation before overwriting.
- Tables with a table style: style-drawn fills, borders and text colours are marked “table style” (the add-in API cannot read them); border and fill changes are undone by re-applying the table style and writing back what had been set directly. Text colour and bold drawn by the style cannot be restored, and the card says so.
- Presets: lighter borders, consistent fonts, align layout, harmonize colours, stronger title, cleaner table.
- Feature checks per API level: stacking order (1.8), table formatting (1.9), rotation, background and theme colours (1.10).
- Offline tests: the PowerPoint stand-in now models fills, lines, fonts per character, table cell borders and fills, z-order, rotation, backgrounds, theme colours and page size; 10 new format-mode tests.

中文摘要：新增「调整版式」模式，改格式不改文字。选中形状（不选就是整页）后说要求，比如「把黑框改浅一点」；面板自动附上本页截图和每个形状的格式清单，模型给出 JSON 方案（位置大小、旋转、填充、边框、字体、对齐、层次、表格区域的底色/字体/边框、背景色）。方案按「旧值 → 新值」带色块预览，越界的形状和不合理的数值会被拦下；应用前记录全部原值，一键撤销（混合字号逐字恢复、层次逐步移回、背景恢复为跟随母版）。

## 0.1.0 — 2026-10-01

First release of LLM_in_PowerPoint, the PowerPoint counterpart of LLM_in_Word, with the same pane layout and backends.

- **Targets that fit slides.** Add selected words, a whole text box, a table, a group of text boxes, or everything on the current slide (when nothing is selected). Up to 16 targets across slides. Targets are anchored by slide ID, shape ID and character position, checked against the original text before writing, and restored when the pane reopens.
- **Formatting kept.** Only the changed words are written, from the end backwards: unchanged text keeps its font, colour and bold; new text takes the formatting around it; bullets keep their indent level; line breaks inside a bullet stay line breaks. The result is read back and checked.
- **↩ Undo** on every applied card restores the original text and puts the target back.
- **Tables**: cells change in place, rows are inserted and deleted where they belong (PowerPointApi 1.9), and the table style is kept. Column changes and merged cells are refused with an explanation.
- **Slide image**: attach a rendering of the current slide so the model can judge layout and fit.
- **Presentation Q&A** with presets for speaker notes, consistency checks, typos and summaries; answers cite slide numbers.
- The whole deck is sent as context, slide by slide, with each text box labelled (title, body, text box, table); long decks keep the target slides and their neighbours.
- macOS installer reuses LLM_in_Word's trusted localhost certificate, so installing both needs only one password prompt. Windows installer, service manager and CI lifecycle test follow LLM_in_Word.
- Offline tests run the pane against a PowerPoint stand-in that reproduces behaviour observed in PowerPoint 16.109, including selecting a group (where reading the selected text range fails).

中文摘要：PowerPoint 版首个版本。可以添加选中的字词、整个文本框、表格、分组或整页（不选时加当前页），最多 16 处可跨页；按「页 + 形状 + 字符位置 + 原文」锚定，写入前核对。只写入变化的字词，保留字体、颜色、加粗、要点层级和段内换行，写完回读核对；每张卡片可一键撤销。表格按行对齐，只改变化的单元格，可增删行。可附当前页截图；演示文稿问答可写讲稿、查一致性、找错别字。macOS 安装沿用 LLM_in_Word 已信任的证书，不用再输密码。
