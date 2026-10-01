// 把"演示文稿上下文 + 历史对话 + 本轮指令"拼成一段完整 prompt。
// claude -p / codex exec 都是一问一答、不记忆，所以首轮把全部上下文带上，续轮只发变化的部分。
// 三种模式：
//   edit  ：改写选中的幻灯片文字，要求模型把替换文本放进 ```text 围栏（前端解析后做 diff/应用）
//   format：调整当前页的格式和版面，模型看截图和格式清单，把修改方案放进 ```format 围栏（JSON，前端校验后写入）
//   ask   ：针对选中内容或整份演示文稿答疑，普通 Markdown 回答
// 与 LLM_in_Word 的区别：幻灯片文字按"页 → 文本框 → 段落"组织，一行就是一个要点；
// 项目符号属于段落格式，不是文字，所以必须禁止模型在围栏里写 "- " "•" 之类的记号。

import { MAX_FULLTEXT_CHARS } from './config.js';

const SLIDE_TEXT_RULES = `【幻灯片文字的特点】幻灯片空间有限、讲究一眼看懂：标题短而有力；要点一行一条、简洁并列。除非用户要求，不要把要点写成长段落，也不要明显加长文字（写回后可能溢出文本框）。`;

const EDIT_SYSTEM = `你是嵌入 Microsoft PowerPoint 的演示文稿写作助手。下面会给你整份演示文稿的文字（按页列出；每个文本框前用方括号注明类型，如 [标题] [正文] [文本框] [表格]），其中用【选中段开始】【选中段结束】标出了用户选中的一段文字，你要按用户指令给出"替换这段选中内容"的新文本。

【怎么用全文】给你整份演示文稿是为了让你把握上下文：演讲主线、前后页的逻辑、术语和数据口径……改写都要与全篇保持一致。但全文只是背景，你要改的只有选中那一段。

${SLIDE_TEXT_RULES}

【输出格式，必须严格遵守】
1. 把替换后的文本放在一个 \`\`\`text 围栏代码块里；整个回复只允许出现这一个代码块。
2. 代码块里的内容会被"按字面原样"写进幻灯片，所以：
   - 必须是纯文本：不要用任何 Markdown 记号（# 标题、**加粗**、- 或 • 等列表符号、> 引用都不行）——项目符号是 PowerPoint 的段落格式，不属于文字本身，写了会重复出现；
   - 只写替换选中段的内容本身：不要重复选区外的文字，不要把其他文本框或其他页的内容抄进来；
   - 一行就是文本框里的一个段落（一个要点）；没必要就不要改变原有的段落数和顺序；
   - 专有名词、数据、引文照原样保留，除非用户明确要求改；
   - 没必要改动的词句请逐字保留原样：系统会把新旧文本逐字对比，只改动变化的地方，原有的加粗、颜色、字号留在没变的文字上——改动越少，格式保留越完整。
3. 代码块外可以加一两句简短说明改了什么（可选，别长篇大论；用什么语言见下方【回复语言】）。
4. 如果指令无法执行（比如和选中内容无关），就不要输出代码块，直接说明原因。`;

const EDIT_SYSTEM_MULTI = (n) => `你是嵌入 Microsoft PowerPoint 的演示文稿写作助手。下面会给你整份演示文稿的文字（按页列出；每个文本框前用方括号注明类型，如 [标题] [正文] [文本框] [表格]），其中用【目标1开始】【目标1结束】…【目标${n}开始】【目标${n}结束】标出了用户选中的 ${n} 处文字，你要按用户指令分别给出每处的替换文本。

【怎么用全文】给你整份演示文稿是为了让你把握上下文：演讲主线、前后页的逻辑、术语和数据口径……改写都要与全篇保持一致，并注意各目标之间的呼应（用户常常就是要把分散在几页、几个文本框里的文字改得一致）。但你要改的只有标出的目标。

${SLIDE_TEXT_RULES}

【输出格式，必须严格遵守】
1. 对每个需要修改的目标：先单独一行写【目标k】（k 是编号），紧接着放一个 \`\`\`text 围栏，里面是该目标的替换文本；一个目标最多一个围栏，标签和围栏必须紧挨着。
2. 确实无需改动的目标可以不给围栏，但要在围栏外用一句话说明哪些目标没改、为什么。
3. 每个围栏里的内容会被"按字面原样"整体替换对应目标，所以：
   - 必须是纯文本：不要用任何 Markdown 记号（# 标题、**加粗**、- 或 • 等列表符号都不行）——项目符号是段落格式，写了会重复出现；
   - 只写该目标的替换内容本身：不要重复目标外的文字，不要把别的目标的内容写进来；
   - 一行就是文本框里的一个段落（一个要点）；没必要就不要改变原有的段落数和顺序；
   - 专有名词、数据、引文照原样保留，除非用户明确要求改；
   - 没必要改动的词句请逐字保留原样：系统逐字对比、只改变化的地方，改动越少格式保留越完整。
4. 如果指令无法执行，就不要输出围栏，直接说明原因（语言见【回复语言】）。`;

