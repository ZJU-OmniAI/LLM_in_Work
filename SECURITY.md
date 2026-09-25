# 安全与数据说明

两个子项目都通过本机 Claude Code / Codex CLI 调用模型。桥在本机运行，但推理通常连接模型服务商，并非完全离线；账户、代理、额度和数据处理受对应 CLI 及其服务方设置约束。

## 文档与附件

- 选区决定可写回的目标，不限制模型只读取选区。Word 会发送文档正文，Overleaf 会发送当前 `.tex` 文件，超长内容按各自策略截取。
- 添加的项目文件和本地附件会作为上下文提供给 CLI。二进制附件临时落盘并在请求收尾时清理。
- Word 侧栏历史保存在网页视图的本地存储；Overleaf 历史保存在浏览器扩展存储。CLI 自身也可能保存提示、正文和模型回复。
- 改写先提供差异预览，由用户点击应用。模型输出仍需核对事实、公式、引用和格式。

## 本机连接

| 子项目 | 连接方式 | 本机配置 |
| --- | --- | --- |
| LLM_in_Word | 仅回环地址的 HTTPS，默认 `127.0.0.1:8377` | macOS 使用 `~/.llm_in_word`，旧安装沿用 `~/.word_edit`；Windows 使用 `%LOCALAPPDATA%\LLM_in_Word` |
| LLM_in_Overleaf | 浏览器 Native Messaging，不监听端口 | 使用 `~/.llm_in_overleaf` 和 `com.llm_in_overleaf.host`，仅允许固定扩展 ID 连接 |

Word 详细说明见 [Word 数据与安全文档](LLM_in_Word/SECURITY.md)。Overleaf 的 Claude 调用禁止执行和编辑等工具，Codex 使用只读沙箱；这些限制不等于禁用本机配置中的一切工具。两个项目均面向单用户本机使用。

## 仓库内容

仓库不包含本机私钥、证书、凭证、真实文档或 CLI 会话。Overleaf manifest 内的 `key` 是用于保持扩展 ID 的**公钥**，不是登录凭证；运行解压扩展无需对应私钥。`.gitignore` 会排除常见凭证和本机文件，但不能替代提交审查。

## 报告问题

不要在公开 Issue 中粘贴密钥、真实文档或带凭证的日志。如仓库启用了 GitHub Private Vulnerability Reporting，可在 Security 页面私下报告；否则请通过已有的私有协作渠道联系维护者。

报告请包含子项目名称、版本、操作系统、合成复现步骤、影响和已去除敏感信息的日志。
