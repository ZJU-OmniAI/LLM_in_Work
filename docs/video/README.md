# LLM_in_Work demo · 2026-10-08

The fourth edition opens with the project’s motivation: connect local agents to everyday apps so users can select precise targets, review proposed edits and confirm changes in place. The demos follow **Word → Overleaf → Chrome PDF → PowerPoint → Excel**. English and Chinese narration each have bilingual burned-in captions and separate SRT subtitles. Full videos and compact 720p copies are published with the [2026-10-08 release](https://github.com/ZJU-OmniAI/LLM_in_Work/releases/tag/2026-10-08).

**Play in your browser:** [English narration](../../README.md) · [中文讲解](../../README.zh-CN.md). The READMEs and release notes embed the 720p videos as GitHub video attachments. The release assets remain available for downloading the 1080p originals and subtitles.

The four editing chapters reuse the recordings and narration in the October 7 release, originally recorded for October 1, and are reordered without changing their demonstrations. The opening explains the project’s motivation and the select–review–confirm workflow. The revised PDF introduction describes connecting a local agent to PDFs in Chrome. The PDF chapter uses the real Chrome extension, its HTTP bridge and Claude Code (Sonnet, low effort), with an explicitly synthetic document. Model waiting periods may be shortened or held during narration. The UI is Chinese in both narration versions.

## Reproduce

Requirements: Node.js 22.13+, the PDF module's dev dependencies and Playwright Chromium, Python 3 with Pillow and edge-tts, ffmpeg/ffprobe, and a signed-in Claude CLI for recording. Live recording consumes account usage.

From the repository root:

```bash
npm --prefix LLM_in_PDF ci
cd LLM_in_PDF && npx playwright-core install chromium && cd ..
node docs/video/record-pdf.mjs
python3 docs/video/tts.py
python3 docs/video/compose.py --previous /path/to/2026-10-07-video-files --lang en
python3 docs/video/compose.py --previous /path/to/2026-10-07-video-files --lang zh
```

The previous folder must contain `LLM_in_Work_demo_{en,zh}.mp4` and matching `.srt` files from the [October 7 release](https://github.com/ZJU-OmniAI/LLM_in_Work/releases/tag/2026-10-07); chapter cut points in `script.json` refer to that edition. Keep these sources in a separate folder from `build/`, which receives the new outputs. Set `DEMO_FONT` to a font with Chinese coverage if PingFang (macOS) or Noto Sans CJK (Linux) is unavailable.

- `demo-paper.html`: synthetic two-page PDF fixture; no personal documents.
- `record-pdf.mjs`: imports it, selects text, asks about a chart using actual pixels, reloads history and copies the chat; also saves README screenshots.
- `script.json`: ordered chapters, bilingual narration/captions, and source time ranges for each reused editing chapter.
- `tts.py`: caches narration in `build/tts/` and synthesizes changed lines only.
- `compose.py`: trims and reorders the existing chapters, adds the motivation/workflow cards and Chrome PDF chapter; outputs MP4, SRT and chapter timing JSON in ignored `build/`.

For inline playback, upload the compact MP4s as GitHub video attachments and place each returned `https://github.com/user-attachments/assets/...` URL in its own paragraph in the Markdown. Keep the canonical attachment URL, not the temporary signed playback URL. A release download URL triggers a download and does not embed a player.

开场强调把本机 Agent 接入日常软件，实现精确选择、审阅和确认；顺序为 Word、Overleaf、Chrome PDF、PowerPoint、Excel。四个编辑模块沿用上一版真实录屏；PDF 部分是在 Chrome 中运行的真实扩展，使用合成文档和真实模型回答。代码、脚本与字幕可复现；渲染缓存和大视频不提交到 Git 历史，成片作为 Release 附件分发。
