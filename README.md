# LLM_in_Work

**Bring your local Claude Code and Codex CLI into Word and Overleaf.**

English · [简体中文](README.zh-CN.md)

Select the text you want to improve, describe the change, review the diff, and apply it in the editor you already use. LLM_in_Work brings together two independent writing assistants that use your existing local CLI login.

| | [LLM_in_Word](LLM_in_Word/README.md) | [LLM_in_Overleaf](LLM_in_Overleaf/README.md) |
| --- | --- | --- |
| Write in | Microsoft Word desktop | Overleaf's LaTeX source editor |
| Review changes | Text and table diffs; optional Word tracked changes | Per-selection LaTeX diffs; apply as one undoable editor transaction |
| Edit together | Up to 8 paragraphs or tables | Multiple non-contiguous selections in one `.tex` file |
| Ask questions | Use document text as context | Use the current `.tex` file and attached project files |
| Local connection | Office.js add-in → localhost HTTPS → CLI | Browser extension → Native Messaging → CLI |
| Installation | Windows and macOS | macOS installer for Chrome / Chromium browsers |
| Interface | English and Simplified Chinese | Simplified Chinese |
| Get started | **[Word guide →](LLM_in_Word/README.md)** | **[Overleaf guide →](LLM_in_Overleaf/README.md)** |

## What you can do

- **Polish, shorten, translate and revise** without copying text between an editor and a chat window.
- **Review before applying.** Generation produces a preview; you decide when to write it back.
- **Work with multiple targets.** Give several selected passages one instruction while keeping the surrounding text intact.
- **Continue the conversation.** Refine a draft, ask questions, attach references and revisit local conversation history.
- **Choose your backend.** Use Claude Code or Codex CLI, with model selection and supported reasoning levels.

### LLM_in_Word

A Word side pane for prose and tables. Preview additions and deletions, apply edits with optional tracked changes, and accept or reject them in Word's Review tab. Formatting is preserved where supported, with an explicit plain-text fallback for unsupported content.

[Features, installation and usage](LLM_in_Word/README.md) · [中文指南](LLM_in_Word/README.zh-CN.md)

### LLM_in_Overleaf

A browser extension for LaTeX writing on `overleaf.com` and `cn.overleaf.com`. Collect several selections in one source file, review a replacement for each, then apply them together. Source and filename checks guard against applying stale edits; the whole operation can be undone once in the editor.

[Features, installation and usage](LLM_in_Overleaf/README.md) · [中文指南](LLM_in_Overleaf/README.zh-CN.md)

## Get started

Install Node.js **22.12+ (22.x) or 24+**, and install and sign in to at least one local backend: Claude Code or Codex CLI. Then clone this repository:

```bash
git clone https://github.com/ZJU-OmniAI/LLM_in_Work.git
cd LLM_in_Work
```

Choose the [Word installation guide](LLM_in_Word/README.md#windows-installation) or the [Overleaf installation guide](LLM_in_Overleaf/README.md#installation-macos). Each subproject has its own installer and dependencies; install either or both.

```text
LLM_in_Work/
├── README.md              # Overview and project navigation
├── LLM_in_Word/           # Word add-in, local HTTPS service and installers
└── LLM_in_Overleaf/       # Browser extension and native messaging host
```

## Existing installations

This repository was previously named **LLM_in_Word**. The Word project now lives in `LLM_in_Word/`; **overleaf_edit** is now **LLM_in_Overleaf**. After updating a checkout, enter the appropriate subdirectory before running its installer. If you moved an Overleaf checkout, rerun its installer and load the extension from its new `extension/` directory.

Stable add-in / extension IDs, conversation storage keys and legacy runtime directories are preserved. See the individual guides for migration details.

## Development and data

Both projects run without additional npm runtime dependencies. Development tests use mock CLIs and synthetic documents. See [Contributing](CONTRIBUTING.md) for per-project test commands and CI coverage.

The bridge runs locally, but model inference usually connects to the selected provider. Selecting a passage limits the write-back target; it does **not** mean only that passage is sent as context. Read the [data and security notes](SECURITY.md).

[MIT license](LICENSE). An independent ZJU-OmniAI project; not an official Microsoft, Overleaf, Anthropic or OpenAI product.
