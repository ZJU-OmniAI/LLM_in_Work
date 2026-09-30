# Security and data / 安全与数据说明

English · [中文](#中文)

All three assistants call a model through the **Claude Code or Codex CLI on your own computer**. The bridge runs locally, but inference normally happens on the provider's service, so this is not an offline tool. Your CLI's account, proxy, usage limits and data-handling settings apply.

## What is sent to the model

- **The selection decides where edits may be written, not what the model can read.** LLM_in_Word sends the document text; LLM_in_PowerPoint sends the text of the whole deck, slide by slide (no speaker notes); LLM_in_Overleaf sends the current `.tex` file. Very long documents are trimmed around your selections. PowerPoint sends an image of a slide only when you attach one.
- Project files and local attachments you add are passed to the CLI. Images and PDFs are written to a temporary folder and deleted when the request ends.
- Word and PowerPoint pane history is stored in the Office web view; Overleaf history is stored in the browser extension's storage. The CLI may also keep prompts, document text and replies in its own session files.
- Every edit is shown as a preview first and is written only when you click Apply. Check facts, formulas, citations and formatting yourself.

## Local boundary

| Project | Connection | Local data |
| --- | --- | --- |
| LLM_in_Word | HTTPS on the loopback address only, `127.0.0.1:8377` | macOS: `~/.llm_in_word` (older installs keep `~/.word_edit`); Windows: `%LOCALAPPDATA%\LLM_in_Word` |
| LLM_in_PowerPoint | HTTPS on the loopback address only, `127.0.0.1:8387` | macOS: `~/.llm_in_powerpoint` (reuses LLM_in_Word's trusted localhost certificate when present); Windows: `%LOCALAPPDATA%\LLM_in_PowerPoint` |
| LLM_in_Overleaf | Browser native messaging; no listening port | macOS / Linux: `~/.llm_in_overleaf`; Windows: `%LOCALAPPDATA%\LLM_in_Overleaf`. Only the fixed extension ID may start the host. |

**Tools the model may use.** All projects start Claude Code with an empty MCP configuration (`--strict-mcp-config`), so your own MCP servers are not loaded. Text-only turns run with no tools; turns with attachments may use only `Read`, restricted to those files. Codex runs in a read-only sandbox with approvals disabled; it may still load tools from your Codex configuration.

Do not forward or expose the Word or PowerPoint ports. None of the projects is an authentication gateway for shared or remote use.

## Repository contents

The repository contains no private keys, certificates, credentials, real documents or CLI sessions. The `key` in the Overleaf manifest is the **public** key that keeps the extension ID stable; running the unpacked extension needs no private key. `.gitignore` excludes common secrets and local files, but it does not replace reviewing what you commit.

## Reporting a vulnerability

Do not paste keys, real documents or logs with credentials into a public issue. If GitHub Private Vulnerability Reporting is enabled, use **Security → Report a vulnerability**; otherwise contact the maintainers through an existing private channel. Include the project, version, OS, synthetic reproduction steps, impact and redacted logs.

---

## 中文

三个子项目都通过**你电脑上的 Claude Code / Codex CLI** 调用模型。桥接程序在本机运行，但推理通常发生在服务商那边，并非离线工具；账户、代理、额度和数据处理规则以对应 CLI 及服务商的设置为准。

### 哪些内容会交给模型

- **选区决定可以写回的位置，不限制模型能读到的内容。** Word 会发送文档正文，PowerPoint 会按页发送整份演示文稿的文字（不含演讲者备注），Overleaf 会发送当前 `.tex` 文件；超长内容按选区附近截取。PowerPoint 只有在你附上当前页截图时才会发送图片。
- 你添加的项目文件和本地附件会交给 CLI。图片 / PDF 先写入临时目录，请求结束后删除。
- Word 和 PowerPoint 侧栏历史保存在 Office 网页视图的本地存储，Overleaf 历史保存在浏览器扩展存储。CLI 自身也可能把提示、正文和回复保存在它的会话文件里。
- 所有改动先显示预览，点「应用」后才写回。事实、公式、引用和格式仍需自行核对。

### 本机边界

| 子项目 | 连接方式 | 本机数据 |
| --- | --- | --- |
| LLM_in_Word | 仅回环地址的 HTTPS，`127.0.0.1:8377` | macOS：`~/.llm_in_word`（旧安装沿用 `~/.word_edit`）；Windows：`%LOCALAPPDATA%\LLM_in_Word` |
| LLM_in_PowerPoint | 仅回环地址的 HTTPS，`127.0.0.1:8387` | macOS：`~/.llm_in_powerpoint`（已装 LLM_in_Word 时沿用它已信任的本机证书）；Windows：`%LOCALAPPDATA%\LLM_in_PowerPoint` |
| LLM_in_Overleaf | 浏览器原生消息（Native Messaging），不监听端口 | macOS / Linux：`~/.llm_in_overleaf`；Windows：`%LOCALAPPDATA%\LLM_in_Overleaf`。只允许固定 ID 的扩展启动本机桥。 |

**模型能用哪些工具。** 各子项目启动 Claude Code 时都使用空的 MCP 配置（`--strict-mcp-config`），不会加载你自己配置的 MCP 服务器。纯文字轮不开放任何工具；带附件的轮次只允许 `Read`，且只针对本轮附件。Codex 在只读沙箱中运行、不请求审批，但仍可能加载你本机 Codex 配置里的工具。

不要转发或暴露 Word 和 PowerPoint 的端口。这些项目都不是面向多人或远程使用的认证网关。

### 仓库内容

仓库不包含私钥、证书、凭证、真实文档或 CLI 会话。Overleaf manifest 里的 `key` 是用于固定扩展 ID 的**公钥**，运行解压扩展不需要私钥。`.gitignore` 会排除常见凭证和本机文件，但不能代替提交前的检查。

### 报告安全问题

不要在公开 Issue 中粘贴密钥、真实文档或带凭证的日志。如仓库启用了 GitHub Private Vulnerability Reporting，请在 **Security → Report a vulnerability** 私下报告；否则通过已有私有渠道联系维护者。请写明子项目、版本、操作系统、合成复现步骤、影响和已脱敏的日志。

Details for Word / Word 细节：[LLM_in_Word/SECURITY.md](LLM_in_Word/SECURITY.md) · Details for PowerPoint / PowerPoint 细节：[LLM_in_PowerPoint/SECURITY.md](LLM_in_PowerPoint/SECURITY.md)
