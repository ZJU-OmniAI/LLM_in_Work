// UI translations for the panel and popup. Chinese source strings are the keys;
// English is looked up from EN. Document text, model replies and protocol markers are never translated.
// Same scheme as LLM_in_Word/taskpane/i18n.js. Loaded as a classic script (content script / popup).
(() => {
  'use strict';
  if (globalThis.LLMOverleafI18n) return;
  const EN = {
    // Models and reasoning effort
    '使用 Codex 配置': 'Codex configuration',
    'Sonnet · 自动版本': 'Sonnet · Auto version',
    'Opus · 自动版本': 'Opus · Auto version',
    'Haiku · 自动版本': 'Haiku · Auto version',
    '默认 · {0}': 'Default · {0}',
    '按 codex 配置': 'Codex configuration',
    '{0}（配置默认）': '{0} (configured default)',
    '{0}（已保存）': '{0} (saved)',
    '不额外思考': 'None',
    '最少': 'Minimal',
    '快速': 'Fast',
    '均衡': 'Balanced',
    '深入': 'Deep',
    '更深入': 'Deeper',
    '最高': 'Maximum',
    '最深入': 'Deepest',
    'CLI 配置默认': 'CLI default',

    // Quick instructions
    '润色': 'Polish',
    '润色这段学术表达，使其更清晰、更地道；保持原意、术语和引用不变': 'Polish this passage into clear, natural academic prose. Keep the meaning, terminology and citations unchanged.',
    '修语法': 'Fix grammar',
    '修正语法、拼写和标点错误，尽量少改动措辞': 'Fix grammar, spelling and punctuation with as few wording changes as possible.',
    '精简': 'Shorten',
    '在保留所有关键信息的前提下压缩这段文字，删掉冗余表达': 'Make this passage more concise. Remove redundancy but keep every key point.',
    '扩写': 'Expand',
    '把这段扩写得更充分：补足逻辑衔接和必要细节，风格与全文保持一致': 'Expand this passage with clearer transitions and the necessary detail, matching the style of the paper.',
    '公式规范': 'Tidy math',
    '检查并修正这段里的 LaTeX 公式与环境写法，规范符号、编号和排版': 'Check and fix the LaTeX math and environments in this passage: consistent notation, numbering and typesetting.',
    '译成英文': 'Translate to English',
    '把这段翻译成地道的学术英文 LaTeX，保留所有命令、标签和引用': 'Translate this passage into natural academic English LaTeX. Keep every command, label and citation.',

    // Bridge and storage
    '空响应': 'Empty response',
    '编辑器桥未响应（页面可能还没加载完，稍等或刷新）': 'The editor bridge did not respond. Wait for the page to finish loading, or refresh it.',
    '…（存档截断）': '… (truncated in archive)',
    'Overleaf 项目': 'Overleaf project',
    '> 导出自 LLM_in_Overleaf · {0}': '> Exported from LLM_in_Overleaf · {0}',
    '## 🙋 用户': '## 🙋 User',
    '## 🤖 助手{0}': '## 🤖 Assistant{0}',
    '（{0}）': ' ({0})',

    // Project zip and attachments
    '下载项目源码失败 HTTP {0}': 'Could not download the project source (HTTP {0})',
    '不是有效的 zip': 'Not a valid zip file',
    'zip 条目损坏': 'Corrupted zip entry',
    '不支持的 zip 压缩方式 {0}': 'Unsupported zip compression method {0}',
    '附件最多 {0} 个': 'Attach up to {0} files.',
    '单个图片/PDF 最大 {0}': 'Each image or PDF must be {0} or smaller.',
    '图片/PDF 合计超过 {0}': 'Images and PDFs exceed {0} in total.',
    '（截断）': ' (truncated)',
    '移除': 'Remove',
    '暂不支持 .{0} 文件': '.{0} files are not supported',
    '\n…（过长已截断）': '\n… (truncated due to length)',
    '读取 {0} 失败：{1}': 'Could not read {0}: {1}',
    '暂不支持 {0}（只收 {1}/pdf/图片）': 'Unsupported file: {0}. Accepted: {1}, PDF and images.',
    '读取失败': 'Could not read the file',
    '📦 正在打包下载项目源码…（首次稍慢，之后走缓存）': '📦 Downloading the project source… The first download can take a moment; later ones use the cache.',
    '拉取失败': 'Download failed',
    '项目里没有文件？': 'No files were found in this project.',
    '当前文件': 'Current file',
    '正在编辑的文件已自动作为全文上下文': 'The file you are editing is already included as full-file context',
    '不支持': 'Unsupported',
    '✓ 已添加': '✓ Added',
    '＋ 添加': '＋ Add',
    '读取中…': 'Reading…',
    '📦 重新打包下载中…': '📦 Downloading again…',
    '✓ 已复制': '✓ Copied',
    '✗ 失败': '✗ Failed',

    // Panel layout and status
    '返回': 'Back',
    '阅读': 'Read',
    '退出最大化阅读（Esc）': 'Exit reading view (Esc)',
    '最大化阅读：展开输出区域': 'Reading view: expand the output area',
    '当前：推挤页面（Overleaf 整体变窄，不遮挡）。点击切换为悬浮覆盖': 'Current: side by side (Overleaf narrows, nothing is covered). Click to switch to overlay.',
    '当前：悬浮覆盖（会盖住 PDF 侧）。点击切换为推挤页面': 'Current: overlay (covers the PDF side). Click to switch to side by side.',
    '正在检查 {0}…': 'Checking {0}…',
    '本机桥未安装': 'Native host is not installed',
    '无法连接扩展后台，刷新页面试试': 'Cannot reach the extension background. Try refreshing the page.',
    '编辑器已连接 · {0} 就绪': 'Editor connected · {0} ready',
    '未连接源码编辑器': 'Source editor not connected',
    '{0} 需要检查': '{0} needs attention',
    '请打开 .tex 文件，切换到 Code Editor（源码编辑）后重试。': 'Open a .tex file in Code Editor (source mode), then try again.',

    // Selections
    '选段校准失败，请重新加载扩展并刷新页面。': 'Could not realign the selections. Reload the extension and refresh the page.',
    '定位失败': 'Could not locate the selection',
    '{0} 段': '{0} selections',
    '第 {0} 行': 'line {0}',
    '第 {0}–{1} 行': 'lines {0}–{1}',
    '全文上下文': 'Full-file context',
    '未选择段落': 'No selection',
    '查看 {0} 段 · {1} 字符；可逐段移除': 'View {0} selections · {1} characters; remove any of them',
    '查看上下文与选段设置': 'View context and selection settings',
    '＋ 加入选段': '＋ Add selection',
    '✦ 改这段': '✦ Rewrite',
    '选中一段源码后点「添加选段」；可继续选择其他位置并累积添加。': 'Select source text, then choose Add selection. Keep selecting other passages to add more.',
    '支持逐段添加，也支持编辑器已有的多个不连续选区。': 'Add passages one at a time, or capture several non-contiguous editor selections at once.',
    ' · <b class="ole-warn">选段较多，建议分批</b>': ' · <b class="ole-warn">Large selection; consider splitting it</b>',
    ' · ♻️已缓存全文': ' · ♻️ full file cached',
    ' · 附全文上下文': ' · with full-file context',
    '🎯 {0} · {1} 段 · {2} 字符{3}{4}': '🎯 {0} · {1} selections · {2} characters{3}{4}',
    '{0}. {1} · {2} 字符': '{0}. {1} · {2} characters',
    '定位': 'Locate',
    '移除选段 {0}': 'Remove selection {0}',
    '♻️缓存续写': '♻️ Resumed session',

    // Welcome
    '让想法，表达得更好。': 'Say what you mean, better.',
    '专注论文，让助手处理措辞、语法与 LaTeX。': 'Focus on your paper; let the assistant polish wording, grammar and LaTeX.',
    '选中段落': 'Select a passage',
    '在 Code Editor 中选择源码，点击「✦ 改这段」或上方「添加选段」': 'Select source in Code Editor, then click ✦ Rewrite or Add selection above',
    '告诉我怎么改': 'Describe the change',
    '输入要求，或选择下方快捷指令': 'Type an instruction or pick a quick action below',
    '比较，再应用': 'Compare, then apply',
    '查看修改差异，确认后写回 · ⌘Z 可撤销': 'Review the diff before writing it back · undo with ⌘Z / Ctrl+Z',
    '也可以切换「问答」，一起梳理论文思路。': 'Switch to Ask to discuss your paper without editing it.',

    // Replacement card
    '选段 {0} · {1}': 'Selection {0} · {1}',
    '内容较大，请切到新文本查看': 'Too large to compare. View the new text instead.',
    '替换预览': 'Replacement preview',
    '替换预览 · {0} 段': 'Replacement preview · {0} selections',
    '对比': 'Diff',
    '新文本': 'New text',
    '应用全部选段': 'Apply all selections',
    '应用替换': 'Apply',
    '📋 复制': '📋 Copy',
    '🔁 重试': '🔁 Retry',
    '用同样的指令重新生成': 'Generate again with the same instruction',
    '目标已清除，请重新选中': 'The selection was cleared. Select the text again.',
    '选区已切换。这张预览属于之前的段落，请为当前选区重新生成。': 'The selection has changed. This preview belongs to an earlier selection; generate again for the current one.',
    '应用中…': 'Applying…',
    '⚠️ 当前打开的是 {0}，请切回 {1} 再应用': '⚠️ {0} is open. Switch back to {1} to apply.',
    '✅ 已应用（Cmd+Z 可撤销）· 该目标已完成移除，要改下一处请重新选中': '✅ Applied (undo with ⌘Z / Ctrl+Z). The selection is cleared; select the next passage to continue.',
    '应用失败': 'Could not apply the change',

    // Sending and streaming
    '发送失败：': 'Could not send: ',
    '⚠️ 改写模式需要先有目标：在 Code Editor 里选中一段 LaTeX，点「添加选段」或浮标「✦ 改这段」。<br>（只是想提问的话，切上面的「💬 问答」模式）': '⚠️ Rewrite needs a selection: select LaTeX in Code Editor, then click Add selection or the floating ✦ Rewrite button.<br>To ask a question instead, switch to Ask.',
    '拿不到上下文': 'Could not read the context',
    '思考中': 'Thinking',
    '💭 思考过程': '💭 Reasoning',
    ' · effort 高时要几分钟，可点停止': ' · High effort can take minutes; you can stop anytime',
    '（无输出）': '(No output)',
    '💡 这个会话有点长了。建议点右上角 <b>🆕</b> 开新会话：旧会话自动归档到 🕘，并<b>重新读取全文上下文</b>，回复会更快更准。': '💡 This chat is getting long. Start a <b>new chat</b> (＋ above): the current one is archived in History and the <b>full-file context is reloaded</b> for faster, more accurate replies.',
    '替换稿与当前选段不完整对应，暂时无法应用。请重试，让助手重新生成各段的替换稿。': 'The reply does not cover every selection, so it cannot be applied. Retry to generate a replacement for each selection.',
    '⚠️ **出错了**：\n\n{0}': '⚠️ **Error**:\n\n{0}',
    '\n\n_（已停止）_': '\n\n_(Stopped)_',
    '_（已停止）_': '_(Stopped)_',
    '\n\n连接中断，请检查本机桥后重试。': '\n\nConnection interrupted. Check the native host, then try again.',

    // Sessions and history
    '🆕 新会话已开启（旧会话在 🕘 里）。已重新读取 <b>{0}</b> 全文 ~{1}k 字符，已校准 {2} 个选段。': '🆕 New chat started; the previous one is in History. Reloaded <b>{0}</b> (~{1}k characters) and realigned {2} selections.',
    '🆕 新会话已开启（旧会话在 🕘 里）。原目标片段在文档里找不到了（内容已变化），请重新选中一段。': '🆕 New chat started; the previous one is in History. The earlier selection is no longer in the file (the text changed); select it again.',
    '🆕 新会话已开启（旧会话在 🕘 里）。当前文件 <b>{0}</b> ~{1}k 字符，下次提问会重新读取全文。': '🆕 New chat started; the previous one is in History. <b>{0}</b> (~{1}k characters) will be reread on your next request.',
    '🆕 新会话已开启（旧会话在 🕘 里）。': '🆕 New chat started; the previous one is in History.',
    '当前会话 · {0} 条消息': 'Current chat · {0} messages',
    '📋 复制整段': '📋 Copy chat',
    '还没有归档的会话。点 🆕 开新会话时，旧会话会自动归档到这里（每个项目最多留 10 段）。': 'No archived chats yet. Starting a new chat archives the current one here (up to 10 per project).',
    '{0} · {1} 条消息': '{0} · {1} messages',
    '（无预览）': '(No preview)',
    '打开': 'Open',
    '删除': 'Delete',
    '🕘 已切回历史会话（它的缓存会话一并恢复：能续写就续写，失效则自动重读全文）。改写前请确认目标条里的目标还是你想改的那段。': '🕘 Restored this chat and its CLI session (an expired session reloads the full file automatically). Check the current selection before rewriting.',
    '↩️ 已恢复上次会话（刷新过页面，目标需重新选中）。想从头来就点 🆕。': '↩️ Restored your last chat. Selections are cleared after a page refresh, so select text again. Click ＋ for a fresh chat.',

    // Capturing selections
    '读取选区…': 'Reading selection…',
    '读取选区失败，请重试。': 'Could not read the selection. Please retry.',
    '在源码编辑器中选中段落后，点击「添加选段」。': 'Select a passage in the source editor, then click Add selection.',
    '没有读取到选区。请在左侧 Code Editor 中选择一段或多段源码，再点此按钮；PDF 预览中的选区不能改写。': 'No selection found. Select one or more passages in Code Editor, then click this button. Text selected in the PDF preview cannot be rewritten.',
    '请在同一文件中添加选段；要切换文件，请先在设置里清空已有选段。': 'Add selections from the same file. To switch files, clear the current selections in Settings first.',
    '添加选段失败': 'Could not add the selection',
    '已添加 {0} 段。可继续选择其他位置并点击「添加选段」。': '{0} selections added. Select another passage and click Add selection to add more.',
    '＋ 添加选段': '＋ Add selection',

    // Model list
    '后台无响应': 'No response from the extension background',
    '{0} 个': '{0} models',
    '、': ', ',
    '两个后端都没探测到模型（CLI 没装好或网络不通？）': 'No models found. Check the CLI installation and network.',
    '🔄 模型列表已更新（{0}）。当前选用：{1}': '🔄 Model list updated ({0}). Selected: {1}',
    '⚠️ 获取模型列表失败：': '⚠️ Could not refresh models: ',

    // Modes
    '改写 ▾': 'Rewrite ▾',
    '问答 ▾': 'Ask ▾',
    '输入改写要求…': 'Describe how to rewrite the selection…',
    '针对选区或全文提问…': 'Ask about the selection or the whole file…',

    // Static template
    '打开写作助手（⌘⇧E / Ctrl⇧E）': 'Open the writing assistant (⌘⇧E / Ctrl⇧E)',
    '写作助手': 'Writing assistant',
    '论文写作助手': 'Paper writing assistant',
    '检查连接中': 'Checking connection',
    '模型、模式与选区设置': 'Model, mode and selection settings',
    '设置': 'Settings',
    '停止生成': 'Stop generating',
    '停止': 'Stop',
    '开新会话（旧会话自动归档，并重新读取全文上下文）': 'New chat (archives the current chat and reloads the full-file context)',
    '会话历史': 'Chat history',
    '收起（⌘⇧E）': 'Close (⌘⇧E)',
    '写作设置': 'Writing settings',
    '界面语言': 'Interface language',
    '切换面板布局：推挤页面 / 悬浮覆盖': 'Panel layout: side by side / overlay',
    '检查中…': 'Checking…',
    '后端': 'Backend',
    '模型': 'Model',
    '思考强度 effort': 'Reasoning effort',
    '获取当前后端的最新模型列表': 'Refresh the model list for this backend',
    '改写段落': 'Rewrite',
    '论文问答': 'Ask',
    '在编辑器里定位': 'Locate in the editor',
    '清空所有选段': 'Clear all selections',
    '切换改写或问答模式': 'Switch between Rewrite and Ask',
    '查看上下文与选区设置': 'View context and selection settings',
    '支持拖选、双击或 Shift + 方向键选择源码。': 'Select source by dragging, double-clicking or using Shift + arrow keys.',
    '对话与输出': 'Conversation and output',
    '把项目里的其他文件（章节/main.tex/.bib/图表）加进上下文': 'Add other project files (chapters, main.tex, .bib, figures) as context',
    '📁 项目文件': '📁 Project files',
    '附加本地 PDF / 图片 / 文本文件': 'Attach local PDF, image or text files',
    '📎 本地文件': '📎 Local files',
    '输入改写要求或问题': 'Instruction or question',
    '发送': 'Send',
    'Enter 发送': 'Enter to send',
    'Shift + Enter 换行 · Esc 收起': 'Shift + Enter for a new line · Esc to close',
    '🕘 本项目的会话历史': '🕘 Chat history for this project',
    '📁 项目文件（加进上下文）': '📁 Project files (add as context)',
    '重新下载项目源码': 'Download the project source again',

    // Popup
    '你的论文写作助手': 'Your paper writing assistant',
    '打开写作助手': 'Open writing assistant',
    '在 Overleaf 项目中打开，有选区时会自动读取。': 'Opens in the current Overleaf project and picks up any selection.',
    '检查本机桥…': 'Checking the native host…',
    '助手': 'Backend',
    '思考': 'Effort',
    '重新检查连接': 'Check connection again',
    '语言': 'Language',
    '正在打开助手…': 'Opening the assistant…',
    '助手已打开。可以在页面中继续操作。': 'The assistant is open. Continue in the page.',
    '页面没有响应，请刷新 Overleaf 后重试。': 'The page did not respond. Refresh Overleaf and try again.',
    '无法连接扩展后台，请在扩展管理页重新加载，再刷新 Overleaf。': 'Cannot reach the extension background. Reload the extension on chrome://extensions, then refresh Overleaf.',
    '正在检查连接…': 'Checking the connection…',
    '{0} 已就绪 · 桥 v{1}': '{0} ready · native host v{1}',
    '连接失败，请重试': 'Connection failed. Please retry.',
    '无法连接扩展后台，请重新加载扩展。': 'Cannot reach the extension background. Reload the extension.',
    '本机桥未安装/未就绪。在下载的 LLM_in_Work 仓库目录执行：': 'The native host is not installed or not ready. In your LLM_in_Work checkout, run:',
    '快速上手': 'Quick start',
    '在 Overleaf 项目的 Code Editor 中选中一段 LaTeX，点「✦ 改这段」开始。没有浮标？点上方「打开写作助手」，再点面板里的「添加选段」。可依次添加同一文件中的多个不连续段落。快捷键 ⌘⇧E（Windows / Linux：Ctrl⇧E）。': 'In an Overleaf project, select LaTeX in Code Editor and click ✦ Rewrite. No floating button? Choose Open writing assistant above, then Add selection in the panel. You can add several passages from the same file. Shortcut: ⌘⇧E (Windows / Linux: Ctrl+Shift+E).',

    // Native host, CLI and health messages (arrive already formatted)
    '缺少 messages': 'Missing messages',
    '附件落盘失败：{0}': 'Could not save attachments: {0}',
    '会话已失效，正在重新读取全文并重建…': 'The session expired; rereading the full file and starting a new session…',
    '模型已启动，正在生成': 'Model started; generating',
    '模型正在重新连接': 'Reconnecting to the model',
    '正在连接模型': 'Connecting to the model',
    '正在生成': 'Generating',
    'Claude 返回错误': 'Claude returned an error',
    'Codex 返回错误': 'Codex returned an error',
    '请求超时：模型超过时限仍未完成，请降低思考强度或缩小选段范围。': 'Request timed out. Lower the reasoning effort or select a smaller passage.',
    '{0} 启动失败：{1}': '{0} could not start: {1}',
    '{0} 退出码 {1}\n{2}': '{0} exited with code {1}\n{2}',
    '{0} 没有返回可用内容，请重试。': '{0} returned no usable content. Please retry.',
    '模型没有返回可用内容': 'The model returned no usable content.',
    '可重试，或在设置中检查后端连接状态。': 'Retry, or check the backend connection in Settings.',
    '未找到 CLI。安装后重新运行安装脚本，或设置 LLM_IN_OVERLEAF_CLAUDE_BIN / LLM_IN_OVERLEAF_CODEX_BIN。': 'CLI not found. Install it and rerun the installer, or set LLM_IN_OVERLEAF_CLAUDE_BIN / LLM_IN_OVERLEAF_CODEX_BIN.',
    '会话记录已失效，可以开新会话重新读取全文。': 'This session expired. Start a new chat to reload the full file.',
    '请在终端运行 claude auth login 或 codex login 完成登录后重试。': 'Run claude auth login or codex login in a terminal, then retry.',
    '当前账户额度或请求频率受限，请稍后重试，或切换后端。': 'The account reached a usage or rate limit. Try again later or switch backends.',
    '请刷新模型列表，选择默认模型或较低思考强度后重试。': 'Refresh the model list, choose the default model or a lower reasoning effort, and retry.',
    '请检查网络和代理；代理端口变化后重新运行安装脚本。': 'Check your network and proxy. Rerun the installer after changing proxy settings.',
    '找不到 {0} CLI。请安装 {1}，或设置 LLM_IN_OVERLEAF_{2}_BIN 后重新运行安装脚本。': '{0} CLI not found. Install {1}, or set LLM_IN_OVERLEAF_{2}_BIN and rerun the installer.',
    '{0} CLI 无法启动或响应超时，请在终端运行 {1} --version 检查。': '{0} CLI failed to start or timed out. Run {1} --version in a terminal to check it.',
    '{0} 尚未登录，请在终端运行 {1} 后重试。': '{0} is not signed in. Run {1} in a terminal, then retry.',
    '未找到 CLI': 'CLI not found',
    'CLI 启动异常': 'CLI startup error',
    '需要登录': 'Sign-in required',
    '已登录': 'Signed in',
    '登录状态待确认': 'Sign-in status unknown',
    'Claude CLI 暂未提供具体版本；别名由 CLI 解析，回复会显示实际模型。': 'Claude CLI did not report exact versions. Aliases are resolved by the CLI; replies show the actual model.',
    'Codex 模型列表暂时不可用，保留上次列表；请检查 Codex CLI 是否安装并已登录。': 'The Codex model list is unavailable; keeping the previous list. Check that Codex CLI is installed and signed in.',
    '本机桥未就绪（{0}）': 'Native host not ready ({0})',
  };

  const SUPPORTED = ['en', 'zh-CN'];
  const normalize = (value) => (/^zh(?:[-_]|$)/i.test(String(value || '')) ? 'zh-CN' : 'en');
  let language = normalize(globalThis.navigator?.language);

  // t('中文 {0}', value) 或 t`中文 ${value}`（标签模板会自动转成 {n} 占位）。
  function t(key, ...values) {
    if (Array.isArray(key)) key = key.map((part, i) => part + (i < values.length ? `{${i}}` : '')).join('');
    const text = language === 'en' ? (EN[key] ?? key) : key;
    return String(text ?? '').replace(/\{(\d+)\}/g, (match, i) => (i < values.length ? String(values[i]) : match));
  }

  // 本机桥发来的消息已经插好值：按整条目录项匹配后翻译；绝不对文档或模型输出使用。
  const patterns = Object.entries(EN).flatMap(([zh, en]) => [
    { source: zh, target: en, language: 'en' }, { source: en, target: zh, language: 'zh-CN' },
  ]).map((entry) => {
    const slots = [];
    const pieces = entry.source.split(/(\{\d+\})/g).map((part) => {
      if (/^\{\d+\}$/.test(part)) { slots.push(Number(part.slice(1, -1))); return '([\\s\\S]*?)'; }
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    });
    const literal = entry.source.replace(/\{\d+\}/g, '').length;
    return { ...entry, slots, literal, re: new RegExp('^' + pieces.join('') + '$') };
  }).sort((a, b) => b.literal - a.literal || a.slots.length - b.slots.length); // 更具体（固定文字更多）的条目优先
  function known(value, depth = 0) {
    if (typeof value !== 'string' || !value || depth > 3) return value;
    for (const p of patterns) {
      if (p.language !== language) continue;
      const match = value.match(p.re);
      if (!match) continue;
      const values = {};
      p.slots.forEach((slot, i) => { values[slot] = known(match[i + 1], depth + 1); });
      return p.target.replace(/\{(\d+)\}/g, (m, i) => values[i] ?? m);
    }
    return value;
  }

  function setLanguage(value) {
    language = SUPPORTED.includes(value) ? value : normalize(value);
    return language;
  }

  // data-i18n / data-i18n-title / data-i18n-aria-label / data-i18n-placeholder
  function applyStatic(root) {
    for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
    for (const attr of ['title', 'aria-label', 'placeholder']) {
      for (const el of root.querySelectorAll(`[data-i18n-${attr}]`)) el.setAttribute(attr, t(el.getAttribute(`data-i18n-${attr}`)));
    }
  }

  globalThis.LLMOverleafI18n = {
    t, known, setLanguage, normalize, applyStatic,
    get language() { return language; },
    STORAGE_KEY: 'uiLanguage',
    catalog: EN,
  };
})();
