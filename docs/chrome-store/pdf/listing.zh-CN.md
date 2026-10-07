LLM_in_PDF 把本机 Claude Code 或 Codex Agent 接入 Chrome 中的 PDF 工作流。读到哪一段、看到哪张图，直接选中或框选，在文档旁边提问，PDF 原文保持不变。

让本机 Agent，来到你正在工作的地方。

Claude Code、Codex 已经能编辑文档、解释内容。实际工作中，你还需要指出“就改这里”，在原处看清变化，并决定是否应用。LLM_in_Work 把本机已安装、已登录的 Agent 接入日常工作软件，在熟悉的界面中使用它们的能力，实现精确、局部可控的编辑、修改和问答。

这个扩展负责什么
LLM_in_PDF 专注 PDF 文字与图片的选区问答，不修改 PDF 内容。它利用随扩展打包的 PDF.js 显示文档、提取文字和框选图像，把本机 Agent 的能力接入你在 Chrome 中的阅读流程。

你可以做什么
• 打开在线 PDF、导入本地 PDF，或读取论文网页。
• 精确选择一句话或一段内容，解释、总结或翻译。
• 框选图表、公式、扫描区域，围绕真实图片讨论。
• 按文档保存对话，找回历史，并复制为 Markdown。
• 在流式回复中查看表格、代码和数学公式。

使用前需要
准备 Node.js 22.13+ 和已安装、已登录的 Claude Code 或 Codex CLI；本扩展不包含模型订阅。macOS/Linux 需要另装本机桥，命令中使用弹窗显示的扩展 ID。Windows 使用本机 HTTP 后端，需要保持服务开启。仅安装浏览器扩展，还不能调用本机 Agent。

界面目前为中文，支持中英文提问和回答。扫描件可框图提问，不自动进行全文 OCR。不绕过网站登录或下载限制。可在弹窗关闭自动打开 PDF 的行为。

数据与控制
发送问题时，提取的正文（最多 60 万字符）、选段、会话和最近最多四张框选图像会经配置的桥与 CLI 交给模型服务。导入的原始 PDF 保存在浏览器本地。本机接入不等于离线推理；CLI 与服务商的数据留存规则也会适用。

这是独立开源项目，并非 Anthropic、OpenAI、Google 或论文出版商官方产品。

Setup and source: https://github.com/ZJU-OmniAI/LLM_in_Work/tree/main/LLM_in_PDF
Privacy: https://github.com/ZJU-OmniAI/LLM_in_Work/blob/main/docs/chrome-store/PRIVACY.md
Support: https://github.com/ZJU-OmniAI/LLM_in_Work/issues
