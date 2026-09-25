# Architecture / 技术说明

## Runtime

```text
Word document + Office.js side pane
              │ HTTPS / NDJSON (127.0.0.1:8377)
              ▼
Local Node.js service
              │ stdin + structured CLI events
              ├── Claude Code
              └── Codex CLI → configured model provider
```

The runtime has no external npm dependencies. Development tests use jsdom. Office.js loads from Microsoft's CDN. / 运行时无额外 npm 依赖，开发测试依赖 jsdom，Office.js 由微软 CDN 加载。

| Component | Responsibility |
| --- | --- |
| `server/server.js` | Loopback HTTPS, same-origin API checks, request cancellation and attachment cleanup. |
| `server/launch.js` | Cross-platform CLI launch, official npm shim resolution, process-tree termination. |
| `server/cli.js`, `server/process.js` | Backend arguments, streaming event parsing, timeouts and error classification. |
| `server/models.js`, `server/health.js` | Model discovery and CLI/login diagnostics without paid generation. |
| `server/prompt.js` | Document context, target markers and follow-up prompts. |
| `taskpane/taskpane.js` | Office.js integration, target anchoring, review/apply, formatting and local state. |
| `taskpane/table-utils.js` | Table protocol, parsing and cell differences. |
| `install.ps1`, `tools/windows-*.{ps1,js}` | Windows installation, user Startup shortcut, supervisor and lifecycle controls. |
| `install.sh` | macOS certificate trust, launchd service, runtime staging and Word manifest installation. |

## Windows

The installer uses `%LOCALAPPDATA%\LLM_in_Word`, protected by user/SYSTEM/administrators ACLs. A PFX certificate and random password are stored under `cert`; trust is limited to CurrentUser. The Node HTTPS server loads PFX directly, so OpenSSL is not required. / Windows 不依赖 OpenSSL，证书私钥及启动配置保存在受权限保护的目录。

The add-in ID maps to the manifest path in `HKCU\Software\Microsoft\Office\16.0\WEF\Developer`, matching [Microsoft's dev-settings implementation](https://github.com/OfficeDev/Office-Addin-Scripts/blob/master/packages/office-addin-dev-settings/src/dev-settings-windows.ts). No SMB share, system service or machine-wide registry change is needed.

A Startup shortcut runs the service manager under the current user. The manager starts a hidden Node supervisor, which restarts the backend after unexpected exits. Stop/update/uninstall checks the PID's command line before terminating its process tree. CLI cancellation uses `taskkill /T /F`. This is sign-in startup, not a system service available before sign-in.

Native `.exe` CLIs execute directly. Official npm `.cmd` shims resolve to known JavaScript entry points and execute through Node with an argument array and `shell:false`; JSON, spaces, Unicode and shell characters are not interpolated through cmd.exe. Arbitrary custom batch wrappers are intentionally unsupported; use a native executable or JS entry point instead.

## macOS

Runtime files live outside Desktop to avoid background-service access restrictions from macOS TCC. Fresh installs use `~/.llm_in_word`; upgrades retain `~/.word_edit` and existing certificate trust. The launchd label is `com.llm_in_word.server`.

The installer generates a localhost PEM certificate, trusts it in the login Keychain and copies the manifest to `~/Library/Containers/com.microsoft.Word/Data/Documents/wef/`. It persists proxy variables and CLI paths in a user-only `run.sh`. CLI cancellation targets a detached POSIX process group.

## Editing and context

The initial request includes document text, selected targets and the instruction. Compatible follow-ups reuse a CLI session. Changing the document/targets rebuilds context; an explicitly expired session can be rebuilt once. Authentication, quota and general connection errors do not trigger a second automatic model generation.

NDJSON heartbeats are sent every 15 seconds. Failed or truncated output cannot be applied. Cancellation closes the associated CLI tree and request-owned temporary files are removed.

For formatted replacement, the pane flattens Word's HTML into characters with their formatting chains, computes a text diff, preserves unchanged formatting, and inherits adjacent formatting for inserted text. It validates the rebuilt text before `insertHtml`; unsupported or inconsistent structures fall back to `insertText`. Word's `\r` paragraph markers and `\v` soft breaks are normalized during comparison. / 格式迁移先对齐、再校验；不能安全迁移时回退纯文本。

## Rename compatibility

The stable add-in ID `357a0a80-3537-4833-b135-a8177994730f`, legacy `word_edit_target` content-control tag and `we:*` webview storage keys stay unchanged to preserve existing documents and history. `WORD_EDIT_*` environment variables are fallback aliases for `LLM_IN_WORD_*`. These are compatibility identifiers, not the displayed project name.

## Headless Windows CI

`-SkipCertificateTrust` is a test-only installer option: it skips the CurrentUser Root security prompt, without disabling system protections. CI still creates/exports a real certificate and validates HTTPS using that exact CA, plus registration and service lifecycle. A skipped-trust installation is not ready for Word until the user imports/trusts the certificate. Interactive trust and Windows Word remain manual acceptance checks.
