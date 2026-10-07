# Reviewer test instructions — LLM_in_PDF 0.9.2

Purpose: help users interactively read local PDFs and papers from arXiv and other platforms in Chrome with their locally installed Claude Code or Codex agent. Users select passages or crop figures and formulas for focused questions and follow-ups. The original PDF is never edited. The extension uses a bundled PDF.js view to expose text selection and image crops. Its interface is currently Chinese; English questions are supported.

## Dependencies and setup

1. Use Chrome, Node.js 22.13+ and an installed, signed-in Claude Code or Codex CLI with model access. A subscription is not included. The extension does not ask for passwords or API keys.
2. Download the companion ZIP linked in the submission or the source from https://github.com/ZJU-OmniAI/LLM_in_Work . Keep the extracted directory in a permanent location and enter `LLM_in_PDF`.
3. Install this extension and open the popup. On macOS/Linux copy its `./install.sh --extension-id ITEM_ID` command. Use the actual installed extension ID. Chrome will start the native companion when needed.
4. On Windows, use the documented HTTP fallback: in PowerShell run `$env:LLM_IN_PDF_EXTENSION_ID='ITEM_ID'; npm start`, and leave that terminal open. Default backend is `http://localhost:8765`. The same HTTP mode can be used on macOS/Linux with `LLM_IN_PDF_EXTENSION_ID=ITEM_ID npm start`. No Windows native installer is claimed.
5. Click 测试连接 (Test connection); choose the ready Claude/Codex backend. Model lists come from the CLI. Missing CLI or login must be resolved before model questions can work.

## Text and image questions

Open a public PDF such as https://arxiv.org/pdf/1706.03762, or use 选择 / 拖入本地 PDF (Choose/import local PDF) with a synthetic test file. The popup's automatic-PDF option may redirect a PDF to the bundled view; it can be switched off. 原生 PDF returns to the original viewer. Downloads blocked by a site's access controls must be obtained legitimately and imported; this extension does not bypass restrictions.

Select a sentence, click 问一下 (Ask), and enter “Explain this selected sentence in plain English.” Expected: the selected text appears as context and an answer streams beside the PDF. The extracted full document can also be part of the request. It should not change the PDF.

Click 框选图片 (Crop image) and drag over a chart or formula on one page. Ask “Describe this figure.” Expected: a preview of the actual selected pixels and a relevant answer. Up to four recent crops may accompany the request. Scans can be discussed through image crops; full-document OCR is not provided.

## Persistence, documents and permissions

Refresh: the imported document and conversation should reopen. Copy the current conversation or full history using the copy controls. Clearing the current conversation archives it; it is not an erase-all action. Removing a local PDF from the import list keeps its conversation history. Uninstalling the extension removes its extension storage, but not CLI/provider records.

Test a normal HTTPS PDF URL, a URL without a .pdf suffix that responds with application/pdf, and file import. Direct `file://` navigation requires Chrome's “Allow access to file URLs”; file-picker import does not. On a paper webpage, click 读取当前论文网页 to read it explicitly. The extension observes top-level PDF headers across sites for local document detection; it does not send browsing telemetry to the maintainers.

## Network and reviewer access

Original imported PDF bytes remain in browser storage. Extracted text (up to 600,000 characters), questions/history, selections and image crops are sent via the chosen companion and CLI to the configured model provider. The configured HTTP backend also receives these requests. arXiv text retrieval can use arxiv.org and ar5iv.labs.arxiv.org. See the published privacy policy.

The publisher must arrange authorized CLI/model test access in the private dashboard fields if reviewers need it. No passwords, tokens or CLI authentication files are included in these public instructions. Screenshots and automated tests do not replace reviewer access to the submitted product.
