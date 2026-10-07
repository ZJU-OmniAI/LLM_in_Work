# Privacy policy — LLM_in_Overleaf and LLM_in_PDF

Effective date: 8 October 2026. Applies to version 0.9.1 of both Chrome extensions and their companion programs in the [LLM_in_Work project](https://github.com/ZJU-OmniAI/LLM_in_Work). Maintained by ZJU-OmniAI and contributors. [中文](#中文).

## Purpose and information processed

These extensions connect the Claude Code or Codex agent installed on your computer to an editing or document-reading workflow. They do not provide a separate model account. Local integration does not mean offline inference: your configured CLI normally sends requests to a model provider.

- **Overleaf:** the extension reads the current `.tex` document, selected ranges, file/project identifiers and URLs, your requests and conversation context. It also processes project files and local text, image or PDF attachments you explicitly add. Context may include the current file beyond the selected passages; long files are trimmed around the selection. The selection controls where edits may be applied. Proposed edits are written only when you click Apply.
- **PDF:** the extension processes the PDF or paper page you open with it, document URLs and titles, extracted text, selected passages, your messages and replies, and image regions you crop. When you ask, up to 600,000 characters of extracted text and up to four recent images can accompany the conversation. Imported PDF bytes remain in browser storage; extracted text and image crops are sent for questions. The extension does not edit the original PDF.
- **Settings and diagnostics:** chosen backend/model/effort, interface settings, model catalogs, CLI executable paths, versions and readiness/error status support setup and operation. The companion may record proxy/CLI path settings in a local launcher so the browser can start it. Do not publish that launcher or diagnostic logs containing credentials.
- **Document discovery:** the PDF extension recognizes top-level PDF response headers and document links. arXiv pages can open its panel automatically. This detection happens locally and is not general browsing-history telemetry. Imported file access is chosen by the user; opening `file://` URLs also requires Chrome's separate file-access switch.

Document content and conversations may contain personal, confidential or otherwise sensitive information. Select documents and a model service appropriate for that content.

## Where information goes

On a submitted request, the extension sends context to its local native companion or, for PDF, the configured HTTP backend. The companion invokes your installed CLI, which communicates with the model provider configured for your account. Claude Code normally uses Anthropic services; Codex normally uses OpenAI services. A custom CLI/provider/proxy configuration may change the recipient. The extensions do not read your CLI login credentials or ask you to enter an API key; the CLI manages its own authentication.

The PDF extension fetches online documents from their source websites. Its arXiv text fallback may fetch pages from arxiv.org and ar5iv.labs.arxiv.org. Those services receive the network requests needed to retrieve the document. No access control or paywall is bypassed. If you change the PDF HTTP backend from the default loopback address, that backend receives the request data you send through it.

This project does not operate an analytics, advertising, document-upload or model-proxy service. The code contains no telemetry sent to the maintainers. We do not sell user data, use it for advertising or unrelated profiling, or use it for creditworthiness/lending decisions. Processing and transfer are limited to the user-facing editing or question-answering features and the services the user chooses. Provider and CLI privacy/retention settings apply independently. Replies are displayed as content, not executed as downloaded extension code. All extension JavaScript, workers, WASM and rendering libraries are bundled.

## Storage, retention and removal

Settings and project/document conversations are stored in `chrome.storage.local`; imported PDFs are stored in the browser profile's IndexedDB. Conversations can include text, attachments/crops, source identifiers and model replies. Starting a new conversation may archive the previous one (up to ten archives per document/project), so it is not an erase-all operation. Imported PDFs can be removed from the file list independently of their conversations. Use the history controls to remove available entries, or remove the extension to remove its extension storage. Export anything you want to keep before uninstalling; reinstalling under a different extension ID does not automatically migrate data.

The local bridge stores configuration and may use a local working directory. The CLI may retain prompts, document content and replies in its session files. Removing the browser extension or bridge does not delete the CLI's sessions or provider-side copies; manage those through the corresponding CLI/provider. Temporary attachment/image files created for a request are removed on completion or cancellation; interrupted/crashed processes may leave temporary files for the operating system or user to clean up.

Copy/export actions write the requested conversation to your clipboard or a file at your direction. The extensions do not read your clipboard. Files you export are under your control.

## Choices, updates and contact

You choose the document, requested action, attachments, model backend and whether to apply a proposed edit. You can stop generation, disable automatic PDF opening, remove imported files, export conversations, or uninstall. Stopping a request cannot retract information already sent to a provider.

Material changes to these practices will be reflected in this document and its effective date. For questions, contact the maintainers through [GitHub Issues](https://github.com/ZJU-OmniAI/LLM_in_Work/issues); do not include personal documents or credentials in public issues. For security-sensitive reports, follow [SECURITY.md](../../SECURITY.md).

## 中文

生效日期：2026 年 10 月 8 日。适用于 LLM_in_Overleaf、LLM_in_PDF 两个 Chrome 扩展及其配套本机程序的 0.9.1 版本，由 ZJU-OmniAI 与贡献者维护。

**用途与数据。** 两个扩展把你本机安装的 Claude Code、Codex Agent 接入工作流。本机桥不等于离线模型。Overleaf 会处理当前 `.tex` 文件、选段、项目/文件标识与网址、指令、会话及主动添加的附件；选区限定写回位置，不限定模型读取的全部上下文。只有点击应用才会写入修改。PDF 会处理打开的文档、网址与标题、提取文字、选段、消息、回复和框选图像；提问时可携带最多 60 万字符正文与最近最多四张图像。导入的原 PDF 字节保存在浏览器，提取文字和图像会用于模型请求，原 PDF 不被改写。

扩展还会处理后端、模型、思考强度和界面设置，以及 CLI 路径、版本、就绪状态和错误。桥安装器可能把代理与 CLI 路径设置保存到本地启动脚本，供浏览器启动；不要公开这些文件。PDF 顶层响应识别在本地进行，不向维护者发送通用浏览记录；arXiv 页面可自动打开面板，其他论文网页通过用户操作读取。文件导入由用户选择，直接读取 `file://` 还需单独开启 Chrome 文件访问权限。

**传输与第三方。** 发送请求后，文档上下文通过原生桥或 PDF 配置的 HTTP 后端交给 CLI，再发往其配置的模型服务（通常 Claude Code 为 Anthropic、Codex 为 OpenAI；自定义服务商或代理会改变接收方）。扩展本身不读取 CLI 登录凭证，也不要求输入 API Key。PDF 会向原网站请求文档；arXiv 文字提取的回退服务可能使用 arxiv.org 与 ar5iv.labs.arxiv.org。不绕过访问限制。若主动把 HTTP 后端改为非本机地址，该后端将接收经它发送的请求。

项目不运营广告、分析、文档上传或模型代理服务器，不向维护者发送遥测，不出售数据，不用于广告、无关画像或信贷决策。处理仅服务于用户可见的编辑和问答功能。CLI 与模型服务商有独立的数据留存规则。文档和对话可能包含敏感信息，使用前请确认所选服务适合处理这些内容。

**保存与删除。** 设置和会话保存在浏览器扩展本地存储，导入的 PDF 保存在 IndexedDB。新建对话可能归档上一段会话，每文档/项目最多十条归档，不等于删除全部历史。移除导入文件也不会同时清除会话。可使用历史管理操作，或卸载扩展删除扩展存储；卸载前先导出需要保留的内容。不同扩展 ID 的存储不会自动迁移。桥的配置、CLI 会话及服务商侧内容需分别管理，卸载扩展不会同时删除它们。请求期间创建的临时附件通常在完成或取消后删除，异常崩溃可能留下临时文件。

复制与导出仅在你操作时把指定内容写入剪贴板或文件，不读取剪贴板。你可停止生成、关闭自动打开 PDF、移除文件、导出或卸载；停止生成无法收回已发出的数据。

政策变化会更新本文与生效日期。联系入口：[GitHub Issues](https://github.com/ZJU-OmniAI/LLM_in_Work/issues)，请勿在公开问题中附上私人文档或凭证。安全问题按 [SECURITY.md](../../SECURITY.md) 处理。
