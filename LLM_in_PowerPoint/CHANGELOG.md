# 更新记录

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
