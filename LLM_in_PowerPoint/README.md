# LLM_in_PowerPoint

[← LLM_in_Work](../README.md) · [LLM_in_Word](../LLM_in_Word/README.md) · [LLM_in_Excel](../LLM_in_Excel/README.md) · [LLM_in_Overleaf](../LLM_in_Overleaf/README.md)

**Your local Claude Code or Codex CLI, right inside Microsoft PowerPoint.**

English · [简体中文](README.zh-CN.md)

Select text, a text box, a table or a whole slide, describe the change, review the differences, and apply. Only the words that change are rewritten, so bold numbers, colours, bullet levels and line breaks stay as they were. Beyond text, it also adjusts layout and formatting: border colour and weight, fills, fonts and sizes, alignment, position and size, table styles and the slide background, as in “make this black border lighter”. LLM_in_PowerPoint brings this workflow into a PowerPoint side pane and reuses the login of your locally installed CLI.

[Windows installation](#windows-installation) · [macOS installation](#macos-installation) · [First edit](#your-first-edit) · [Formatting](#formatting-and-layout) · [Troubleshooting](docs/troubleshooting.md) · [Contributing](CONTRIBUTING.md)

![A slide title and its bullets added as two targets, with a diff for each in the side pane](docs/images/ppt-diff.jpg)

*Real desktop PowerPoint on macOS with the LLM_in_PowerPoint side pane. Demo deck written for the screenshots.*

## What you can do

| Feature | In practice |
| --- | --- |
| Rewrite slide text | Tighten bullets, sharpen a title, fix grammar, make bullets parallel, or translate a slide. |
| Pick targets the way you work | Add selected words, a whole text box, a table, a group of text boxes, or everything on the current slide. Up to **16** targets per request, across slides. |
| Review before applying | Every target gets its own diff: red for deletions, green for additions. Nothing changes in the slides until you choose Apply. |
| Keep the formatting | Only changed words are rewritten. Unchanged text keeps its font, size, colour and bold; new text takes the formatting of the words around it; bullets keep their indent level. |
| Undo with one click | Each applied card has **↩ Undo**, which restores the original text and puts the target back so you can try again. |
| Edit tables | Change cells, add rows, or delete rows. Only cells that change are written, so the table style stays. |
| Adjust formatting and layout | **Format** mode changes formatting, not words: borders (colour, weight, dashes, or none), fills, font, size and colour, alignment, position and size, rotation, stacking order, table borders/shading/header, and the slide background. Select the shapes to adjust, or nothing for the whole slide. |
| See and undo format changes | The plan is listed as “old → new” with colour swatches. After applying, **↩ Undo** restores everything, down to per-character sizes and colours in mixed text. |
| Let the model see the slide | **Slide image** attaches a rendering of the current slide, so the model can judge layout and whether text fits. |
| Ask about the deck | **Presentation Q&A** writes speaker notes, checks terms and numbers for consistency, finds typos, or summarizes, with slide numbers. |
| Continue a conversation | Refine an answer, keep input drafts, revisit local history, or export a conversation as Markdown. |
| Switch interface language | Choose English or 中文 without restarting the pane. Explanations follow the language of your instruction. |
| Choose your writing engine | Switch between Claude Code and Codex; choose a model and its supported reasoning effort. |

## See the workflow in PowerPoint

**1. Add targets and describe the change.** Select words, a text box or a table and click **＋ Add selection**. With nothing selected, **＋ Add selection** adds every text box on the current slide. Then type one instruction for all targets.

**2. Preview each target.** Every target gets its own diff, labelled with its slide and role (title, body, text box, table). The slides do not change until you apply.

**3. Apply.** Click **Apply** on a card or **Apply all**. Only the changed words are written: in the example below the rewritten bullet keeps its bold figure, the second-level bullet keeps its indent, and the red bullet stays red.

![After applying: rewritten title and bullets with their original formatting, and an Undo button on each card](docs/images/ppt-applied.jpg)

**4. Edit tables.** Select a table and add it as a target. Changed cells show the old value struck through; new rows are highlighted. Applying writes only those cells and rows.

![Table preview with two changed cells and one new row](docs/images/ppt-table.jpg)

**5. Adjust formatting.** Click **Rewrite ▾** and switch to **Format**, select the shapes to adjust (nothing selected means the whole slide), and describe the change, for example “make this black border lighter and thinner”. See [Formatting and layout](#formatting-and-layout).

**6. Ask about the deck.** Click **Rewrite ▾** and switch to **Presentation Q&A**. Attach a **Slide image** when layout matters. Presets write speaker notes, check consistency, find typos, or summarize the deck.

![Presentation Q&A writing speaker notes for a slide](docs/images/ppt-ask.jpg)

The screenshots come from real desktop PowerPoint (16.109) on macOS with a deck written for the demo. Every reply was generated by Claude Code (Haiku 4.5, low effort). [Screenshot notes](docs/images/README.md).

## Platform support

| Platform | Installation and runtime | Verification |
| --- | --- | --- |
| **macOS desktop PowerPoint** | Shell installer; reuses LLM_in_Word's trusted certificate when present, otherwise Keychain trust; launchd service; PowerPoint sideloading | Offline tests against a PowerPoint stand-in, plus the full workflow in real PowerPoint 16.109 (text, groups, tables, slide images, undo). Format mode was checked there for borders, mixed font sizes, table borders and header, picture borders, background and alignment, comparing the slide image after each Undo with the original. |
| **Windows desktop PowerPoint** | Native PowerShell installer; user certificate trust; PowerPoint registration; background service and login startup | Windows CI covers install, update, restart, HTTPS and uninstall. Interactive PowerPoint on Windows still needs a real-device acceptance run. |
| PowerPoint for the web / mobile | No supported installation workflow | Not supported in this release. |
| Linux | Backend development and browser preview | Offline tests only. |

Use a current **Microsoft 365 desktop PowerPoint**. The manifest requires PowerPointApi 1.5 (PowerPoint 2022 or later). Tables, grouped shapes, slide images and stacking order need PowerPointApi 1.8; adding or removing table rows and table formatting need 1.9; rotation, the slide background and theme colours need 1.10. The pane checks these at start-up and disables what your version cannot do (the model is also told which properties are unavailable).

## Before installation

You need:

1. **Node.js 22.12+ on the 22.x line, or Node.js 24+.** Install from [Node.js](https://nodejs.org/en/download).
2. **Git**, or an extracted ZIP of this repository.
3. At least one local, authenticated CLI: [Claude Code setup](https://code.claude.com/docs/en/setup) or [Codex CLI](https://github.com/openai/codex).

In the terminal of the same OS user that runs PowerPoint, verify the CLI you intend to use:

```text
node --version
claude --version
claude auth login
```

Or, for Codex: `codex --version` and `codex login`. You only need one backend. On Windows use a **native Windows CLI**, not one installed only inside WSL.

## Windows installation

```powershell
git clone https://github.com/ZJU-OmniAI/LLM_in_Work.git
cd LLM_in_Work/LLM_in_PowerPoint
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

`Bypass` applies to this PowerShell process only. Windows may ask you to confirm trust for the generated localhost certificate. The installer copies the runtime to `%LOCALAPPDATA%\LLM_in_PowerPoint\app`, trusts the certificate for **your user** only, registers `manifest.xml` as a developer add-in, starts a hidden background service on `127.0.0.1:8387`, adds a per-user Startup shortcut, and checks the service over HTTPS.

Completely close and reopen PowerPoint, then open **Home → Add-ins → Developer Add-ins → LLM_in_PowerPoint** (in some versions **Insert → My Add-ins**). Once loaded, an **LLM_in_PowerPoint** button appears on the Home ribbon.

## macOS installation

```bash
git clone https://github.com/ZJU-OmniAI/LLM_in_Work.git
cd LLM_in_Work/LLM_in_PowerPoint
./install.sh
```

The installer copies runtime files to `~/.llm_in_powerpoint/app`, registers the user launchd service `com.llm_in_powerpoint.server` on port 8387, and places the manifest in PowerPoint's sideload folder. **If LLM_in_Word is already installed, its trusted localhost certificate is reused**, so there is no second password prompt (a certificate is tied to `localhost`, not to a port). Otherwise the first installation asks for your Mac password once to trust a new certificate.

Quit PowerPoint with **Cmd+Q**, reopen it, then click **LLM_in_PowerPoint** on the Home ribbon. If the button is missing, choose **Insert → Add-ins → My Add-ins → Developer Add-ins → LLM_in_PowerPoint** once. See [Microsoft's Mac sideloading guide](https://learn.microsoft.com/en-us/office/dev/add-ins/testing/sideload-an-office-add-in-on-mac).

LLM_in_Word (port 8377) and LLM_in_PowerPoint (port 8387) are separate services and can run side by side.

## Your first edit

1. Open a copy of a presentation and open the **LLM_in_PowerPoint** side pane.
2. Click **Settings** to choose **English** if needed, **Claude Code** or **Codex**, and a model. The dot next to the title shows the connection; click the status line in **Settings** for sign-in and path help.
3. Select what to change: a few words, a text box, a table, or nothing at all (the whole current slide). Click **＋ Add selection**; add more from other slides if needed. **Settings** lists the targets with their slide numbers, with buttons to locate (📍) or remove each one.
4. Enter an instruction, such as **“Keep each bullet to one line. Keep the numbers.”**, or click a preset such as **Tighten bullets**.
5. Click **Rewrite**. The response streams into the pane; you can stop it at any time.
6. Inspect the diff and click **Apply** (or **Apply all**).
7. Check the slide. If you do not like the result, click **↩ Undo** on the card: it restores the original text and puts the target back.

For questions about the deck, click **Rewrite ▾** and switch to **Presentation Q&A**. Answers cite slide numbers. Speaker notes are not readable through PowerPoint's add-in API, so the pane writes notes in the conversation for you to paste into the Notes pane.

| Chinese control | Meaning |
| --- | --- |
| 设置 | Settings: model, language, mode and targets |
| 改写 ▾ / 版式 ▾ / 问答 ▾ | Current mode; click to switch |
| 改写文字 / 调整版式 / 演示文稿问答 | Rewrite / Format / Presentation Q&A |
| ＋ 添加选中 | Add the current selection (or the current slide) |
| 当前页截图 | Attach an image of the current slide |
| 应用 / 撤销 | Apply / Undo |
| 生成改写 / 生成方案 / 停止生成 | Generate / Plan / Stop |

## Formatting and layout

Format mode changes formatting only, never the words.

1. Click **Rewrite ▾** and switch to **Format**.
2. Select the shapes to adjust on the slide; several are fine. **With nothing selected, the whole current slide is in scope**, including its background. The top of the pane shows “Slide N · k selected shapes” or “Slide N · whole slide”.
3. Describe the change, or pick a preset: **Lighter borders**, **Consistent fonts**, **Align layout**, **Harmonize colors**, **Stronger title**, **Cleaner table**.
4. Click **Plan**. The pane attaches an image of the current slide and a formatting list of its shapes (position, size, fill, border, font, alignment, table borders and so on), and the model proposes a plan.
5. The plan is shown per shape, one line per property as “old → new”, with colour swatches. Click **✅ Apply** to write it to the slide.
6. Not happy? **↩ Undo** restores every changed property. **🔁 Retry** generates a new plan, or keep talking (“a bit lighter still”).

What can be changed:

| Object | Properties |
| --- | --- |
| Shapes, text boxes, pictures | Position and size, rotation, fill colour and transparency (or no fill), border colour/weight/dash/transparency (or no border), stacking order |
| Text | Font, size, colour, bold, italic, underline (for all text in the shape), horizontal and vertical alignment |
| Tables | Shading, font and alignment of a region (all, header, body, first column, last row, or a block such as rows 2–4 × columns 1–3), and borders (all, outer, inner, horizontal, vertical, or one side) |
| Slide | Background colour |

Wording is changed in **Rewrite** mode. Animations, picture cropping, gradients, shadows, new shapes, and master or layout formatting are out of reach; the model says so and explains how to do it by hand.

**Checks before writing.** A plan may only touch the selected shapes (or the shapes on this slide). Out-of-range values (a 500 pt font, a 30 pt line, a shape moved far off the slide) are rejected and explained on the card. If you edit those shapes by hand after the plan was generated, **Apply** warns first and overwrites only on a second click.

**What Undo restores.** The original value of every property is recorded before writing: mixed sizes or colours in a paragraph are recorded character by character, stacking order is restored step by step, and a background that followed the master follows it again. Gradient, pattern and picture fills cannot be restored: Undo clears such a fill, and a background that was not a solid colour goes back to following the master. The card warns about both before you apply.

**Tables with a table style** (most tables inserted in PowerPoint): the fills, borders and text colours drawn by the style cannot be read through the add-in API, so the list and the preview mark them as “table style” and the model relies on the slide image. Changed fills and borders are undone exactly: the pane applies the same table style again, then writes back any fills and borders that had been set directly. Text colour and bold that came from the style cannot be read, so after changing them in a table, Undo writes back black and not bold; the card warns beforehand.

## How applying works

A target is remembered by its slide ID, shape ID and character position, together with the original text. Before writing, the pane reads the slide again: if the original text has moved, it is found again; if it was edited after the request was sent, you are asked to confirm; if it is gone, nothing is written.

The new text is compared with the old one word by word (character by character for Chinese), and only the changed spans are replaced, from the end of the text backwards. PowerPoint keeps the formatting of unchanged characters; replaced words take the formatting of the first word they replace, and inserted words take the formatting on their left. A new line becomes a new bullet at the same level; a line break inside a bullet (Shift+Enter) stays a line break. The result is read back and checked. Tables are compared row by row: rows are matched by content, then only changed cells are written and new rows are inserted where they belong.

## What does the model receive?

**Selecting one bullet does not mean the model sees only that bullet.** The targets determine where edits may be applied. On the first request, or when the slides change, the text of the whole presentation is sent as context, slide by slide, with each text box labelled (title, body, text box, table). Speaker notes are not included. Long decks keep the target slides and their neighbours within about 110,000 characters. In Rewrite and Q&A modes a slide image is sent only when you attach one.

**Format** mode sends the current slide only: an image of it, plus a formatting list of its shapes (type, name, position and size, fill, border, font, alignment, and up to 80 characters of each shape's text). Other slides are not sent.

The backend runs locally and binds to `127.0.0.1:8387`, but model inference normally connects to the chosen provider. Your CLI's authentication, provider settings, account limits and billing apply, and CLI history may retain prompts and slide text. Read [data handling and security](SECURITY.md) before using confidential decks.

## Update and manage the service

```text
git pull --ff-only
npm run update
```

Then click ⟳ in the pane. Manifest changes require completely restarting PowerPoint.

macOS restart: `launchctl kickstart -k gui/$(id -u)/com.llm_in_powerpoint.server` (log: `~/.llm_in_powerpoint/server.log`).
Windows: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\windows-service.ps1 -Action Restart` (log: `%LOCALAPPDATA%\LLM_in_PowerPoint\server.log`).

## Configuration

Installers persist these for the background service; set them before running `npm run update` to change them.

| Environment variable | Purpose | Default |
| --- | --- | --- |
| `LLM_IN_POWERPOINT_CLAUDE_BIN` | Claude executable or JS entry point | Automatic discovery |
| `LLM_IN_POWERPOINT_CODEX_BIN` | Codex executable or JS entry point | Automatic discovery |
| `LLM_IN_POWERPOINT_TIMEOUT_MS` | Total time allowed for one CLI request | `300000` |
| `LLM_IN_POWERPOINT_MAX_CHARS` | Server-side cap on presentation text | `120000` |
| `LLM_IN_POWERPOINT_DATA_DIR` | Data directory for direct server runs | `~/.llm_in_powerpoint` |
| `LLM_IN_POWERPOINT_PORT` | Port for direct server runs | `8387` |

Changing the installed port also requires editing every localhost URL in `manifest.xml`. Keep `localhost`, `127.0.0.1` and `::1` excluded from your system proxy.

## Development and tests

```text
npm ci
npm test
npm run preview
```

`npm test` runs the offline suite: edit planning, deck context, the pane against a PowerPoint stand-in (`tools/fixtures/fake-powerpoint.js`, which reproduces behaviour observed in real PowerPoint), the interface, translations, prompts and the backend with mock CLIs. Browser preview runs at `http://127.0.0.1:8389/taskpane.html`; reading and writing slides requires the real add-in. Optional live backend tests (`npm run test:live`, `npm run test:live:codex`) consume provider usage.

See [architecture](docs/architecture.md), [contributing](CONTRIBUTING.md) and the [changelog](CHANGELOG.md).

## Limitations

- SmartArt, charts, and text on slide masters or layouts cannot be edited through the add-in API.
- Speaker notes are not accessible to add-ins; Q&A can draft them for you to paste.
- Table columns cannot be added or removed yet, and tables with merged cells are not accepted as targets.
- Format mode: font settings apply to all text in a shape, not to a few words; line and paragraph spacing, shadows, gradients, animations and master formatting cannot be changed; up to 60 shapes per slide are considered, and large tables show only the header, the first rows and the last row.
- Text that grows a lot may overflow its box; PowerPoint's AutoFit applies as usual. Check each slide after applying.
- The model can make mistakes. Check numbers and names yourself.

## Uninstall

macOS: `./install.sh --uninstall` (or `npm run uninstall`). This stops the service and removes the manifest; local data in `~/.llm_in_powerpoint` and the Keychain certificate (which LLM_in_Word may share) are kept.

Windows: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\windows-service.ps1 -Action Uninstall`. This stops the service, removes the Startup shortcut and PowerPoint registration, and removes this install's certificate from your user stores. Delete `%LOCALAPPDATA%\LLM_in_PowerPoint` manually if you no longer need it.

## License

[MIT](../LICENSE). Office.js, model CLIs and their services remain subject to their respective licenses and terms. LLM_in_PowerPoint is an independent ZJU-OmniAI project, not an official Microsoft, Anthropic or OpenAI product.
