# Architecture / 技术说明

## Runtime

```text
PowerPoint presentation + Office.js side pane
              │ HTTPS / NDJSON (127.0.0.1:8387)
              ▼
Local Node.js service
              │ stdin + structured CLI events
              ├── Claude Code
              └── Codex CLI → configured model provider
```

The service is the LLM_in_Word service with PowerPoint prompts, its own port, data directory and add-in ID. The runtime has no external npm dependencies; development tests use jsdom. / 服务端沿用 LLM_in_Word，换了提示词、端口、数据目录和加载项 ID。

| Component | Responsibility |
| --- | --- |
| `server/server.js` | Loopback HTTPS, same-origin API checks, request cancellation and attachment cleanup. |
| `server/cli.js`, `server/process.js`, `server/launch.js` | Backend arguments, streaming events, timeouts, error classification, process-tree cancellation. |
| `server/models.js`, `server/health.js` | Model discovery and CLI/login diagnostics without paid generation. |
| `server/prompt.js` | Slide-aware system prompts, target markers, table rules, follow-up prompts and the format-mode prompt. |
| `taskpane/taskpane.js` | Selection reading, target anchoring, deck context, minimal-edit write-back, undo, tables, slide images, chat UI. |
| `taskpane/format-utils.js` | Format mode: formatting snapshot text, `format` plan parsing and validation, preview rows, table border plans. |
| `taskpane/table-utils.js` | Markdown table protocol, row alignment and cell differences (shared with LLM_in_Word). |
| `tools/fixtures/fake-powerpoint.js` | In-memory PowerPoint API stand-in used by the offline tests. |

## Reading the deck

`readDeck` loads every slide's shapes, expands groups (PowerPointApi 1.8), reads text through `getTextFrameOrNullObject` (1.10; older versions probe each text-capable shape) and table values (1.8), and labels shapes by placeholder type: title, subtitle, body, text box, shape, table. Footers, dates and slide numbers are left out of the context. Shapes are sorted in reading order (top to bottom, then left to right).

PowerPoint separates paragraphs with `\r` and line breaks inside a paragraph with `\v`. Both are shown to the model as `\n`, one character for one character, so positions in the normalized text equal positions in PowerPoint.

## Targets

A target is `{ slideId, shapeId, start, length, text, whole }` (tables: the whole table plus its values). `slides.getItemOrNullObject(id).shapes.getItemOrNullObject(id)` also resolves shapes inside groups. Before every request and every write, targets are located again: a whole-shape target follows the shape's current text; a partial target is looked up at its old position, then by its original text (nearest copy wins); if it cannot be found it is dropped. Targets are kept in the pane's local storage per presentation, not in the file.

Selection: the pane first reads the selected shapes and slides. Only when no shape, or one ordinary shape, is selected does it read the selected text range; with a group selected PowerPoint 16.109 fails that call with InvalidArgument. No selection adds the current slide.

## Writing only what changed

The old and new target text are compared token by token (words; single CJK characters) and turned into edits `{ pos, del, ins }`, applied from the end with `textRange.getSubstring(start + pos, del).text = ins`. Observed PowerPoint behaviour, reproduced in the stand-in:

- replaced text keeps the formatting of the first replaced character; inserted text takes the formatting on its left;
- an inserted `\r` starts a paragraph at the same indent level; unchanged paragraph marks are never touched;
- line breaks inside the replaced text keep their type, so a soft line break stays soft.

After writing, the text is read back and compared with the expected result. The applied card records the raw text before and after, and **Undo** applies the reverse edits if that text is still in place.

Tables: rows are aligned by content (`TableUtils.planRows`). Changed cells are written with `getCellOrNullObject(r, c).text`, removed rows are deleted from the bottom up, then new rows are added with `rows.add(index, 1)` (PowerPointApi 1.9) in their new positions. Column changes and merged cells are refused.

## Format mode

