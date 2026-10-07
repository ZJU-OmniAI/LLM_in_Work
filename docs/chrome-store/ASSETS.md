# Store assets and provenance

Captured/generated on 2026-10-08 for extension version 0.9.1. All screenshot canvases are 1280×800 PNG, square-cornered and full-bleed. Each extension has English and Simplified Chinese listing asset folders. No personal document, account or credential is shown.

- **Overleaf:** the real extension UI and a real CodeMirror editor run on a local synthetic demonstration workspace. The visible header says `DEMO WORKSPACE · REAL EXTENSION UI`; this is not the hosted Overleaf website. Selection, live Claude generation, diff review, application and unchanged surrounding content are checked during capture. The harness forwards messages to the real local native host. Chrome's installed Native Messaging registration is tested separately.
- **PDF:** the real extension runs in an isolated Chromium profile with a two-page synthetic PDF generated from `docs/video/demo-paper.html`. Text and image answers come from the real Claude CLI through the actual local HTTP companion. Import, selected text, actual image crops, reload persistence and copy are exercised. The source document labels its values as synthetic. Both listing languages use the same screenshots because the current PDF interface is Chinese, as disclosed in the listings.
- **Icons:** existing project-owned code-generated document symbols. The 128×128 icon has a 96×96 drawing with 16 px transparent padding. 16/48 px toolbar icons are retained.
- **Promotional art:** code-generated SVG/HTML diagrams showing a local agent connected to a document, using the project's own document symbols. They are illustrative promotional art, not screenshots of extra product features. Small tiles are 440×280; optional marquees are 1400×560. No external company logos or third-party stock images are used.

Reproduce from the repository root (live captures require the documented dependencies, Chrome/Chromium and a signed-in Claude CLI; they consume model usage):

```bash
node LLM_in_Overleaf/tools/capture-docs.cjs --store
node LLM_in_Overleaf/tools/capture-docs.cjs --store --lang=zh-CN
node docs/chrome-store/capture-pdf.mjs
node docs/chrome-store/make-promo.cjs
```

If PATH contains an obsolete CLI installation, set `LLM_IN_OVERLEAF_CLAUDE_BIN` to the correct Claude executable when capturing. This does not change the extension's bundled code. The capture harness uses synthetic source; the real Overleaf domain/account flow should still be checked with the submitted item before release.
