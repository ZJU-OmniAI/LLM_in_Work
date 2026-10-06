## LLM_in_PDF 0.9.0 joins LLM_in_Work

`paper_read` is now **LLM_in_PDF**, alongside Word, PowerPoint, Excel and Overleaf.

- Read online/local PDFs and paper webpages. Ask about selected passages or cropped figures, with the full extracted text as context.
- Render Markdown tables, code and math; save per-document conversations and copy current/all history.
- Keep the existing extension ID, conversation data and `PAPER_READ_*` settings compatible. New settings use `LLM_IN_PDF_*`.
- Install the native bridge on macOS/Linux with `cd LLM_in_PDF && ./install.sh`. Windows uses `npm start` and the HTTP fallback.
- Both language READMEs, security documentation and CI now include the PDF assistant. No private extension signing key is included.

## New narrated videos

The attached **English and Chinese** videos cover all five assistants, with bilingual captions and separate SRT subtitles. Each language has a full 1080p file and a compact 720p version.

The four editing chapters reuse the October 1 real recordings. The new PDF chapter uses the actual extension, a synthetic document and real Claude Code (Sonnet) answers. The PDF interface is Chinese in both versions. Source scripts: [docs/video](https://github.com/ZJU-OmniAI/LLM_in_Work/tree/main/docs/video).

## Validation

286 offline tests passed locally across the five projects. Both PDF Chromium suites passed, as did real Claude/Codex native-bridge smoke tests and the real PDF text/image recording. See [verification details](https://github.com/ZJU-OmniAI/LLM_in_Work/blob/main/LLM_in_PDF/docs/verification.md) for coverage and limits.

## 中文

新增第五个助手 **LLM_in_PDF**（原 `paper_read`）：在线 / 本地 PDF、论文网页、选字与框图提问、Markdown / 公式、会话恢复与完整导出。保留扩展 ID、旧会话键与旧环境变量；从新目录重装原生桥并重新加载扩展即可迁移，勿先卸载旧扩展。

中英文 README、截图、CI 与介绍视频已更新。附件包含两种配音的 1080p、720p 成片和独立双语字幕；PDF 演示使用合成文档和真实模型回复。本机共 286 项离线测试通过，另通过两组浏览器回归与 Claude / Codex 真实问答检查。