Format mode works on the current slide. `readFormatSnapshot` takes the selected shapes (or every shape on the slide when nothing is selected), expands groups up to three levels (60 shapes at most) and loads, per shape: `left/top/width/height`, `rotation` (1.10), `fill` (`type`, `foregroundColor`, `transparency`), `lineFormat` (`visible`, `color`, `weight`, `dashStyle`, `transparency`), the text's `font` and `paragraphFormat.horizontalAlignment`, and `textFrame.verticalAlignment`. A font property that PowerPoint reports as `null` differs between runs; it is shown to the model as `"mixed"`. Tables (1.9) report per-region shading, font and border colours (large tables: header, first rows and last row, 150 cells at most). The slide's background (`slide.background`, 1.10), theme colours (`themeColorScheme.getThemeColor`) and page size (`pageSetup`) are added. `FormatUtils.describeSnapshot` turns this into one JSON line per shape, and the slide image (`slide-N.png`) is attached automatically. Format requests always start a fresh CLI session, because the snapshot is the source of truth after every apply.

The reply's ```` ```format ```` fence is parsed by `parseFormatReply` and checked by `normalizeChanges`: ids must be in scope; colours are normalized to `#RRGGBB`; line weight 0–20 pt, font size 1–400 pt, positions within three slide sizes, sizes above 0.5 pt; properties the API level cannot write are refused. `planRows` produces the old → new preview.

`applyFormat` re-reads the shapes, asks for confirmation when they changed since the snapshot, records the old values, then writes:

- fill: `fill.setSolidColor` + `transparency`, or `fill.clear()`; line: `lineFormat.visible/color/weight/dashStyle/transparency`;
- font: `textFrame.textRange.font.*`; when the old font was mixed, every character's font is read with `getSubstring(i, 1)` (up to 3,000 characters) and stored as runs, so Undo can restore them;
- stacking order: `setZOrder` (1.8) one step at a time, with the original `zOrderPosition` recorded;
- table regions: `getCellOrNullObject(r, c)` `fill`, `font`, `horizontalAlignment`, `verticalAlignment` and `borders.top/bottom/left/right` (1.9); `"none"` borders are written as weight 0. `borderPlan` maps `outer`, `inner`, `horizontal`, `vertical` to the sides of each cell;
- background: `background.fill.setSolidFill({ color })`; Undo calls `background.reset()` when the slide followed the master before.

Undo writes the recorded values back.

Readings observed in PowerPoint 16.109 for Mac, reproduced in the stand-in: `paragraphFormat.horizontalAlignment` and `TableCell.horizontalAlignment` read as the enum's index (`0` = Left; `FormatUtils.alignName` turns them into names, and writes accept names); a shape without fill reads `foregroundColor: ""` and `transparency: -1`, a hidden line `color: ""` and `weight`/`transparency: -1`; `toJSON()` on fill and line objects returns `{}`, so properties are read one by one. Cells of a table with a table style read what was set directly, not what the style draws: no fill (`color: null`, `transparency: 1`), borders with every property `null`, and black, non-bold text. A border that was set reads `transparency: 1` and `dashStyle: null`, so visibility is judged by weight and colour only. None of these can be unset: `null` throws InvalidArgument, weight 0 or transparency 1 hide the style's line, and `table.clear({ format: true })` writes plain formatting rather than removing it. What does work: `cell.fill.clear()` returns a cell to the style's fill, and assigning `styleSettings.style` (PowerPointApi 1.9) drops every cell's direct fill and borders while keeping fonts. So before the first border change on a table (up to 400 cells), `applyFormat` records the style and every cell's direct fill and borders; Undo re-applies the style and writes those back. Text colour and bold drawn by the style cannot be restored; the preview says so before applying.

### Whole-slide redesign

The snapshot also lists each text shape's paragraphs (length, size, bold, level, first 30 characters), its autofit setting, pictures' aspect ratio, and the slide's main and Chinese fonts. Besides property changes, a plan may contain:

