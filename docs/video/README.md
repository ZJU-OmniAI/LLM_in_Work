# LLM_in_Work demo · 2026-10-07

The third edition covers **Word, PowerPoint, Excel, Overleaf and PDF**. English and Chinese narration each have bilingual burned-in captions and separate SRT subtitles. Full videos and compact 720p copies are published with the [2026-10-07 release](https://github.com/ZJU-OmniAI/LLM_in_Work/releases/tag/2026-10-07).

The four editing chapters reuse the real recordings from the October 1 release. The title, PDF chapter, architecture explanation and ending are new. The PDF chapter records the real extension, using its real HTTP bridge and Claude Code (Sonnet, low effort). Its source document is explicitly synthetic. Model waiting periods may be shortened or held during narration. The UI is Chinese in both narration versions.

## Reproduce

Requirements: Node.js 22.13+, the PDF module's dev dependencies and Playwright Chromium, Python 3 with Pillow and edge-tts, ffmpeg/ffprobe, and a signed-in Claude CLI for recording. Live recording consumes account usage.

From the repository root:

```bash
npm --prefix LLM_in_PDF ci
cd LLM_in_PDF && npx playwright-core install chromium && cd ..
node docs/video/record-pdf.mjs
python3 docs/video/tts.py
python3 docs/video/compose.py --previous /path/to/2026-10-01-video-files --lang en
python3 docs/video/compose.py --previous /path/to/2026-10-01-video-files --lang zh
```

The previous folder must contain `LLM_in_Work_demo_{en,zh}.mp4` and matching `.srt` files from the previous release. Set `DEMO_FONT` to a font with Chinese coverage if PingFang (macOS) or Noto Sans CJK (Linux) is unavailable.

- `demo-paper.html`: synthetic two-page PDF fixture; no personal documents.
- `record-pdf.mjs`: imports it, selects text, asks about a chart using actual pixels, reloads history and copies the chat; also saves README screenshots.
- `script.json`: bilingual narration and captions.
- `tts.py`: caches narration in `build/tts/` and synthesizes changed lines only.
- `compose.py`: combines the existing chapters with new recordings and cards; outputs MP4, SRT and chapter timing JSON in ignored `build/`.

原有四个编辑模块沿用上一版真实录屏；PDF 部分为合成文档、真实扩展和真实模型回答。代码、脚本与字幕可复现；渲染缓存和大视频不提交到 Git 历史，成片作为 Release 附件分发。
