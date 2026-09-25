# LLM_in_Overleaf

[← LLM_in_Work](../README.md) · [LLM_in_Word](../LLM_in_Word/README.md)

**Review and apply AI edits directly in Overleaf's LaTeX editor.**

English · [简体中文](README.zh-CN.md)

Select one or more passages in the same `.tex` file, give an instruction, review a diff for each passage, and apply the changes together. The extension calls your locally installed **Claude Code or Codex CLI** through Chrome Native Messaging. You do not need a separate API key or a manually started server.

## Features

| Feature | What it does |
| --- | --- |
| LaTeX rewriting | Polish academic prose, fix grammar, shorten, expand, translate and revise equations. |
| Multiple selections | Collect non-contiguous passages in one source file and revise them with one instruction. |
| Diff before applying | Compare additions / deletions or read replacement text before writing it back. |
| Checked write-back | Check the original text and filename; reject stale or incomplete replacements. Apply a group as one undoable CodeMirror transaction. |
| Document questions | Ask about selected passages or the current source file without replacing text. |
| Reference attachments | Add other project files, local text, images or PDFs; reading support depends on the backend. |
| Conversations | Continue refining, reopen project-specific history, export Markdown and start a fresh context. |
| Backend controls | Switch Claude / Codex, select a model and supported reasoning effort, check connection status, or stop generation. |
| Reading mode | Expand the reply area while keeping your input draft. |

The interface is currently **Simplified Chinese**. Both the main Overleaf site and `cn.overleaf.com` are supported. The supplied installer targets **macOS with Chrome / Chromium browsers**; Windows and Linux do not yet have supported installers. Editing requires Overleaf's **Code Editor**, not the PDF preview or visual editor.

## Installation (macOS)

Install Node.js **22.12+ (22.x) or 24+**, plus at least one local backend, and sign in with `claude auth login` or `codex login`.

```bash
git clone https://github.com/ZJU-OmniAI/LLM_in_Work.git
cd LLM_in_Work/LLM_in_Overleaf
./install.sh
```

In Chrome, open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select this project's **`LLM_in_Overleaf/extension`** directory.

The installer registers the native messaging host and records the current Node path, CLI overrides and proxy environment in a user-only launcher. Chrome starts the host on demand. There is no listening port and no background server to start yourself. Runtime use does not require `npm ci`.

## First edit

1. Open a `.tex` file in Overleaf's **Code Editor** and select source text.
2. Click **✦ 改这段**, the bottom-right **✦ 写作助手** entry, or the extension popup's **打开写作助手** button.
3. Use **＋ 添加选段** to add more passages from the same file if needed.
4. Enter an instruction, such as “Improve the academic tone. Preserve every citation and equation.”
5. Review the **对比** diff or **新文本** result. Refine it with another message if necessary.
6. Click **应用替换** or **应用全部选段**. **Cmd+Z** undoes the group as one editor transaction.

The current group clears after a successful application; the conversation remains. To ask questions without editing, switch to **问答** in the settings. **⌘⇧E** toggles the panel. Use **阅读** for a larger reply area, then **返回** or Esc to return to your draft.

## Context and attachments

The first turn includes the current `.tex` file, not just the selection. Very long files use a reduced context around the preamble and targets. Compatible follow-ups reuse a CLI session and send new instructions, targets and attachments. After extensive manual edits, start **开新会话** to refresh the full context. Provider-side caching and pricing depend on your backend; no fixed discount is guaranteed.

- **项目文件** retrieves files through Overleaf's source-download interface. Text files such as `.tex`, `.bib`, `.cls` and `.sty` can be attached as context.
- **本地文件** accepts references from your computer, including text, images and PDFs. PDF handling is generally better supported by the Claude backend; model and CLI capabilities vary.
- The panel accepts up to 8 attachments. Images / PDFs are limited to 10 MB each and 25 MB combined; binary files are temporarily written by the host and cleaned up when the request finishes.

Conversations are saved per Overleaf project in browser extension storage. The CLI may also retain prompts and replies. The bridge is local, but model inference usually uses the provider's service. See [data and security](../SECURITY.md).

## Updating from overleaf_edit

The extension is now named **LLM_in_Overleaf**. Its public manifest key and extension ID remain unchanged, as do the native host name `com.overleaf_edit.host`, `~/.overleaf_edit` runtime directory, `OVERLEAF_EDIT_*` environment variables and conversation keys.

After moving the source into this repository:

1. Run `./install.sh` from `LLM_in_Work/LLM_in_Overleaf` to update the host's source path.
2. In `chrome://extensions`, use **Load unpacked** with the new `LLM_in_Overleaf/extension` directory, then refresh Overleaf. Avoid removing the old extension first if you want to preserve its stored history.
3. For later updates at the same path, run `git pull --ff-only`, reload the extension and refresh the page. Rerun the installer whenever the source path, Node / CLI paths or proxy settings change.

The corresponding private packaging key is not distributed and is not required to load or run the extension.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| No selection button | Select source in Code Editor. Open the bottom-right assistant or extension popup, then add the selection. |
| Native host unavailable | Run `./install.sh` from this subproject's directory; check the popup connection status. |
| A moved project no longer works | Rerun the installer and load the extension from its new path. |
| Replacement rejected | Return to the original file or select the updated text again; stale targets are rejected. |
| CLI authentication / network failure | Check the CLI login in a terminal. Rerun installation if paths or proxy settings changed. |
| Self-hosted Overleaf | Add the host to both manifest `matches` lists and the background worker's project URL check, then reload; not supported by default. |

## Development

Run these commands from `LLM_in_Overleaf/`:

```bash
npm ci
npm test                   # Offline regression tests; no model account needed
npm run test:ui            # Real CodeMirror + synthetic page / model responses
npm run test:ui:cn         # Chinese-site selection and activation regressions
```

Set `CHROME_BIN` if Chrome is not in its standard macOS location. On Linux CI, install a browser with `npx playwright-core install --with-deps chromium`. UI tests use synthetic pages and do not edit real Overleaf projects.

Optional live tests use your model account and may consume quota:

```bash
npm run test:live
npm run test:live:codex
npm run test:wrapper       # Exercise the installed ~/.overleaf_edit/host.sh
```

Architecture: `extension/content/bridge.js` connects to CodeMirror in the page's MAIN world; `content.js` handles the panel; `background/service-worker.js` connects to `server/native-host.js`, which invokes the selected CLI.

## Uninstall

Remove the extension in your browser. To remove the Chrome host registration and local launcher:

```bash
rm "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.overleaf_edit.host.json"
rm -rf "$HOME/.overleaf_edit"
```

If you installed it in other Chromium browsers, remove the matching host manifest from those browsers too. CLI-managed session history is separate.

[Changelog](CHANGELOG.md) · [Contributing](../CONTRIBUTING.md) · [MIT license](../LICENSE)