- `{"add": "roundRect" | "rect" | "ellipse" | "line" | "textbox", "id": "new1", x, y, w, h, …}`, created with `shapes.addGeometricShape` / `addLine` / `addTextBox` (PowerPointApi 1.4). A line created with a height of 0 comes out 72 pt high in 16.109, so its size is set again. Rounded corners use `shape.adjustments.set(0, v)` (1.10).
- `"from": {"id": "3", "para": "2-3"}` on an added shape: the paragraphs are cut from the source text by `\r` offsets and every character's font is read with `getSubstring(i, 1)` (up to 4,000 characters), then written to the new shape as runs (`compressRuns`). Typed `text` is limited to 40-character labels.
- `{"id": "8", "delete": true}`: only lines, empty shapes and text shapes whose every paragraph is moved by `from` in the same plan; titles, pictures, tables and groups are refused. Deletes run last.
- `{"id": "3", "para": "2-4", "font": …, "align": …, "bullet": false}` for some paragraphs; `autoSize`, `margin`, `wrap` on text frames; `tableStyle` through `styleSettings.style` (1.9).

`normalizeChanges` keeps pictures at their aspect ratio and moves shapes that end up off the slide back onto it.

**Fonts.** Setting `font.name` to a Latin font such as Calibri makes PowerPoint 16.109 render Chinese text in SimSun; a Chinese font (微软雅黑, PingFang SC) changes both scripts. `setFontName` therefore applies Latin font names to Latin runs only (`scriptRuns`), and Chinese characters in new text get the slide's Chinese font, or 微软雅黑.

**Whole-slide undo.** Structural plans, redesigns and plans whose property undo would be lossy back the slide up with `slide.exportAsBase64()` (1.8) before writing, and record the slide image after applying. Undo compares the current image with it (a difference asks for confirmation), inserts the backup with `presentation.insertSlidesFromBase64(b64, { targetSlideId, formatting: 'UseDestinationTheme' })`, checks that the new slide exists, and deletes the edited one. In 16.109 the round trip renders identically, keeps shape IDs, speaker notes and the layout, and adds no slide master. The slide ID changes, so `state.slideRedirect` maps old IDs to new ones for other cards, and text targets on that slide are re-pointed.

**Self-check.** When a plan adds or deletes shapes or moves three or more, the card reads the slide again (scope = the original shapes plus the new ones), renders it, computes `layoutIssues` (text or picture shapes overlapping by more than 4 % of the smaller one, except a text shape on a card without text; shapes off the slide; text within 12 pt of an edge), and sends a `phase: 'check'` request outside the conversation. The reply is either a pass or a `format` fix, which is validated and applied without a new backup (the first backup covers both). The card shows the images before and after.

## Context and requests

Edit requests send the whole deck, slide by slide, with `【选中段开始/结束】` (one target) or `【目标k开始/结束】` markers in place. Decks over about 110,000 characters keep the target slides and their nearest neighbours and name the omitted slide ranges. Compatible follow-ups reuse the CLI session; any change to the deck, targets, attachments, mode or model rebuilds the context. Slide images come from `slide.getImageAsBase64({ width: 1280 })` and are sent as ordinary image attachments named `slide-N.png`.

## macOS

Runtime files live in `~/.llm_in_powerpoint` (outside Desktop, avoiding TCC restrictions on launchd jobs). The launchd label is `com.llm_in_powerpoint.server`. The manifest is copied to `~/Library/Containers/com.microsoft.Powerpoint/Data/Documents/wef/`. If a trusted LLM_in_Word certificate exists (`security verify-cert -p ssl -s localhost`), it is copied and reused; otherwise a new localhost certificate is created and trusted in the login keychain.

## Windows

The installer uses `%LOCALAPPDATA%\LLM_in_PowerPoint`, a current-user PFX certificate, the `HKCU\Software\Microsoft\Office\16.0\WEF\Developer` registration (shared by all Office apps; the manifest's host decides where it loads), a per-user Startup shortcut and a hidden Node supervisor, exactly as LLM_in_Word does.
