# 更新记录

## 0.7.6 — 2026-10-23

- **Windows install fixes ([#18](https://github.com/ZJU-OmniAI/LLM_in_Work/issues/18)).** On Chinese (and other non-UTF-8) Windows, `install.ps1` read `manifest.xml` with the system code page and failed with an XML parse error; it now reads it as UTF-8. Running the installer again no longer stops at the folder-permission step with a `SeSecurityPrivilege` error: it writes back only the access rules instead of the whole security descriptor. The background service also reads `runtime.json` as UTF-8, so user names and paths with Chinese characters work.

中文摘要：修复 Windows 安装问题（#18）：中文等非 UTF-8 系统上读取 `manifest.xml` 时按系统编码解码导致 XML 解析失败，现改为按 UTF-8 读取；再次运行安装脚本时不再在设置目录权限一步报 `SeSecurityPrivilege` 错误（只写回访问权限，不再写整份安全描述符）；后台服务也按 UTF-8 读取 `runtime.json`，用户名或路径含中文时可以正常启动。

## 0.7.5 — 2026-10-22

- **Text size.** Settings has **A− / A+** next to the language menu. Text in the pane scales from 80% to 160% in 10% steps and the choice is remembered. The header stays the same size so its buttons fit narrow panes.

中文摘要：设置里语言菜单旁新增「A− / A+」字号调节，面板文字可在 80%–160% 之间按 10% 调整，选择会记住；顶部标题栏保持原大小，窄面板里按钮不会被挤出去。

## 0.7.4 — 2026-10-16

- **Documents with Zotero, EndNote or other citation fields are no longer truncated.** Word's reviewed-text API returns each field's code together with its result, so every Zotero citation added about a thousand characters of JSON to what the pane read. A manuscript with 52,000 characters of text and 50 citations read as roughly 190,000 characters, went over the 110,000-character limit and was cut. The pane now drops field codes and keeps what the citation shows, such as *(12)*.
- **Applying a rewrite keeps citations.** The pane used to replace the whole passage. With citation fields inside, that path wrote the field code JSON into the document as visible text and the citations stopped being fields. Applying now locates each changed word with Word's search and changes only those words, so citations, comments and formatting in the rest of the passage stay as they are. With track changes on, only the changed words are marked. If a change cannot be located exactly, nothing is written in a passage with citations. Passages without fields fall back to the previous whole-passage replacement.
- A reply that changes, removes or moves a citation can't be applied; the card says so. When the targets contain citations, the prompt asks the model to keep them exactly.
- **A selection that includes tables is split instead of refused.** Body text and each table become separate targets in document order. Previously the pane said "Add tables separately". Tables are added whole; remove one from the target list to leave it alone.

中文摘要：带 Zotero、EndNote 等文献引用的文档不再被截断：Word 读文字的接口会把每条引用背后约一千字的域代码一起读出来，5.2 万字正文加 50 条引用会变成约 19 万字、超过 11 万字的上限。现在只保留引用显示的文字（如「(12)」）。应用改写时不再整段替换（那样会把域代码当成正文写进文档、引用也不再是域），而是用 Word 搜索找到每个改动的词、只改这些词，引用、批注和其余格式原样不动；开着修订时只标出改动的词；定位不准时，带引用的段落一个字都不写。模型改动、删除或挪动引用的回复不能一键应用，卡片上会说明；有引用时提示词要求模型原样保留。选区里带表格时不再报错，而是按文档顺序拆成正文和表格各自的目标（表格整张加入，不想改可以在目标列表里 ✕ 掉）。更新：在仓库目录运行 `npm run update`，然后在侧栏点 ⟳。

## 0.7.3 — 2026-10-15

- **Long passages get a precise preview.** The comparison now works sentence by sentence and then word by word (Chinese character by character), using the same method as LLM_in_Overleaf 0.9.2. Previously, once the changed part was longer than roughly 1,400 words or Chinese characters, the preview gave up and showed the whole passage as deleted and re-inserted. Long unchanged stretches are folded (click to show them), and the card title says how many places changed.
- The same finer comparison is used when writing back, so formatting is kept word by word in long passages too. A newly inserted paragraph follows the paragraph before it.
- **✕ Clear target** on the reply card (and a ✕ next to the target summary at the top) releases the target without applying, so you can select the next passage. The preview stays usable: its anchor is kept, hidden, until you apply it or start a new chat, and it still asks before overwriting text that was edited in the meantime.
- **🔁 Retry** on a card regenerates that card's own passage with its own instruction, even after you moved on to another target.
- **English paragraphs keep their formatting when applied.** Word's HTML export puts blank lines between paragraphs and wraps text at about 80 columns by turning a space into a line break, so even *The end.* comes out wrapped. The pane could not line that HTML up with the text and fell back to plain text, which drops bold, italic and other run formatting. Layout whitespace between blocks is now ignored and wrapped line breaks count as spaces. With HTML exported by real Word for a 10,562-character paragraph, the previous code fell back to plain text and the new code keeps the formatting. Chinese paragraphs, which Word does not wrap, were not affected.

中文摘要：长段落的预览不再整段标红标绿：先按句、再按词（中文逐字）比较，和 LLM_in_Overleaf 0.9.2 一样；很长的未改动部分折叠起来，卡片标题显示几处改动。写回时也按这个更细的比较保留格式，新插入的段落沿用前一段的格式。回复卡片新增「✕ 清除目标」（顶部目标摘要旁也有 ✕），不应用也能放开目标去选下一段；这张预览之后仍可应用（锚点隐藏保留到应用或开新会话），中途被改过的文字仍会先请你确认。卡片上的「🔁 重试」按这张卡片自己的目标和指令重新生成。修复英文段落应用时丢格式：Word 导出的 HTML 会在约 80 列处把空格折成换行、段与段之间还有空行，以前对不齐就退回纯文本写入（加粗、斜体会丢），现在能对齐、保留格式；中文段落不折行，原来就不受影响。更新：在仓库目录运行 `npm run update`，然后在侧栏点 ⟳。

## 0.7.2 — 2026-09-30

- A roomier pane, laid out like LLM_in_Overleaf. The top of the pane is now a single row: the mode (**Rewrite ▾**), a summary such as *2 targets · 401 chars*, and **＋ Add selection**. Model, reasoning effort, language, mode, track changes and the target list moved into a **Settings** card that floats over the conversation and closes when you click elsewhere or press Esc. With two targets in a typical pane, the conversation gets about three times as much height.
- **＋ Add selection** lights up while text is selected in Word.
- Find the Codex CLI that newer Codex and ChatGPT desktop apps ship in `Contents/Resources/codex-cli/bin`, so Codex works without a separate install.

中文摘要：界面改成和 LLM_in_Overleaf 一样的布局：顶部只留一行（「改写 ▾」、目标数和字数、「＋ 添加选中」），模型、思考强度、界面语言、模式、保留修订和目标列表都收进「设置」浮层卡片，点别处或按 Esc 收起；两个目标时对话区高度约为原来的三倍。Word 里选中文字时「＋ 添加选中」会高亮。能找到新版 Codex / ChatGPT 桌面应用自带的 Codex CLI。更新：在仓库目录运行 `npm run update`，然后在侧栏点 ⟳。

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
