LLM_in_PDF helps you read local PDFs and papers from arXiv and other platforms in Chrome, interactively using your local Claude Code or Codex agent to ask about selected passages, figures and formulas.

Read papers and ask questions with your local agent, right beside the document.

When reading a paper, you often want to understand one particular paragraph, chart or formula. Select it, ask beside the document, read the explanation and follow up. LLM_in_PDF connects the Claude Code or Codex agent already installed and signed in on your computer to that reading process, keeping the interaction focused on the part you mean.

THIS EXTENSION'S FOCUS
Read local PDFs opened in Chrome, online PDFs and paper webpages from arXiv and other platforms. Explore the paper interactively through questions about selected content; the original PDF remains unchanged. A bundled PDF.js view displays PDFs, extracts text and supports image crops.

WHAT YOU CAN DO
• Read local PDFs in Chrome and online papers from arXiv and other platforms.
• Select the exact passage you want explained, summarized or translated, then ask follow-up questions in context.
• Crop a chart, formula or scanned region and discuss the actual image.
• Keep conversations per document, revisit archived chats and copy conversations as Markdown.
• Read streamed replies with tables, code and mathematical notation.

SETUP REQUIRED
You need Node.js 22.13+ and an installed, signed-in Claude Code or Codex CLI; the extension does not include a model subscription. On macOS/Linux install the separate native bridge using the ID shown in the popup. On Windows, run the documented local HTTP companion and keep it running. Installing the browser extension alone is not enough to call your local agent.

The current interface is Chinese. Questions and answers can be in English or Chinese. Scanned PDFs support cropped-image questions, not automatic full-document OCR. The extension does not bypass document access controls. The automatic PDF-opening behavior can be switched off in the popup.

DATA AND CONTROL
When you ask, extracted document text (up to 600,000 characters), the selection, conversation and up to four recent image crops are sent through your configured bridge and CLI to the model provider. The original imported PDF remains in browser storage. Local bridging does not mean offline inference. Imported documents and conversations are stored locally; CLI and provider retention settings also apply.

An independent open-source project; not an official product of Anthropic, OpenAI, Google or any publisher.

Setup and source: https://github.com/ZJU-OmniAI/LLM_in_Work/tree/main/LLM_in_PDF
Privacy: https://github.com/ZJU-OmniAI/LLM_in_Work/blob/main/docs/chrome-store/PRIVACY.md
Support: https://github.com/ZJU-OmniAI/LLM_in_Work/issues
