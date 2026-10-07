LLM_in_Overleaf brings your local Claude Code or Codex agent into Overleaf's Code Editor. Select the exact LaTeX passages, ask for a change, inspect the differences and decide what gets written back.

Your local agent, in the software where you already work.

Claude Code and Codex can already edit and explain documents. The missing step is pointing to the exact part you mean and reviewing the result in place. LLM_in_Work connects the agent already installed and signed in on your computer to your everyday workflow, for precise control over selected content and in-place questions.

WHAT YOU CAN DO
• Select several non-adjacent passages in the same .tex file.
• Ask to clarify, shorten, translate or revise the selected content.
• Review a separate diff for each passage before applying it.
• Apply the selected group as one editor operation; undo it with Cmd/Ctrl+Z.
• Ask about a selection or the paper without changing the source.
• Add related project files, images or PDFs as context and continue the conversation.

SETUP REQUIRED
This extension requires a separate local bridge, Node.js 22.12+ on the 22.x line or 24+, and an installed, signed-in Claude Code or Codex CLI. The extension does not include a model subscription. Install the bridge using the extension ID displayed in the popup. Then Chrome starts it on demand; no terminal server is needed during normal use.

Works in the Code Editor on overleaf.com and cn.overleaf.com. It does not edit through Overleaf's visual editor or the PDF preview. The interface supports English and Simplified Chinese. Native-bridge installers are provided for macOS, Windows and Linux.

DATA AND CONTROL
Selections control where edits are applied, not all the context sent to the model. The current .tex file, your request, conversation context and attachments you add are passed through your CLI to the configured model provider. Local bridging does not mean offline inference. History is stored locally; the CLI and model provider have their own retention settings. Nothing is written to the source until you apply a proposal.

An independent open-source project; not an official product of Overleaf, Anthropic, OpenAI or Google.

Setup and source: https://github.com/ZJU-OmniAI/LLM_in_Work/tree/main/LLM_in_Overleaf
Privacy: https://github.com/ZJU-OmniAI/LLM_in_Work/blob/main/docs/chrome-store/PRIVACY.md
Support: https://github.com/ZJU-OmniAI/LLM_in_Work/issues
