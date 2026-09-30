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
| `server/prompt.js` | Slide-aware system prompts, target markers, table rules and follow-up prompts. |
| `taskpane/taskpane.js` | Selection reading, target anchoring, deck context, minimal-edit write-back, undo, tables, slide images, chat UI. |
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

## Context and requests

Edit requests send the whole deck, slide by slide, with `【选中段开始/结束】` (one target) or `【目标k开始/结束】` markers in place. Decks over about 110,000 characters keep the target slides and their nearest neighbours and name the omitted slide ranges. Compatible follow-ups reuse the CLI session; any change to the deck, targets, attachments, mode or model rebuilds the context. Slide images come from `slide.getImageAsBase64({ width: 1280 })` and are sent as ordinary image attachments named `slide-N.png`.

## macOS

Runtime files live in `~/.llm_in_powerpoint` (outside Desktop, avoiding TCC restrictions on launchd jobs). The launchd label is `com.llm_in_powerpoint.server`. The manifest is copied to `~/Library/Containers/com.microsoft.Powerpoint/Data/Documents/wef/`. If a trusted LLM_in_Word certificate exists (`security verify-cert -p ssl -s localhost`), it is copied and reused; otherwise a new localhost certificate is created and trusted in the login keychain.

## Windows

The installer uses `%LOCALAPPDATA%\LLM_in_PowerPoint`, a current-user PFX certificate, the `HKCU\Software\Microsoft\Office\16.0\WEF\Developer` registration (shared by all Office apps; the manifest's host decides where it loads), a per-user Startup shortcut and a hidden Node supervisor, exactly as LLM_in_Word does.
