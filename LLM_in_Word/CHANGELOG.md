# 更新记录

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
