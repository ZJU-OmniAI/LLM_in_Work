# 更新记录

## Unreleased

- Find the Codex CLI that newer Codex and ChatGPT desktop apps ship in `Contents/Resources/codex-cli/bin`, so Codex works without a separate install.

中文摘要：能找到新版 Codex / ChatGPT 桌面应用自带的 Codex CLI，不单独安装也能用 Codex。

## 0.7.1 — 2026-09-30

- Explanations now follow the language of your instruction, falling back to the pane's interface language. Previously the model always explained its edits in Chinese, even in the English interface.
- Replacements keep the document's language unless you ask for a translation; the assistant no longer introduces itself to the model as a Chinese-only writer.
- Markdown tables in answers are rendered as tables instead of raw `|` text.
- The pane sends its interface language with each request. The Windows installation check reads the expected version from `package.json`.
- The **Writing engine** section can collapse to a one-line summary (backend · model · effort), roughly doubling the space for results in a short pane. It starts collapsed when the pane is shorter than 760 px and remembers your choice.
- Table edits align rows by content. Inserting or deleting a row in the middle now produces a single tracked row insertion or deletion, instead of rewriting every following row; the preview highlights only the cells that really changed.
- The connection banner shows CLI setup hints in the interface language; in the English interface they previously appeared in Chinese.

中文摘要：说明文字跟随指令语言（此前英文界面下也总是中文说明）；改写结果保持原文语言；表格按内容对齐行，中间插入/删除一行不再把后面每行都改写一遍；写作引擎设置可折叠为一行摘要，结果区域约增大一倍；英文界面的连接提示不再显示中文；回答里的 Markdown 表格正常显示；安装检查不再写死版本号。更新：在仓库目录运行 `npm run update`。

## 0.7.0 — 2026-09-13

- Add English and Simplified Chinese interfaces with a persistent header language selector and automatic initial locale selection.
- Localize controls, presets, model details, diagnostics, previews, history actions, and application errors while preserving document/model content and editing state.
- Show Claude versions from the local CLI capability catalog and record actual response model IDs.
- Update both READMEs for the public repository and the English interface; add locale and state-preservation regressions.

## 0.6.0 — 2026-09-13

- Rename the project and private GitHub repository to **LLM_in_Word**; preserve legacy data, document anchors and environment-variable aliases.
- Add native Windows installation, current-user localhost certificate trust, Word developer registration, login startup, update/restart/stop/uninstall controls.
- Launch Windows native executables and official npm CLI entry points without shell interpolation; cancel entire CLI process trees.
- Add Windows CI coverage for the backend and installation lifecycle, including certificate-verified HTTPS.
- Make English the default README and add a complete Chinese guide with platform-specific instructions and three real Word screenshots.
- Read target content without Word control boundary markers; retry macOS launchd registration while an old service finishes shutting down.

## 0.5.0 — 2026-09-09

- 重设计 Word 窄侧栏，突出目标、指令和审阅流程。
- 增加 CLI 路径、版本和登录诊断，补齐应用内 CLI 与 nvm 路径发现。
- 统一流式处理、总超时、进程组取消和服务关闭时的清理。
- 修复部分输出被误判成功、中文输入法误发送、读取文档期间重复提交等问题。
- 保存输入草稿，支持附件拖拽，根据正文、模型和会话进度重建上下文。
- Codex 分页读取模型与支持的思考档位；Claude 使用稳定别名。
- 提供保留旧运行目录备份的更新安装流程。
- 74 项离线回归检查，以及单独的真实 CLI 冒烟测试。

## 仓库整理 — 2026-09-13

- 增加 MIT 许可证、贡献指南、数据与安全说明。
- 整理中文与英文入门说明、技术文档和 GitHub Issue / PR 模板。
- 增加 macOS / Linux 的自动测试工作流。
- 排除本机状态、备份、凭证、日志和用户文档。