// 表格协议（edit 模式统一附加）：表格目标用 ```table 围栏放 Markdown 表格
const TABLE_RULES = `
【表格目标】标注为"表格"的目标，其当前内容以 Markdown 表格给出（第一行为表头行，第二行是 |---| 分隔线）。要修改它时：
- 输出一个 \`\`\`table 围栏（多目标时同样前置【目标k】标签），里面放**完整的改后 Markdown 表格**；
- 单元格内不要换行；竖线字符写成 \\|；可以增删行，但**列数必须保持不变**；
- 只改需要改的单元格，其余单元格逐字保留原样（系统按单元格写回，改得越少格式保留越好）。`;

const ASK_SYSTEM = `你是嵌入 Microsoft PowerPoint 的演示文稿助手，帮用户理解和改进他们的幻灯片。请遵守：
- 只依据提供的演示文稿内容和你已有的知识回答；演示文稿里没有的信息就说"文中未提及"，不要编造。
- 提到具体内容时注明页码（如"第 3 页"），方便用户在幻灯片里找到。
- 用 Markdown 组织，简明清晰。`;

const FORMAT_SYSTEM = `你是嵌入 Microsoft PowerPoint 的版式助手，负责调整幻灯片的格式和版面：位置、大小、填充、边框、字体、对齐、层次、表格样式和背景色。文字内容不在这里改。
下面会给你当前这一页的截图（slide-N.png）和这页上每个形状的格式清单：每行一个形状的 JSON，单位是磅（pt），颜色是 #RRGGBB；"mixed" 表示这段文字里有多种取值，"none" 表示没有填充或没有边框。

【可以修改的属性】只写需要改的属性；颜色一律写 #RRGGBB。
- 形状：x、y、w、h（位置和大小）；rotation（角度）；fill（"#RRGGBB"、{"color": "#RRGGBB", "transparency": 0.3} 或 "none"）；
  line（形状和图片的边框/轮廓：{"color": "#RRGGBB", "weight": 1, "dash": "solid|dash|dot", "transparency": 0}，或 "none" 去掉边框）；
  font（作用于这个形状里的全部文字：{"name": "字体名", "size": 18, "color": "#RRGGBB", "bold": true, "italic": false, "underline": false}）；
  align（left / center / right / justify）；valign（top / middle / bottom）；zOrder（front / back / forward / backward）。
- 表格（kind 为 table）：在同一条修改里用 cells 指定范围（"all"、"header"、"body"、"first-col"、"last-row"，或 "r2c1:r4c3" 这样的行列区域，从 1 开始数），
  再写 fill（单元格底色）、font、align、valign，或 border（{"sides": "all|outer|inner|top|bottom|left|right|horizontal|vertical", "color": …, "weight": …, "dash": …}）。表格的 x、y、w、h 也可以改。
- 背景：{"id": "background", "fill": "#RRGGBB"}（清单里写明可以改时才行）。

【输出格式，必须严格遵守】
1. 先用一两句话说明打算怎么改、为什么。
2. 然后输出一个 \`\`\`format 围栏，里面是 JSON：{"changes": [{"id": "形状 id", …要改的属性…}, …]}。只能用「可以修改的形状」里的 id；同一个形状可以有多条（比如表格的不同区域）。
3. 只改和用户要求相关的属性，不要顺手改别的。
4. 文字内容在这里改不了；用户要改措辞时，说明需要切换到「改写」模式，不要输出围栏。做不到的（动画、裁剪图片、渐变、阴影、插入新形状、改母版……）也直接说明原因和手动做法，不要输出围栏。

【版式原则】
- 「浅一些」通常是把颜色往白色方向调（比如黑色 #000000 → 深灰 #7F7F7F 或浅灰 #BFBFBF），线条可以同时变细；「醒目」是加深颜色、加大字号或加粗。
- 颜色优先用主题色或页面上已有的颜色，保持整页协调。
- 对齐和间距成组考虑：同类元素对齐到同一条线、间距一致；形状不要超出幻灯片。
- 字号保持层级：标题大于小标题大于正文，正文一般不小于 12 pt。`;

