# Reviewer test instructions — LLM_in_Overleaf 0.9.1

Purpose: connect a locally installed Claude Code or Codex agent to selected LaTeX editing and questions inside Overleaf. This is an independent integration, not an official Overleaf/Anthropic/OpenAI product.

## Dependencies and setup

1. Use Chrome on macOS, Windows or Linux. Install Node.js 22.12+ (22.x) or 24+ and a supported Claude Code or Codex CLI. Sign in using an authorized test account with model access. The extension itself has no login form and no API-key field. A model subscription is not bundled.
2. Download the companion ZIP linked in the submission, or the source from https://github.com/ZJU-OmniAI/LLM_in_Work . Keep the extracted directory in a permanent location.
3. Install this extension. Open its popup and copy the displayed installation command. In the companion's `LLM_in_Overleaf` directory run `./install.sh --extension-id ITEM_ID` on macOS/Linux or `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -ExtensionId ITEM_ID` on Windows. Replace ITEM_ID with the actual extension ID, not the development ID. No administrator permission or listening server is required for the native bridge.
4. Open a disposable project on https://www.overleaf.com/project using an authorized Overleaf account. Choose Code Editor, not the visual editor or the PDF preview. The extension also supports cn.overleaf.com.
5. Choose Claude or Codex in the popup. Check connection. If there are multiple CLI installations, set `LLM_IN_OVERLEAF_CLAUDE_BIN` or `LLM_IN_OVERLEAF_CODEX_BIN` to the intended executable before installing again with the same extension ID.

## Edit, review, confirm, undo

Put these synthetic lines in `main.tex`:

```latex
\documentclass{article}
\begin{document}
\section{Introduction}
Large language models has become useful tools for academic writing.
\section{Method}
The author selects a passage, reviews the changes, and applies a revision.
\begin{equation}
y = f(x)
\end{equation}
\end{document}
```

Select the sentence containing “models has”. Click the selection's Rewrite control or open the panel and add the selection. Ask: “Fix the grammar. Keep the meaning and all LaTeX commands.” Send the request.

Expected: a streamed answer and a diff; the source is unchanged before Apply. Click Apply: only the selected content is replaced. The Method section and equation stay intact. Press Cmd/Ctrl+Z: the group reverts. For multiple ranges, add two non-adjacent selections in the same file; each gets its own preview and the group can be applied in one editor operation. If the original text changes while a proposal is pending, stale write-back is rejected rather than silently overwriting it.

## Questions and history

Switch to Ask mode. Ask “What does this section say?” Expected: an explanation without source replacement. Add a synthetic `.bib` or text attachment if needed. Refresh the page and reopen the panel: locally saved conversation remains available. Use copy/export only on synthetic content. Switch English/中文 in the popup; both interface languages should work.

## Network and privacy

The current .tex context, selected ranges, request, conversation and user-added attachments go to the installed CLI and its configured model provider. The selection constrains edits, not all model-readable context. There is no maintainer-operated analytics service. See the published privacy policy. Uninstall the companion with `./install.sh --uninstall` or `install.ps1 -Uninstall`; CLI session files are managed separately.

## Reviewer access

The publisher must confirm a usable test-access arrangement in the dashboard if reviewers do not already have Overleaf and CLI/model access. No credentials are included in public files or ZIPs. The recordings use synthetic documents and real model replies, but do not replace the review team's ability to test the submitted package.
