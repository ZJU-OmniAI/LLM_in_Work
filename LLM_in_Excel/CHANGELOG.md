# 更新记录

## 0.1.0 — 2026-10-01

First release of LLM_in_Excel, the Excel counterpart of LLM_in_Word and LLM_in_PowerPoint, with the same pane layout and backends.

- **Targets that fit spreadsheets.** Add a selected range, several ranges at once (Cmd/Ctrl multi-select), an empty range to fill, or a whole column (trimmed to the used rows). Up to 8 targets and 4,000 cells per request. Targets are anchored by worksheet ID and address, so renaming a sheet keeps them; ranges with merged cells are refused (ExcelApi 1.13).
- **A table protocol with coordinates.** Sheets and targets are sent as Markdown tables with column letters and row numbers; replies use the same form, so the model lists only the cells that change. Formulas are shown with their current results; text that Excel would misread gets a leading `'`; edge spaces are made visible.
- **Cell preview** with old values struck through, and new cells outside the target marked separately. Empty cells next to the target (a Total row, a new column) can be filled; cells that already have content outside the target are never overwritten.
- **Safe write-back.** Only changed cells are written, as if typed: numbers stay numbers, IDs such as `00123` stay text, `¥1,300` going into a number cell is written as 1300 so the currency format still applies, and a formula whose result was copied back is kept. Fonts, fills and number formats are not touched. Edits made after sending need a second click; formula errors and numbers that became text are reported after writing.
- **↩ Undo** restores every written cell's formula or value, type and number format, and puts the target back.
- **Workbook Q&A** with presets to summarize, find problems, explain formulas and suggest charts; answers cite cell addresses.
- Presets for editing: clean up, categorize, write formulas, fill blanks, fix typos, translate to English.
- macOS installer reuses the trusted localhost certificate of LLM_in_Word or LLM_in_PowerPoint, so no password prompt when either is installed. Windows installer, service manager and CI lifecycle test follow LLM_in_Word.
- Offline tests run the pane against an Excel stand-in that types values the way Excel 16.109 does (`00123` → 123, `15%` → 0.15, `¥1,300` → text, `'00123` → text).

中文摘要：Excel 版首个版本。可以添加选中的区域、一次多块区域（按住 Cmd/Ctrl 多选）、要填写的空白区域或整列（自动截到有数据的行），每次最多 8 块、合计 4,000 个单元格；按工作表 ID 和地址锚定，含合并单元格的区域不收。工作表和目标用带行号、列字母的表格发给模型，回复同样带坐标、只列有改动的单元格。单元格预览划掉旧值；可以写到目标旁边的空白格，但绝不覆盖目标外已有内容的单元格。只写入有变化的单元格，写法和手动输入一致：编号保持文本、货币金额写成数字、照抄回来的公式结果保留原公式，不改字体、底色和数字格式；写完回读，提示公式错误和变成文本的数字；每张卡片可一键撤销（恢复内容、类型和数字格式）。表格问答可总结、找异常、解释公式、推荐图表，回答注明单元格地址。macOS 安装沿用 Word 版或 PowerPoint 版已信任的证书，不用再输密码。
