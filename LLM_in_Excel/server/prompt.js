// 把"工作簿上下文 + 历史对话 + 本轮指令"拼成一段完整 prompt。
// claude -p / codex exec 都是一问一答、不记忆，所以首轮把全部上下文带上，续轮只发变化的部分。
// 两种模式：
//   edit：改写选中的单元格区域，要求模型用带坐标的 ```table 围栏给出新内容（前端解析后按单元格写回）
//   ask ：针对选中区域或整个工作簿答疑，普通 Markdown 回答
// 与 LLM_in_Word / LLM_in_PowerPoint 的区别：内容是单元格网格。每张表都用带坐标的 Markdown 表格表示
// （第一行是列字母、每行第一格是行号），模型回复同样带坐标，所以可以只给出需要改动的行和列。

import { MAX_FULLTEXT_CHARS } from './config.js';

const CELL_RULES = `【单元格怎么表示】
- 公式以 = 开头，用英文函数名、逗号分隔参数（如 =SUM(D2:D7)、=IF(F2>0,"增长","下降")）；上下文里「=公式 → 结果」表示公式和它当前的计算结果；
- 数字、日期、百分比按单元格显示的样子给出（如 1,200.00、2026-07-03、12%）；
- 以英文单引号 ' 开头表示「按文本保存」：像 '00123 这样的编号、电话号码必须保留这个 '，否则 Excel 会把它当成数字、丢掉前导零；
- 首尾带空格的内容用英文双引号括起来（如 "acme corp "）；单元格内换行写作 <br>；竖线写作 \\|；空单元格留空。`;

const OUTPUT_RULES = (multi) => `【输出格式，必须严格遵守】
1. ${multi ? '对每个需要修改的目标：先单独一行写【目标k】（k 是编号），紧接着' : ''}用一个 \`\`\`table 围栏给出新内容，格式和给你的目标表格一样：第一行是列字母（第一格留空），每行第一格是行号。${multi ? '一个目标最多一个围栏；确实无需改动的目标不给围栏，在围栏外说明。' : '整个回复只允许出现这一个围栏。'}
2. 只需要列出有改动的行和列（行号、列字母照写）；没有列出的单元格保持原样，所以不要为了"完整"而改动无关的单元格。要把某个单元格清空，就把它列出来并留空。
3. 写回时内容会像在 Excel 里手动输入一样被识别：数字、日期、百分比会成为数值，= 开头会成为公式；想保存成文本就在开头加 '。
4. 可以写到目标区域正下方或右侧的空白单元格（比如补一行合计、填一列分类），但不能写到目标区域外已有内容的单元格。
5. 围栏外可以用一两句话说明做了什么（语言见下方【回复语言】）；如果指令无法执行，就不要输出围栏，直接说明原因。`;

const EDIT_SYSTEM = (n) => `你是嵌入 Microsoft Excel 的表格助手。下面会给你工作簿的内容：每张工作表是一张带坐标的 Markdown 表格（第一行是列字母，每行第一格是行号）；用户选中的${n > 1 ? ` ${n} 个目标区域` : '目标区域'}另外单独列出。你要按用户指令给出${n > 1 ? '各目标区域' : '目标区域'}的新内容。

【怎么用上下文】给你整张工作表（以及其他工作表的内容或预览）是为了让你看懂数据：列标题、单位、同一行其他列的信息、已有公式的写法……但你能改的只有${n > 1 ? '这些目标区域' : '目标区域'}（和它正下方、右侧的空白单元格）。

${CELL_RULES}

${OUTPUT_RULES(n > 1)}`;

const ASK_SYSTEM = `你是嵌入 Microsoft Excel 的表格助手，帮用户理解和分析他们的工作簿。请遵守：
- 只依据提供的工作簿内容和你已有的知识回答；表里没有的信息就说"表中没有"，不要编造数据。
- 提到具体数据时注明单元格或区域地址（如 D5、Orders!B2:B7），方便用户在表里找到。
- 需要计算时说明算法；给公式时用英文函数名、逗号分隔参数，并说明放在哪个单元格。
- 用 Markdown 组织，简明清晰。

${CELL_RULES}`;

// 回复语言：说明文字跟随用户本轮指令的语言；判断不了时跟随面板界面语言。
// 单元格内容本身保持原来的语言（除非用户要求翻译）。
export function languageRule(mode, uiLanguage) {
  const fallback = uiLanguage === 'en' ? '英文（English）' : '中文';
  return mode === 'edit'
    ? `【回复语言】围栏外的说明、以及无法执行时的解释，使用用户本轮指令所用的语言；难以判断时使用${fallback}。单元格内容保持原来的语言，除非用户明确要求翻译。`
    : `【回复语言】使用用户本轮提问所用的语言回答；难以判断时使用${fallback}。`;
}

