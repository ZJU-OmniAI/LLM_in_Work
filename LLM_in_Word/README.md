# LLM_in_Word

[← LLM_in_Work](../README.md) · [LLM_in_Overleaf](../LLM_in_Overleaf/README.md)

**Your local Claude Code or Codex CLI, right inside Microsoft Word.**

English · [简体中文](README.zh-CN.md)

Select a passage, describe what you want to change, review the differences, and apply the result with Word tracked changes. LLM_in_Word brings the editing workflow into a Word side pane and reuses the login of your locally installed CLI.

[Windows installation](#windows-installation) · [macOS installation](#macos-installation) · [First edit](#your-first-edit) · [Troubleshooting](docs/troubleshooting.md) · [Contributing](CONTRIBUTING.md)

![Selecting a paragraph and describing an edit in desktop Word](docs/images/word-selection.jpg)

*Real macOS Word, synthetic demo text, and the LLM_in_Word side pane. These screenshots show the Chinese interface; choose English in the pane header for English controls.*

## What you can do

| Feature | In practice |
| --- | --- |
| Rewrite selected passages | Polish academic writing, shorten a paragraph, translate, adjust tone, or fix grammar. |
| Review before applying | See additions and deletions in the side pane. Nothing is written into Word until you choose Apply. |
| Use Word tracked changes | Keep the **Track changes** option enabled, then accept or reject edits in Word's Review tab. |
| Edit several targets | Add up to **eight** separate passages or tables, then give one instruction that covers them all. |
| Work with tables | Revise cell text and preview table differences, or turn selected text into a table. |
| Ask about a document | Use **Document Q&A** to summarize, explain, or find inconsistencies without replacing text. |
| Continue a conversation | Refine an answer, keep input drafts, revisit local conversation history, or export a conversation as Markdown. |
| Switch interface language | Choose English or 中文 without restarting the pane. |
| Choose your writing engine | Switch between Claude Code and Codex; choose a model and its supported reasoning effort. |
| Add references | Attach text, Markdown, CSV, PDF, or image files. Support depends on the chosen CLI and model. |
| Diagnose and recover | Inspect CLI paths, versions and login status; stop generation or retry failures. |

The side pane supports **English and Simplified Chinese**. Choose **English / 中文** in the header to switch immediately; your choice is remembered. On first use it follows the available Word display language, falling back to the browser language (English for other languages). Switching preserves drafts, attachments, targets, and existing responses. Document text and past model responses are not translated. The language selector is temporarily disabled while a request is running.

## See the workflow in Word

**Preview the edit.** Additions and deletions appear in the side pane while the original passage remains selected in Word. This example uses a real Claude Code response.

![Reviewing a real AI rewrite alongside the original Word paragraph](docs/images/word-diff.jpg)

**Apply with tracked changes.** The new paragraph is written into Word. The red margin line in Word's Simple Markup view indicates a pending revision; use the Review tab to accept or reject it. This example used the plain-text fallback, which the pane reports explicitly.

![Applied rewrite with the Word Review tab and pending revision marker](docs/images/word-tracked-changes.jpg)

All screenshots use the same demonstration document in macOS desktop Word. They demonstrate the editing workflow; they are not Windows screenshots. [Screenshot notes](docs/images/README.md).

## Platform support

| Platform | Installation and runtime | Verification |
| --- | --- | --- |
| **Windows desktop Word** | Native PowerShell installer; user certificate trust; Word registration; background service and login startup | Windows CI covers backend tests plus install, update, restart, HTTPS and uninstall. Interactive Word on Windows still needs a real-device acceptance run. |
| **macOS desktop Word** | Shell installer; Keychain trust; launchd service; Word sideloading | Backend tests and real Word workflow verification. Screenshots below are from macOS Word. |
| Word for the web / mobile | No supported installation workflow | Not supported in this release. |
| Linux | Backend development and browser preview | Offline tests only; no desktop Word installer. |

Use a current **Microsoft 365 desktop Word** with Office web add-ins enabled. The manifest requires WordApi 1.3; some features need newer Word APIs. Older perpetual Office releases, WPS, and LibreOffice are not part of the tested target. Organization policies may prevent sideloading or trusting a local certificate.

## Before installation

You need:

1. **Node.js 22.12+ on the 22.x line, or Node.js 24+.** Install from [Node.js](https://nodejs.org/en/download).
2. **Git**, or an extracted ZIP of this repository. The repository is public; downloading it does not require a GitHub account.
3. At least one local, authenticated CLI: [Claude Code setup](https://code.claude.com/docs/en/setup) or [Codex CLI](https://github.com/openai/codex).

In the terminal of the same OS/user that runs Word, verify the CLI you intend to use:

```text
node --version
claude --version
claude auth login
```

Or, for Codex:

```text
codex --version
codex login
```

You only need one backend. On Windows use a **native Windows CLI**, not a CLI installed only inside WSL. Native `.exe` installations and official npm `.cmd` shims are supported. The installer does not install or log into model CLIs for you.

Model selectors show the version resolved by your local Claude Code CLI (for example, **Opus 5**) and the full model ID below the selector. Sonnet, Opus and Haiku remain automatic aliases: their versions can change with your CLI/account configuration. Refreshing the list reads the CLI capability catalog without sending a generation request or document content. Each Claude reply records the actual model reported during that call; older CLIs that cannot provide version information are explicitly labeled **automatic version**.

## Windows installation

Target: Windows 11 with current desktop Microsoft 365 Word and Windows PowerShell 5.1 or later. Use PowerShell under your normal Word user account; administrator privileges are not required by the installer. If using a managed work device, follow your organization's add-in policy.

```powershell
git clone https://github.com/ZJU-OmniAI/LLM_in_Work.git
cd LLM_in_Work/LLM_in_Word
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

`Bypass` applies to this PowerShell process only; it does not change the machine execution policy. Review the script before running it. Windows may ask you to confirm trust for the generated localhost certificate.

The installer:

1. Copies the runtime into `%LOCALAPPDATA%\LLM_in_Word\app` and restricts access to its local data directory.
2. Creates a localhost HTTPS certificate and trusts it in **your user** certificate store.
3. Registers `manifest.xml` in Word's current-user developer add-ins registry, following [Microsoft's registration implementation](https://github.com/OfficeDev/Office-Addin-Scripts/blob/master/packages/office-addin-dev-settings/src/dev-settings-windows.ts).
4. Records CLI paths and proxy environment settings without printing credentials.
5. Starts a hidden background supervisor and adds a **per-user Startup shortcut** for subsequent sign-ins.
6. Verifies the service over HTTPS with the generated certificate. The runtime needs no external npm packages.

Completely close and reopen Word. Open **Home → Add-ins → Developer Add-ins → LLM_in_Word**. Depending on the Office version, look under **Insert → My Add-ins**, or **More Add-ins → My Add-ins**. Once loaded, a **LLM_in_Word** button appears on the Home ribbon.

If you downloaded a ZIP, extract it first and run the same PowerShell installation command in the extracted project directory. You do not need `npm ci` just to use the add-in.

## macOS installation

```bash
git clone https://github.com/ZJU-OmniAI/LLM_in_Work.git
cd LLM_in_Work/LLM_in_Word
./install.sh
```

The installer copies runtime files to `~/.llm_in_word/app`, creates a localhost HTTPS certificate, registers the user launchd service `com.llm_in_word.server`, and places the manifest in Word's sideload folder. First installation may prompt for your Mac password to trust the certificate.

Quit Word with **Cmd+Q**, reopen it, then choose **Home → Add-ins → Developer Add-ins → LLM_in_Word**. Older Word versions expose this under **Insert → My Add-ins**. See [Microsoft's Mac sideloading guide](https://learn.microsoft.com/en-us/office/dev/add-ins/testing/sideload-an-office-add-in-on-mac).

**Upgrading from word_edit:** the installer preserves an existing `~/.word_edit` directory and certificate, replaces the old launchd registration, and removes the old manifest filename. Your document target anchors and local conversation storage remain compatible. The project name is `LLM_in_Word`; the npm package name is `llm-in-word` to meet npm naming rules.

## Your first edit

1. Open a disposable copy of a Word document and open the **LLM_in_Word** side pane.
2. Select **English** in the header if needed. Choose **Claude Code** or **Codex**. Click the connection indicator if the selected backend needs attention.
3. Select a paragraph in the document. Click **Add Word selection** to add it as a target; add more selections if needed.
4. Enter an instruction, such as **“Make this paragraph more concise. Keep the meaning and all numbers unchanged.”**
5. Click **Rewrite**. The response streams into the pane; you can stop a request while it runs.
6. Inspect the diff. Keep **Track changes** enabled and click the apply button on the result card.
7. Review the actual changes in Word. Accept or reject them using Word's **Review** controls.

For document questions, switch to **Document Q&A** and ask, for example, “Summarize the document in five bullets.” For follow-up edits, describe the next change in the same conversation. If the document or targets change, the tool rebuilds context rather than reusing stale context.

| Chinese control | Meaning |
| --- | --- |
| 改写文稿 / 文档问答 | Rewrite / Ask about the document |
| 添加 Word 选中内容 | Add the current Word selection |
| 保留修订 | Apply with tracked changes |
| 生成改写 / 停止生成 | Generate / Stop |
| 连接设置 / 重新检测 | Connection settings / Check again |
| 新会话 / 会话历史 | New conversation / History |

## What does the model receive?

**Selecting one paragraph does not mean the model sees only that paragraph.** The target determines where edits may be applied. On the first request, or when context changes, the tool also sends document text as context to the selected CLI. Long documents are trimmed around targets at approximately 110,000 characters in the pane, with a default server cap of 120,000 characters. A compatible follow-up may reuse the CLI's existing session.

The backend runs locally and binds to `127.0.0.1:8377`, but model inference normally connects to the chosen provider. Your CLI's authentication, provider settings, account limits and billing still apply. Reference files are passed to that backend; CLI history may retain prompts and document content. Panel history is stored in the local Word webview. Read [data handling and security](SECURITY.md) before using sensitive documents.

## Update and manage the service

On either supported desktop platform, run these commands in the source repository:

```text
git pull --ff-only
npm run update
```

Updates back up the previous runtime. Refresh the side pane afterward; manifest changes require completely restarting Word. Re-run installation/update after changing CLI paths or proxy settings.

Windows service commands:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\windows-service.ps1 -Action Status
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\windows-service.ps1 -Action Restart
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\windows-service.ps1 -Action Stop
```

macOS restart:

```bash
launchctl kickstart -k gui/$(id -u)/com.llm_in_word.server
```

The connection settings panel shows the log location. Windows uses `%LOCALAPPDATA%\LLM_in_Word\server.log`; a fresh Mac install uses `~/.llm_in_word/server.log` (legacy upgrades retain `~/.word_edit/server.log`).

## Configuration

For direct `node server/server.js` runs, set environment variables. Installers persist CLI path overrides, proxy variables, timeout and text cap when run. Windows stores these in the access-restricted `runtime.json`; macOS uses `run.sh`.

| Environment variable | Purpose | Default |
| --- | --- | --- |
| `LLM_IN_WORD_CLAUDE_BIN` | Claude executable or JS entry point | Automatic discovery |
| `LLM_IN_WORD_CODEX_BIN` | Codex executable or JS entry point | Automatic discovery |
| `LLM_IN_WORD_TIMEOUT_MS` | Total time allowed for one CLI request | `300000` |
| `LLM_IN_WORD_MAX_CHARS` | Server document text limit | `120000` |
| `LLM_IN_WORD_DATA_DIR` | Data directory for direct server runs | `~/.llm_in_word`, or existing `~/.word_edit` |
| `LLM_IN_WORD_CERT_DIR` | Certificate directory | `<data directory>/cert` |
| `LLM_IN_WORD_PORT` | Port for direct server runs | `8377` |

The old `WORD_EDIT_*` variables remain fallback aliases. Installers use fixed platform directories and port 8377; changing the installed port also requires editing every localhost URL in `manifest.xml`. Keep `localhost`, `127.0.0.1` and `::1` excluded from your system proxy.

## Development and tests

```text
npm ci
npm test
npm run preview
```

Browser preview runs at `http://127.0.0.1:8380/taskpane.html`. A normal browser can preview the pane and check backend connectivity; reading and applying Word content requires the actual Word add-in.

Offline regression tests use synthetic text and mock CLIs, with no account credentials. [GitHub Actions](https://github.com/ZJU-OmniAI/LLM_in_Work/actions) runs them on Linux, macOS and Windows. Windows also exercises the installer and lifecycle against a real local HTTPS server. Headless CI skips the interactive Windows certificate-trust prompt; it verifies HTTPS against the generated certificate explicitly. CI does **not** automate the Word desktop application or validate its certificate dialog.

Optional live backend tests consume provider usage:

```text
npm run test:live
npm run test:live:codex
```

See [architecture](docs/architecture.md), [contributing](CONTRIBUTING.md) and the [changelog](CHANGELOG.md).

## Limitations

- Formatting preservation is best effort. Complex structures, images and unsupported HTML can fall back to plain-text replacement; review formatting before accepting edits.
- The model can make mistakes. Check facts, formulas, tables and citations yourself.
- Word's API support and organization policy vary. Windows desktop support is implemented, but interactive Windows Word acceptance testing is still outstanding.
- This is a local single-user tool, not a server for shared network or internet deployment.

## Uninstall

Windows:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\windows-service.ps1 -Action Uninstall
```

This stops the process tree, removes the Startup shortcut and Word registration, and removes this install's certificate from your user stores. Local runtime files and logs are retained at `%LOCALAPPDATA%\LLM_in_Word`; delete the folder manually if you no longer need it.

macOS:

```bash
launchctl bootout gui/$(id -u)/com.llm_in_word.server
rm -f ~/Library/LaunchAgents/com.llm_in_word.server.plist
rm -f ~/Library/Containers/com.microsoft.Word/Data/Documents/wef/LLM_in_Word-manifest.xml
```

Then remove the `LLM_in_Word-localhost` certificate in Keychain Access (legacy name: `word_edit-localhost`) and optionally delete the runtime directory. CLI-owned conversations and Word webview history are separate from the runtime and are not automatically removed.

## License

[MIT](../LICENSE). Office.js, model CLIs and their services remain subject to their respective licenses and terms. LLM_in_Word is an independent ZJU-OmniAI project, not an official Microsoft, Anthropic or OpenAI product.
