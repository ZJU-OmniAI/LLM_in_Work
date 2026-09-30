# 更新记录 / Changelog

## 2026-09-30 — LLM_in_Word 0.7.2

- **A roomier Word pane, laid out like LLM_in_Overleaf:** one summary row at the top; model, language, mode and targets move into a floating **Settings** card. The conversation gets about three times the height.
- **Codex from the desktop apps:** both assistants now find the Codex CLI bundled with the Codex and ChatGPT apps.

中文：Word 侧栏改成和 Overleaf 一样的布局，顶部只留一行，设置和目标收进浮层卡片，对话区高度约为原来的三倍；两个助手都能找到 Codex / ChatGPT 桌面应用自带的 Codex CLI。

## 2026-09-30 — LLM_in_Overleaf 0.9.0 · LLM_in_Word 0.7.1

- **Overleaf in English:** a full English interface with a live English / 中文 switch.
- **Explanations in your language:** both assistants reply in the language of your instruction and keep the document's language in replacements.
- **Safer Overleaf backend:** Claude runs without your MCP servers or extra tools; stricter process lifecycle, timeouts and actionable errors.
- **Overleaf on Windows and Linux:** new installers with a self-check and uninstall option; CI covers all three platforms.
- **Documentation:** redesigned overview, demo videos with Chinese and English narration, bilingual security and contributing guides.

中文：Overleaf 新增英文界面；两个助手的说明文字跟随指令语言；Overleaf 后端安全加固；Overleaf 支持 Windows / Linux 安装；重做总览文档并附中英文讲解的演示视频。

## 2026-09-26 — LLM_in_Work

- Rename the repository from LLM_in_Word to LLM_in_Work, preserving its Git history.
- Move the Word add-in into `LLM_in_Word/`.
- Add the Overleaf extension as `LLM_in_Overleaf/`.
- Add English and Chinese overview pages and separate feature / installation guides.
- Update repository links, installation paths, package metadata and per-project CI.

Project history: [Word](LLM_in_Word/CHANGELOG.md) · [Overleaf](LLM_in_Overleaf/CHANGELOG.md).
