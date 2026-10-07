# LLM_in_Work · story edit · 2026-10-08

The video opens with a small, familiar problem: a draft is nearly due, and the writer wants to improve just one paragraph. It moves from explaining a location to directly selecting it, reviewing the diff and confirming the edit. The closing returns to that same paragraph.

**Word → Overleaf → Chrome PDF → PowerPoint → Excel.** The core positioning stays the same: local agents inside everyday apps, precise selections, reviewed edits, and PDF questions in Chrome with the source unchanged.

[Watch in English](../../README.md) · [中文故事版](../../README.zh-CN.md) · [1080p videos, subtitles and source clips](https://github.com/ZJU-OmniAI/LLM_in_Work/releases/tag/2026-10-08-story).

## What changed in this edit

- Fresh narration throughout: Chinese uses Xiaoyi Neural and English uses Ava Multilingual Neural, with short conversational sentences, deliberate pauses and gentle voice processing. Narration is synthesized, not a human voice recording.
- Live-action close-ups, a three-panel selection/review/confirmation sequence, animated scenario bubbles, moving chapter layouts, a flowing connection diagram and a closing montage. There are no long static title cards.
- A quiet original instrumental bed made from synthesized pads and plucked notes; it ducks under narration. No sampled music or third-party soundtrack is used.
- New bilingual subtitle timing and a shorter edit. The screenshots and interactions come from real demonstrations; the opening’s location questions are explicitly marked as a scenario illustration.

The Word, Overleaf, PowerPoint and Excel shots come from the original October 1 raw recordings. Overleaf is a local demonstration page running the real extension and editor, not the hosted website. The PDF shots use the real Chrome extension and a synthetic document, with real CLI answers. Some actions are sped up and model waiting is shortened. The source clips contain no narration or burned-in captions.

## Reproduce

Requirements: Python 3 with `Pillow`, `numpy`, `opencv-python` and `edge-tts`; `ffmpeg` / `ffprobe`; a Chinese-capable font (PingFang on macOS or Noto Sans CJK on Linux). Normal rendering does not call an LLM or access personal documents.

Download `LLM_in_Work_story_sources.zip` from the release and extract it so that `docs/video/build/story-sources/` contains the MP4 clips and `manifest.json`. Then run:

```bash
python3 docs/video/tts.py
python3 docs/video/compose.py --lang zh
python3 docs/video/compose.py --lang en
```

For a short review before rendering the full movie:

```bash
python3 docs/video/compose.py --lang zh --preview
python3 docs/video/compose.py --lang en --stills
```

- `script.json`: story beats, captions, narration, shot order and voice settings.
- `prepare-story.py`: crops caption-free clips from the original recording folder (`--recordings /path/to/LLM_in_Work_demo_video`) and the PDF capture (`--pdf /path/to/pdf-live.webm`). The release bundle already contains its outputs.
- `tts.py`: synthesizes and caches narration with word timings in `build/story-tts/`.
- `compose.py`: renders moving layouts around live footage, burns in bilingual captions, mixes the original score, and exports 1080p/720p MP4s, SRT and chapter timing JSON. Voice audio is not time-stretched.
- `record-pdf.mjs` and `demo-paper.html`: reproduce the synthetic PDF capture when a fresh recording is needed; this optional step uses a signed-in CLI and consumes account usage.

The videos remain playable inline on GitHub via canonical `https://github.com/user-attachments/assets/...` URLs. Release assets provide the downloadable 1080p originals and subtitles. Generated media stays in ignored `build/`; no large video files are added to Git history.

新版以“赶稿时只想改这一段”为线索：遇到定位的麻烦，转向直接选中、审阅、确认，最后回到开场那一段。全片重录温暖女声，加入真实操作特写、动态分屏、窗口切换、流动连线和结尾蒙太奇；原创轻音乐在人声出现时降低音量。介绍顺序和 Chrome PDF 的定位保持一致。
