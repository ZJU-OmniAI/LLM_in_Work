LLM_in_PDF brings your local Claude Code or Codex agent into your PDF workflow in Chrome. Select a passage or crop a figure and ask beside the document, with the original PDF unchanged.

Your local agent, in the software where you already work.

Claude Code and Codex can already edit and explain documents. The missing step is pointing to the exact part you mean and reviewing the result in place. LLM_in_Work connects the agent already installed and signed in on your computer to your everyday workflow, for precise control over selected content and in-place questions.

THIS EXTENSION'S FOCUS
LLM_in_PDF provides questions and explanations for selected PDF text and images. It does not modify PDF content. It integrates your local agent into Chrome's document workflow, using a bundled PDF.js view for text selection and image crops.

WHAT YOU CAN DO
• Open online PDFs, import local PDFs, or read supported paper webpages.
• Select the exact passage you want explained, summarized or translated.
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
