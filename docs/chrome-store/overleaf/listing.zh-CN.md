LLM_in_Overleaf 把本机 Claude Code 或 Codex Agent 接入 Overleaf 的源码编辑工作流。直接选中要处理的 LaTeX 段落，提出要求，逐段审阅差异，确认后再写回。

让本机 Agent，来到你正在工作的地方。

Claude Code、Codex 已经能编辑文档、解释内容。实际工作中，你还需要指出“就改这里”，在原处看清变化，并决定是否应用。LLM_in_Work 把本机已安装、已登录的 Agent 接入日常工作软件，在熟悉的界面中使用它们的能力，实现精确、局部可控的编辑、修改和问答。

你可以做什么
• 在同一个 .tex 文件中选择多个不连续段落。
• 精确润色、精简、翻译或改写选中的内容。
• 逐段查看新旧差异，核对每处修改后再决定是否应用。
• 整组修改作为一次编辑写入，Cmd/Ctrl+Z 一次撤销。
• 围绕选段或论文提问，问答模式不改动源码。
• 添加相关项目文件、图片或 PDF 作为上下文，继续多轮交流。

使用前需要
本扩展需要另外安装本机桥、Node.js 22.12+（22.x）或 24+，并准备已安装、已登录的 Claude Code 或 Codex CLI。扩展不包含模型订阅。按照弹窗显示的扩展 ID 安装本机桥后，Chrome 会按需启动它，日常无需手动开启终端服务。

支持 overleaf.com 与 cn.overleaf.com 的 Code Editor；不支持可视化编辑器和 PDF 预览中的编辑。提供中英文界面，以及 macOS、Windows、Linux 本机桥安装脚本。

数据与控制
选区决定可以写回的位置，并不表示只发送选中的文字。当前 .tex 文件、指令、会话上下文及主动添加的附件会经本机 CLI 交给所配置的模型服务。本机接入不等于离线推理。历史保存在本地；CLI 和模型服务商另有自己的留存设置。修改需要你审阅并点击应用后才会写入。

这是独立开源项目，并非 Overleaf、Anthropic、OpenAI 或 Google 官方产品。

Setup and source: https://github.com/ZJU-OmniAI/LLM_in_Work/tree/main/LLM_in_Overleaf
Privacy: https://github.com/ZJU-OmniAI/LLM_in_Work/blob/main/docs/chrome-store/PRIVACY.md
Support: https://github.com/ZJU-OmniAI/LLM_in_Work/issues
