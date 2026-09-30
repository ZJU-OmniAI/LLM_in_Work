# Architecture / 技术说明

## Runtime

```text
Excel workbook + Office.js side pane
              │ HTTPS / NDJSON (127.0.0.1:8397)
              ▼
Local Node.js service
              │ stdin + structured CLI events
              ├── Claude Code
              └── Codex CLI → configured model provider
```

The service is the LLM_in_Word service with spreadsheet prompts, its own port, data directory and add-in ID. The runtime has no external npm dependencies; development tests use jsdom. / 服务端沿用 LLM_in_Word，换了提示词、端口、数据目录和加载项 ID。

| Component | Responsibility |
| --- | --- |
| `server/server.js` | Loopback HTTPS, same-origin API checks, request cancellation and attachment cleanup. |
| `server/cli.js`, `server/process.js`, `server/launch.js` | Backend arguments, streaming events, timeouts, error classification, process-tree cancellation. |
| `server/models.js`, `server/health.js` | Model discovery and CLI/login diagnostics without paid generation. |
| `server/prompt.js` | Spreadsheet system prompts: how cells are written down, the reply format, and follow-up prompts. |
| `taskpane/grid-utils.js` | A1 addresses, the coordinate table protocol, how a cell is shown, comparing old and new cells, and preparing values for writing. Pure functions, unit-tested in `tools/test-grid.js`. |
| `taskpane/taskpane.js` | Selections and targets, workbook context, cell preview, write-back with checks, undo, chat UI. |
| `tools/fixtures/fake-excel.js` | In-memory Excel API stand-in used by the offline tests. It types values the way Excel does. |

## How a cell is shown / 单元格的表示法

The model sees and writes cells as text, so every cell needs one unambiguous form. `GridUtils.cellRepr(formula, text, type, value)`:

- a formula is shown as the formula (`=SUM(D2:D7)`); in the workbook context it is followed by its current result (`=SUM(D2:D7) → 9,840.50`, `contextRepr`);
- numbers, dates and percentages are shown as displayed (`1,200.00`, `2026-07-03`, `12%`); a column too narrow to show a number (`####`) falls back to the value;
- text that Excel would read as something else when typed (`00123`, `2026-07-03`, `TRUE`, `-inc`, `=x`) gets a leading `'`, exactly as a user would type it;
- text with leading or trailing spaces is put in double quotes so the spaces are visible;
- inside tables, a line break is written `<br>` and a pipe `\|`.

## The coordinate table protocol / 带坐标的表格

Every sheet and every target is a Markdown table whose header row holds column letters (first cell empty) and whose first column holds row numbers. The model replies in a ```` ```table ```` fence in the same form, so it can list only the rows and columns that change; cells it does not list are left alone, and a listed empty cell means “clear it”. With several targets, each fence is preceded by `【目标k】`. `parseGridMarkdown` also accepts a table without coordinates when its size matches the target exactly; anything else is refused and the card offers **Retry**.

## Targets

**＋ Add selection** reads `workbook.getSelectedRanges()` (ExcelApi 1.9), so each area of a Cmd/Ctrl multi-selection becomes one target. Areas larger than 2,000 cells (a whole column, say) are intersected with the sheet's used range. Ranges with merged cells are refused when ExcelApi 1.13 is available (`getMergedAreasOrNullObject`). Overlapping targets are skipped. Limits: 8 targets, 4,000 cells in total.

A target is `{ sheetId, sheetName, address, r1, c1, r2, c2, grid, texts, types }`: the worksheet is found by ID, so renaming a sheet does not lose the target. Before every request, targets are read again and their snapshot refreshed; targets on deleted sheets are dropped. Targets are kept in the pane's local storage per workbook, not in the file.

## Workbook context

`buildBookContext` sends the sheets that contain targets and the active sheet in full (up to 60 columns), and other sheets as a preview of their first rows (up to 20 columns). When a sheet does not fit, the header rows, the rows within five rows of each target and then rows from the top are kept, and every gap is named (`（第 x–y 行省略）`). The total stays within about 110,000 characters; the server caps it again at `LLM_IN_EXCEL_MAX_CHARS`. Compatible follow-ups reuse the CLI session; any change to the workbook, targets, attachments, mode or model rebuilds the context.

## Writing only what changed

`planChanges` compares each listed cell with the snapshot and keeps only real changes:

- numbers compare by value (`1,200.00` = `1200`, `12%` = `0.12`, `¥1,300` = `1300`);
- a formula whose displayed result was copied back is unchanged, so the formula is kept;
- a reply that drops the `'` where that would lose information (leading zeros, more than 15 digits, date-like text: `'00123` → `00123`) is unchanged, so the cell stays text;
- cells outside the target (the prompt asks for cells directly below or to the right, such as a Total row) are written only if they are empty at apply time; the preview shows them in their own colour.

Before writing, the range is read again: if it differs from the snapshot, the card asks for a second click. Each changed cell is written through `range.formulas`, which behaves like typing: numbers, dates and percentages become values, `=` starts a formula, `'` keeps text. For a cell that held a number, `toExcelInput` strips currency symbols and thousands separators first (`¥1,300` → `1300`), because Excel would otherwise store the typed string as text; the cell's number format then displays it as before. The pane never sets fonts, fills or number formats. Observed in Excel 16.109 and reproduced in the stand-in: typing `00123` gives the number 123, `15%` gives 0.15, `2026-10-01` and `1/2` give dates, `'00123` and anything typed into a Text-formatted (`@`) cell stay text, and `¥1,300` stays text.

After writing, the cells are read back: error values (`#NAME?`, `#DIV/0!` …) and number cells that became text are reported on the card. The undo record keeps, for each written cell, its original formula or value, value type, number format and the value that was written. **Undo** refuses when any of those cells changed after applying; otherwise it writes the originals back (`restoreInput` re-adds the `'` where needed) and restores the number formats.

## macOS

Runtime files live in `~/.llm_in_excel` (outside Desktop, avoiding TCC restrictions on launchd jobs). The launchd label is `com.llm_in_excel.server`. The manifest is copied to `~/Library/Containers/com.microsoft.Excel/Data/Documents/wef/`. If a trusted certificate from LLM_in_Word or LLM_in_PowerPoint exists (`security verify-cert -p ssl -s localhost`), it is copied and reused; otherwise a new localhost certificate is created and trusted in the login keychain.

## Windows

The installer uses `%LOCALAPPDATA%\LLM_in_Excel`, a current-user PFX certificate, the `HKCU\Software\Microsoft\Office\16.0\WEF\Developer` registration (shared by all Office apps; the manifest's host decides where it loads), a per-user Startup shortcut and a hidden Node supervisor, exactly as LLM_in_Word does.