// 回复语言：说明文字跟随用户本轮指令的语言；判断不了时跟随面板界面语言。
// 替换内容本身保持原文语言（除非用户要求翻译），避免英文界面收到中文说明、或幻灯片被顺手翻译。
export function languageRule(mode, uiLanguage) {
  const fallback = uiLanguage === 'en' ? '英文（English）' : '中文';
  if (mode === 'format') return `【回复语言】说明文字使用用户本轮要求所用的语言；难以判断时使用${fallback}。JSON 里的键和取值按上面的规定写。`;
  return mode === 'edit'
    ? `【回复语言】代码块外的说明、以及无法执行时的解释，使用用户本轮指令所用的语言；难以判断时使用${fallback}。替换内容本身保持原文的语言，除非用户明确要求翻译。`
    : `【回复语言】使用用户本轮提问所用的语言回答；难以判断时使用${fallback}。`;
}

// 英文界面时在结尾再用英文提醒一次回复语言：中文的系统提示词容易把小模型带偏成先写几句中文。
export function closingLanguageHint(mode, uiLanguage) {
  if (uiLanguage !== 'en') return '';
  if (mode === 'format') return 'Write the explanation in the language of the request above (English if unsure); keep the JSON keys and values exactly as specified.';
  return mode === 'edit'
    ? 'Write any explanation outside the code fences in the language of the instruction above (English if unsure). Keep the replacement text in the slide\'s original language unless asked to translate.'
    : 'Answer entirely in the language of the question above (English if unsure), including headings and labels.';
}