// 英文界面时在结尾再用英文提醒一次回复语言：中文的系统提示词容易把小模型带偏成先写几句中文。
export function closingLanguageHint(mode, uiLanguage) {
  if (uiLanguage !== 'en') return '';
  return mode === 'edit'
    ? 'Write any explanation outside the code fences in the language of the instruction above (English if unsure). Keep cell contents in their original language unless asked to translate.'
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
  parts.push('==== 附件列表结束 ====');
}

const label = (t) => `目标${t.k}（${t.where || '选中区域'}）`;

// 续轮的短 prompt：CLI 会话里已有系统规则、工作簿内容和此前对话，本轮只发最新的目标区域、新增附件和指令。
export function buildTurnPrompt({ mode, backend = 'claude', uiLanguage = 'zh-CN', doc = {}, instruction = '', files = [] }) {
  const isEdit = mode === 'edit';
  const targets = Array.isArray(doc.targets) ? doc.targets : [];
  const parts = [];
  if (targets.length) {
    parts.push(`本轮的目标区域如下（工作簿可能已被编辑过，一律以这里为准${isEdit ? '；只有这些区域及其正下方、右侧的空白单元格可以写入' : ''}）：`);
    for (const t of targets) {
      parts.push(`---- ${label(t)} ----`);
      parts.push(t.text);
    }
    parts.push('==== 目标区域结束 ====');
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
  parts.push(isEdit
    ? `\n仍按最初约定输出：${targets.length > 1 ? '每个要改的目标前单独一行【目标k】，紧跟' : '唯一一个'} \`\`\`table 围栏，第一行列字母、每行第一格行号，只列出有改动的行和列；公式用英文函数名；要保存成文本的编号加 '；无法执行就不出围栏、直接说明原因。`
    : '\n请直接用 Markdown 回答。');
  parts.push(languageRule(isEdit ? 'edit' : 'ask', uiLanguage));
  const hint = closingLanguageHint(isEdit ? 'edit' : 'ask', uiLanguage);
  if (hint) parts.push(hint);
  return parts.join('\n');
}

function pushDocInfo(parts, doc) {
  const info = [];
  if (doc.docTitle) info.push(`工作簿：${doc.docTitle}`);
  if (doc.sheetCount) info.push(`共 ${doc.sheetCount} 张工作表`);
  if (doc.activeSheet) info.push(`当前工作表：${doc.activeSheet}`);
  if (info.length) parts.push(info.join(' · '));
}

// messages: [{ role: 'user'|'assistant', content }]，最后一条是本轮指令
// doc: { docTitle, sheetCount, activeSheet, targets: [{k, text, where}], fullText, truncated }
//   fullText 由前端拼好：各工作表带坐标的表格，超长已截取；targets[k].text 是目标区域带坐标的表格
// files: [{name, path, mime}]  ← 已落盘的二进制附件（图片/PDF），backend 决定提示读法
export function buildPrompt({ mode, backend = 'claude', uiLanguage = 'zh-CN', doc = {}, messages = [], files = [] }) {
  const isEdit = mode === 'edit';
  const targets = Array.isArray(doc.targets) ? doc.targets : [];
  const parts = [];
  parts.push(isEdit ? EDIT_SYSTEM(targets.length) : ASK_SYSTEM);
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
    parts.push(`\n==== 工作簿内容${truncated ? '（过长，已截取目标所在的行和周边）' : ''} ====`);
    parts.push(t);
    parts.push('==== 工作簿内容结束 ====');
  }

  if (targets.length) {
    parts.push(isEdit
      ? `\n==== 用户选中的${targets.length > 1 ? ` ${targets.length} 个` : ''}目标区域（你的输出将按单元格写回这里）====`
      : `\n==== 用户选中的${targets.length > 1 ? ` ${targets.length} 个` : ''}区域（提问针对这里）====`);
    for (const t of targets) {
      parts.push(`---- ${label(t)} ----`);
      parts.push(t.text);
    }
    parts.push('==== 目标区域结束 ====');
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
    ? (targets.length > 1 ? '\n请按上面的输出格式，对各目标分别给出新内容（每个前一行写【目标k】）：' : '\n请按上面的输出格式，给出目标区域的新内容：')
    : '\n请回答：');
  const hint = closingLanguageHint(isEdit ? 'edit' : 'ask', uiLanguage);
  if (hint) parts.push(hint);
  return parts.join('\n');
}
