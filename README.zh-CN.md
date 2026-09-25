# LLM_in_Work

**把本机 Claude Code 与 Codex CLI，带进 Word 和 Overleaf。**

[English](README.md) · 简体中文

选中文字，描述修改要求，查看差异，再写回你正在使用的编辑器。LLM_in_Work 包含两个可独立安装的写作助手，沿用本机 CLI 的登录和模型配置。

| | [LLM_in_Word](LLM_in_Word/README.zh-CN.md) | [LLM_in_Overleaf](LLM_in_Overleaf/README.zh-CN.md) |
| --- | --- | --- |
| 使用场景 | Microsoft Word 桌面文档 | Overleaf 的 LaTeX 源码编辑器 |
| 审阅方式 | 段落、表格差异预览，可保留 Word 修订 | 逐段 LaTeX 差异预览，整组修改可一次撤销 |
| 多目标修改 | 最多 8 个段落或表格 | 同一 `.tex` 文件中的多个不连续选段 |
| 文档问答 | 以文档正文作为上下文 | 以当前 `.tex` 和附加项目文件作为上下文 |
| 本机连接 | Office.js 加载项 → 本机 HTTPS → CLI | 浏览器扩展 → Native Messaging → CLI |
| 安装平台 | Windows、macOS | macOS 安装器，适配 Chrome / Chromium 浏览器 |
| 界面语言 | 中文、英文 | 中文 |
| 详细介绍 | **[进入 Word 子项目 →](LLM_in_Word/README.zh-CN.md)** | **[进入 Overleaf 子项目 →](LLM_in_Overleaf/README.zh-CN.md)** |

## 能做什么

- **润色、精简、翻译和改写**：直接在编辑器中完成，减少来回复制。
- **先看差异，再应用**：生成结果先展示为预览，由你决定是否写回。
- **多个选段统一修改**：用同一条要求修改多处内容，保留未选中的正文。
- **多轮交流与参考附件**：继续细化结果、围绕文档提问、补充参考文件、查看本地会话历史。
- **切换后端和模型**：支持 Claude Code、Codex CLI，以及对应模型支持的思考强度。

### LLM_in_Word：在 Word 里审阅和修改

通过 Word 侧栏修改正文和表格，查看新增、删除内容，按需保留修订，并在 Word「审阅」中接受或拒绝。格式迁移尽力保留原样；无法支持的结构会明确提示纯文本回退。

[功能、安装与使用指南](LLM_in_Word/README.zh-CN.md)

### LLM_in_Overleaf：在 Overleaf 里修改 LaTeX

通过浏览器扩展，收集同一源码文件中的多个选段，逐段查看替换稿，再一次写回。应用前检查文件名和原文，避免把过时结果写到错误位置；整组操作可以一次撤销。支持 Overleaf 主站及中文站。

[功能、安装与使用指南](LLM_in_Overleaf/README.zh-CN.md)

## 开始使用

准备 Node.js **22.12+（22.x）或 24+**，并安装、登录至少一个本机后端：Claude Code 或 Codex CLI。

```bash
git clone https://github.com/ZJU-OmniAI/LLM_in_Work.git
cd LLM_in_Work
```

然后按照 [Word 安装指南](LLM_in_Word/README.zh-CN.md#安装前准备) 或 [Overleaf 安装指南](LLM_in_Overleaf/README.zh-CN.md#安装macos) 操作。两个子项目各有安装器，可以只安装其中一个，也可以同时使用。

```text
LLM_in_Work/
├── README.md              # 功能总览和子项目导航
├── LLM_in_Word/           # Word 加载项、本机 HTTPS 服务及安装器
└── LLM_in_Overleaf/       # Overleaf 浏览器扩展和原生消息桥
```

## 开发与数据说明

两个项目运行时均无需额外 npm 依赖；开发测试使用模拟 CLI 和合成文档。[参与开发](CONTRIBUTING.md) 列出了独立测试命令和 CI 范围。

桥接程序在本机运行，但模型推理通常连接相应服务商。选区限定写回位置，**不代表只把选区交给模型**。详见[安全与数据说明](SECURITY.md)。

[MIT 许可证](LICENSE)。由 ZJU-OmniAI 独立维护，并非 Microsoft、Overleaf、Anthropic 或 OpenAI 的官方产品。