// 二进制附件（图片/PDF，已写到本地磁盘）的说明段，首轮/续轮共用
function pushBinFilesSection(parts, files, backend) {
  if (!Array.isArray(files) || !files.length) return;
  parts.push('\n==== 用户附加的图片/PDF 附件 ====');
  for (const f of files) {
    const isImg = /^image\//.test(f.mime || '');
    if (backend === 'codex' && isImg) {
      parts.push(`- 图片「${f.name}」已随本条消息直接附上，你能直接看到，无需读文件。`);
    } else {
      parts.push(`- ${isImg ? '图片' : 'PDF/文件'}「${f.name}」已存到本地：${f.path}`);
    }
  }
  if (backend === 'claude') {
    parts.push('请用 Read 工具打开上述路径查看附件内容（图片和 PDF 都能直接读）。读取时不要输出“我先看一下”之类的过程说明，直接给出最终回复。');
  } else if (files.some((f) => !/^image\//.test(f.mime || ''))) {
    parts.push('对于给出路径的附件，请尽量用你可用的方式读取；读不了就说明该附件未能读取，不要编造内容。');
  }
  if (files.some((f) => /^slide-\d+\.png$/i.test(f.name || ''))) {
    parts.push('名为 slide-N.png 的图片是面板截取的第 N 页渲染图，可据此判断版式、字号和文字是否放得下。');
  }
  parts.push('==== 附件列表结束 ====');
}

const tableDims = (t) => `${t.rows || '?'}×${t.cols || '?'}`;
const where = (t) => (t.where ? `，${t.where}` : '');

// 续轮的短 prompt：CLI 会话里已有系统规则、全文和此前对话（走服务端缓存），
// 本轮只发：最新的目标（权威版本）+ 新增附件 + 指令 + 输出格式提醒。
export function buildTurnPrompt({ mode, backend = 'claude', uiLanguage = 'zh-CN', doc = {}, instruction = '', files = [] }) {
  if (mode === 'format') return buildFormatPrompt({ backend, uiLanguage, doc, messages: [{ role: 'user', content: instruction }], files });
  const isEdit = mode === 'edit';
  const targets = Array.isArray(doc.targets) ? doc.targets : [];
  const parts = [];
  const turnLabel = (t) => (t.kind === 'table' ? `目标${t.k}（表格 ${tableDims(t)}${where(t)}，输出用 \`\`\`table）` : `目标${t.k}${t.where ? `（${t.where}）` : ''}`);
  if (targets.length === 1) {
    const t0 = targets[0];
    parts.push(t0.kind === 'table'
      ? `本轮用户选中的是一张表格（${tableDims(t0)}${where(t0)}，Markdown 表示）。幻灯片可能已被编辑过，以下面为准${isEdit ? '；修改请用 \`\`\`table 围栏输出完整改后表格，只改需要改的单元格' : ''}：`
      : `本轮用户在 PowerPoint 里选中的文字如下${t0.where ? `（${t0.where}）` : ''}。注意：幻灯片可能已被编辑过，与你记忆中的版本不同时，以下面这段为准${isEdit ? '；你的输出将整体替换这一段' : ''}：`);
    parts.push('==== 选中内容开始 ====');
    parts.push(t0.text);
    parts.push('==== 选中内容结束 ====');
  } else if (targets.length > 1) {
    parts.push(`本轮用户选中了 ${targets.length} 处目标。注意：幻灯片可能已被编辑过，一律以下面为准${isEdit ? '；请按编号分别给出替换内容（表格目标用 \`\`\`table）' : ''}：`);
    for (const t of targets) {
      parts.push(`---- ${turnLabel(t)} ----`);
      parts.push(t.text);
    }
    parts.push('==== 选中内容结束 ====');
  }
  if (Array.isArray(doc.extraFiles) && doc.extraFiles.length) {
    for (const f of doc.extraFiles) {
      if (!f || typeof f.text !== 'string') continue;
      parts.push(`\n==== 用户新附加的参考文件：${f.name}${f.truncated ? '（过长已截断）' : ''} ====`);
      parts.push(f.text);
      parts.push(`==== ${f.name} 结束 ====`);
    }
  }
  pushBinFilesSection(parts, files, backend);
  parts.push(`\n用户本轮的指令：\n${instruction}`);
  const hasTable = targets.some((t) => t.kind === 'table');
  parts.push(isEdit
    ? (targets.length > 1
      ? `\n仍按最初约定输出：每个要改的目标前单独一行【目标k】+ 紧跟围栏——文本目标用 \`\`\`text 放纯文本（禁 Markdown 记号和项目符号；一行一个段落；没必要改的词句逐字保留以利格式保留）${hasTable ? '，表格目标用 \`\`\`table 放完整改后 Markdown 表格（列数不变，只改需要改的单元格）' : ''}；不改的目标围栏外说明。`
      : (targets[0] && targets[0].kind === 'table'
        ? '\n仍按最初约定输出：唯一一个 ```table 围栏放完整的改后 Markdown 表格（列数不变，只改需要改的单元格，其余逐字保留；单元格内不换行），围栏外最多一两句说明；无法执行就不出围栏、直接说明原因。'
        : '\n仍按最初约定输出：唯一一个 ```text 围栏放纯文本替换内容（禁 Markdown 记号和项目符号；一行一个段落；只写替换段本身；没必要改的词句逐字保留以利格式保留），围栏外最多一两句说明；无法执行就不出围栏、直接说明原因。'))
    : '\n请直接用 Markdown 回答。');
  parts.push(languageRule(isEdit ? 'edit' : 'ask', uiLanguage));
  const hint = closingLanguageHint(isEdit ? 'edit' : 'ask', uiLanguage);
  if (hint) parts.push(hint);
  return parts.join('\n');
}

function pushDocInfo(parts, doc) {
  const info = [];
  if (doc.docTitle) info.push(`演示文稿：${doc.docTitle}`);
  if (doc.slideCount) info.push(`共 ${doc.slideCount} 页`);
  if (doc.docChars) info.push(`文字约 ${doc.docChars} 字符`);
  if (info.length) parts.push(info.join(' · '));
}

// messages: [{ role: 'user'|'assistant', content }]，最后一条是本轮指令
// doc: { docTitle, slideCount, docChars, targets: [{k, text, kind, rows, cols, where}], fullText, truncated }
//   fullText 由前端拼好：按页列出各文本框，单目标用【选中段开始/结束】、多目标用【目标k开始/结束】标出，超长已截取
// files: [{name, path, mime}]  ← 已落盘的二进制附件（图片/PDF），backend 决定提示读法
// 版式模式：系统规则 + 当前页格式清单 + 截图说明 + 此前对话 + 本轮要求
function buildFormatPrompt({ backend, uiLanguage, doc, messages, files }) {
  const parts = [FORMAT_SYSTEM, languageRule('format', uiLanguage), ''];
  pushDocInfo(parts, doc);
  parts.push('\n==== 当前页的格式清单 ====');
  parts.push(String(doc.format || '（没有读到形状）'));
  parts.push('==== 清单结束 ====');
  pushBinFilesSection(parts, files, backend);
  const history = messages.slice(0, -1);
  const current = messages[messages.length - 1];
  if (history.length) {
    parts.push('\n==== 此前的对话（页面可能已按之前的方案改过，一律以上面的清单和截图为准）====');
    for (const m of history) {
      const c = m.content.length > 4000 ? m.content.slice(0, 4000) + '…（截断）' : m.content;
      parts.push(`${m.role === 'assistant' ? '助手' : '用户'}：${c}`);
    }
    parts.push('==== 对话历史结束 ====');
  }
  parts.push(`\n用户本轮的要求：\n${current ? current.content : ''}`);
  parts.push('\n请按上面的输出格式给出方案：先一两句说明，再一个 ```format 围栏。');
  const hint = closingLanguageHint('format', uiLanguage);
  if (hint) parts.push(hint);
  return parts.join('\n');
}

export function buildPrompt({ mode, backend = 'claude', uiLanguage = 'zh-CN', doc = {}, messages = [], files = [] }) {
  if (mode === 'format') return buildFormatPrompt({ backend, uiLanguage, doc, messages, files });
  const isEdit = mode === 'edit';
  const targets = Array.isArray(doc.targets) ? doc.targets : [];
  const parts = [];
  parts.push(isEdit ? (targets.length > 1 ? EDIT_SYSTEM_MULTI(targets.length) : EDIT_SYSTEM) : ASK_SYSTEM);
  if (isEdit) parts.push(TABLE_RULES);
  parts.push(languageRule(isEdit ? 'edit' : 'ask', uiLanguage));
  parts.push('');
  pushDocInfo(parts, doc);

  if (doc.fullText) {
    let t = doc.fullText;
    let truncated = doc.truncated;
    if (t.length > MAX_FULLTEXT_CHARS) {
      t = t.slice(0, MAX_FULLTEXT_CHARS) + '\n…（过长已截断）';
      truncated = true;
    }
    parts.push(`\n==== 当前演示文稿的全部文字（按页列出，不含演讲者备注${truncated ? '；过长，已截取目标所在页及周边' : ''}）====`);
    parts.push(t);
    parts.push('==== 全文结束 ====');
  }

  const tgtLabel = (t) => (t.kind === 'table'
    ? `目标${t.k}（表格 ${tableDims(t)}${where(t)}，Markdown 表示，输出用 \`\`\`table）`
    : `目标${t.k}${t.where ? `（${t.where}）` : ''}`);
  if (targets.length === 1) {
    const t0 = targets[0];
    parts.push(isEdit
      ? (t0.kind === 'table'
        ? `\n==== 用户选中的表格（${tableDims(t0)}${where(t0)}，Markdown 表示；修改请用 \`\`\`table 围栏输出完整改后表格）====`
        : `\n==== 用户选中的文字（${t0.where ? `${t0.where}；` : ''}全文中已标出位置；你的输出将整体替换这一段）====`)
      : `\n==== 用户选中的内容（${t0.where ? `${t0.where}；` : ''}提问针对这一段）====`);
    parts.push(t0.text);
    parts.push('==== 选中内容结束 ====');
  } else if (targets.length > 1) {
    parts.push(isEdit
      ? `\n==== 用户选中的 ${targets.length} 处目标（全文中已标出位置；请按编号分别给出替换内容）====`
      : `\n==== 用户选中的 ${targets.length} 处内容（提问针对这几处）====`);
    for (const t of targets) {
      parts.push(`---- ${tgtLabel(t)} ----`);
      parts.push(t.text);
    }
    parts.push('==== 选中内容结束 ====');
  }

  // 用户附加的文本文件（本地 txt/md/csv 参考材料）
  if (Array.isArray(doc.extraFiles) && doc.extraFiles.length) {
    for (const f of doc.extraFiles) {
      if (!f || typeof f.text !== 'string') continue;
      parts.push(`\n==== 用户附加的参考文件：${f.name}${f.truncated ? '（过长已截断）' : ''} ====`);
      parts.push(f.text);
      parts.push(`==== ${f.name} 结束 ====`);
    }
  }

  pushBinFilesSection(parts, files, backend);

  const history = messages.slice(0, -1);
  const current = messages[messages.length - 1];

  if (history.length) {
    parts.push('\n==== 此前的对话（同一批目标的上几轮）====');
    for (const m of history) {
      const c = m.content.length > 4000 ? m.content.slice(0, 4000) + '…（截断）' : m.content;
      parts.push(`${m.role === 'assistant' ? '助手' : '用户'}：${c}`);
    }
    parts.push('==== 对话历史结束 ====');
  }

  parts.push(`\n用户本轮的指令：\n${current ? current.content : ''}`);
  parts.push(isEdit
    ? (targets.length > 1
      ? '\n请按上面的输出格式，对各目标分别给出替换文本（每处前一行写【目标k】）：'
      : '\n请按上面的输出格式要求，给出替换选中内容的纯文本：')
    : '\n请回答：');
  const hint = closingLanguageHint(isEdit ? 'edit' : 'ask', uiLanguage);
  if (hint) parts.push(hint);
  return parts.join('\n');
}
