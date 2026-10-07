LLM_in_PDF 帮你在 Chrome 中阅读本地 PDF 和 arXiv 等平台的论文，交互式调用本机 Claude Code、Codex Agent，围绕选中的文字、图表或公式进行局部问答。

让本机 Agent，陪你边读论文、边提问。

读论文时，你往往只想弄懂眼前这一段、这张图或这个公式。选中它，直接在文档旁提问、查看解释，再继续追问。LLM_in_PDF 把你本机已安装、已登录的 Claude Code 或 Codex 接入这个阅读过程，让问答精确围绕当前局部内容展开。

这个扩展负责什么
支持 Chrome 中打开的本地 PDF、arXiv 等平台的在线 PDF 和论文网页。你可以交互式阅读、选择局部内容提问，PDF 原文保持不变。PDF 视图使用随扩展打包的 PDF.js 显示文档、提取文字和框选图像。

你可以做什么
• 阅读 Chrome 中打开的本地 PDF，以及 arXiv 等平台的在线论文。
• 选中一句话或一段内容，解释、总结、翻译，并结合上下文继续追问。
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
