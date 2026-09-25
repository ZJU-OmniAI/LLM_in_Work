// 把"文档上下文 + 历史对话 + 本轮指令"拼成一段完整 prompt。
// 首轮发送完整上下文；CLI 会话续轮发送最新选段、附件与指令。
// 两种模式：
//   edit：单段使用唯一 latex 围栏，多段使用逐段带 ID 的围栏（前端解析后做 diff/应用）
//   ask ：针对选中片段或全文答疑，普通 Markdown 回答

import { MAX_FULLTEXT_CHARS } from './config.js';

const EDIT_SYSTEM = `你是嵌入 Overleaf 网页编辑器的 LaTeX 修改助手。下面会给你当前文件的完整内容和用户在编辑器里选中的一段 LaTeX 源码，你要按用户指令给出"替换这段选中内容"的新 LaTeX。

【怎么用全文】给你整份文件是为了让你吃透上下文：全文的行文风格、术语译法、导言区有哪些宏包、选中段前后在讲什么、\\label/\\ref 的对应关系……改写时都要与全文保持一致。但注意：全文只是背景，你要改的只有选中那一段。

【输出格式，必须严格遵守】
1. 把替换后的内容放在一个 \`\`\`latex 围栏代码块里；整个回复只允许出现这一个代码块。
2. 代码块里的内容会被"原样整体替换"进编辑器，所以：
   - 只写替换选中段的内容本身：不要重复选区外的前后文，不要把全文其他部分抄进来，不要自作主张加 \\documentclass、\\begin{document} 之类（除非选中片段本身就含这些）；
   - 必须是能通过编译的合法 LaTeX；只用导言区已有的宏包和命令，确需新宏包时在代码块外用一句话说明；
   - 保留原有的 \\label、\\cite、\\ref、\\eqref 等键名不动，除非用户明确要求改；
   - 公式、表格、图片等环境的结构不要无故改变；
   - 缩进和换行风格与原文保持一致，不要把多段并成一行。
3. 代码块外可以加一两句简短中文说明改了什么（可选，别长篇大论）。
4. 如果指令无法执行（比如和选中内容无关），就不要输出代码块，直接用中文说明原因。`;

const MULTI_EDIT_SYSTEM = `你是 Overleaf 的 LaTeX 修改助手。用户选中了同一文件中多个不连续的片段，每个片段有独立 ID。全文仅作为上下文，按用户指令分别修改这些片段，保持全文的术语和风格一致。
- 每段只输出替换该片段的文本；不要合并片段，不要包含两段之间未选中的内容，也不要改动选区外的内容。
- 保留 LaTeX 结构、缩进和换行；保持标签、引用等键名不变，只使用已有宏包和命令，除非用户明确要求修改。
- 每个 ID 都必须输出一段替换稿；无需改动的片段原样返回。各片段使用各自带 ID 的 latex 围栏。
- 围栏外可用一两句中文说明。无法执行时只说明原因，不输出替换代码块。`;

function hasMultipleSelections(doc) { return Array.isArray(doc.selections) && doc.selections.length > 1; }
function pushSelections(parts, doc, isEdit) {
  if (!hasMultipleSelections(doc)) return;
  parts.push(`\n==== 本轮选中的 ${doc.selections.length} 个不连续片段（以本轮为准，顺序为文档顺序）====`);
  for (const r of doc.selections) {
    parts.push(`选段 ID: ${r.id} · 第 ${r.line1}–${r.line2} 行`);
    parts.push(r.text);
    parts.push(`==== 选段 ${r.id} 结束 ====`);
  }
  parts.push(isEdit ? '各段将分别替换到原位置；段间未选中的内容保持不变。' : '提问针对以上各段，可对比和综合分析。');
}
function multiFormat(doc) {
  return `本轮为多段改写，以下格式覆盖此前所有单段输出约定。必须输出 ${doc.selections.length} 个独立代码块，ID 必须恰好为 ${doc.selections.map((r) => r.id).join('、')}，不得遗漏、重复或新增 ID。每段的围栏格式如下（内容替换为对应片段的新 LaTeX，保持标签引用不变）：\n`
    + doc.selections.map((r) => '```latex id=' + r.id + '\n该片段的完整替换内容\n```').join('\n');
}

const ASK_SYSTEM = `你是嵌入 Overleaf 网页编辑器的 LaTeX 写作助手，帮用户理解和改进他们的文档。请遵守：
- 只依据提供的文档内容和你已有的知识回答；文档里没有的信息就说"文中未提及"，不要编造。
- 回答默认用中文；用户用英文提问则用英文。
- 涉及公式用 $...$ / $$...$$ 的 LaTeX 写法；给出的 LaTeX 示例放进 \`\`\`latex 代码块。
- 用 Markdown 组织，简明清晰。`;

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
    parts.push('请用 Read 工具打开上述路径查看附件内容（图片和 PDF 都能直接读）。');
  } else if (files.some((f) => !/^image\//.test(f.mime || ''))) {
    parts.push('对于给出路径的附件，请尽量用你可用的方式读取；读不了就说明该附件未能读取，不要编造内容。');
  }
  parts.push('==== 附件列表结束 ====');
}

// 续轮的短 prompt：CLI 会话里已有系统规则、全文和此前对话（走服务端缓存），
// 本轮只发：新选中片段（权威版本）+ 新增附件 + 指令 + 一句输出格式提醒。
export function buildTurnPrompt({ mode, backend = 'claude', doc = {}, instruction = '', files = [] }) {
  const isEdit = mode === 'edit';
  const parts = [];
  pushSelections(parts, doc, isEdit);
  if (!hasMultipleSelections(doc) && typeof doc.selection === 'string' && doc.selection !== '') {
    const lineInfo = doc.selLine1
      ? `（当前文件第 ${doc.selLine1}${doc.selLine2 && doc.selLine2 !== doc.selLine1 ? '–' + doc.selLine2 : ''} 行）`
      : '';
    parts.push(`本轮用户选中的 LaTeX${lineInfo}如下。注意：文档可能已被编辑过，与你记忆中的版本不同时，以下面这段为准${isEdit ? '；你的输出将整体替换这一段' : ''}：`);
    parts.push('==== 选中内容开始 ====');
    parts.push(doc.selection);
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
  parts.push(isEdit
    ? (hasMultipleSelections(doc) ? multiFormat(doc) : '\n本轮为单段改写，覆盖之前的多段格式：唯一一个 ```latex 围栏放替换内容（整体替换本轮选中段，保持合法可编译、标签引用不动），围栏外最多一两句中文说明；无法执行就不出围栏、直接说明原因。')
    : '\n请直接用 Markdown 回答。');
  return parts.join('\n');
}

function pushDocInfo(parts, doc) {
  const info = [];
  if (doc.projectName) info.push(`项目：${doc.projectName}`);
  if (doc.fileName) info.push(`当前文件：${doc.fileName}`);
  if (doc.docChars) info.push(`全文长度：约 ${doc.docChars} 字符`);
  if (info.length) parts.push(info.join(' · '));
}

// messages: [{ role: 'user'|'assistant', content }]，最后一条是本轮指令
// doc: { projectName, fileName, docChars, selection, selLine1/2, fullText, truncated,
//        extraFiles: [{name, text, truncated}] }  ← 用户附加的项目内/本地文本文件
// files: [{name, path, mime}]  ← 已落盘的二进制附件（图片/PDF），backend 决定提示读法
export function buildPrompt({ mode, backend = 'claude', doc = {}, messages = [], files = [] }) {
  const isEdit = mode === 'edit';
  const parts = [];
  parts.push(isEdit ? (hasMultipleSelections(doc) ? MULTI_EDIT_SYSTEM : EDIT_SYSTEM) : ASK_SYSTEM);
  parts.push('');
  pushDocInfo(parts, doc);

  // 主路径：整份当前文件做上下文（fullText），选中片段单独列出并标注行号
  if (doc.fullText) {
    let t = doc.fullText;
    let truncated = doc.truncated;
    if (t.length > MAX_FULLTEXT_CHARS) {
      t = t.slice(0, MAX_FULLTEXT_CHARS) + '\n…（过长已截断）';
      truncated = true;
    }
    parts.push(`\n==== 当前文件完整内容${doc.fileName ? `（${doc.fileName}）` : ''}${truncated ? '（过长，已截取导言区+选区周边）' : ''} ====`);
    parts.push(t);
    parts.push('==== 文件内容结束 ====');
  }

  pushSelections(parts, doc, isEdit);
  if (!hasMultipleSelections(doc) && typeof doc.selection === 'string' && doc.selection !== '') {
    const lineInfo = doc.selLine1
      ? `（位于上述文件第 ${doc.selLine1}${doc.selLine2 && doc.selLine2 !== doc.selLine1 ? '–' + doc.selLine2 : ''} 行）`
      : '';
    parts.push(isEdit
      ? `\n==== 用户选中的 LaTeX${lineInfo}（你的输出将整体替换这一段）====`
      : `\n==== 用户选中的 LaTeX${lineInfo}（提问针对这一段）====`);
    parts.push(doc.selection);
    parts.push('==== 选中内容结束 ====');
    // 旧版窗口式上下文兜底（没有 fullText 时才用）
    if (!doc.fullText && doc.before) {
      parts.push('\n==== 选区之前的紧邻上文 ====');
      parts.push(doc.before);
      parts.push('==== 选区之后的紧邻下文 ====');
      parts.push(doc.after || '');
    }
  }

  // 用户附加的文本文件（项目里的其他 .tex/.bib，或本地文本）
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
    parts.push('\n==== 此前的对话（可能涉及本文件里此前选中的其他片段；当前要改的以上面"用户选中的 LaTeX"为准）====');
    for (const m of history) {
      const c = m.content.length > 4000 ? m.content.slice(0, 4000) + '…（截断）' : m.content;
      parts.push(`${m.role === 'assistant' ? '助手' : '用户'}：${c}`);
    }
    parts.push('==== 对话历史结束 ====');
  }

  parts.push(`\n用户本轮的指令：\n${current ? current.content : ''}`);
  parts.push(isEdit ? (hasMultipleSelections(doc) ? multiFormat(doc) : '\n请按上面的输出格式要求，给出替换选中内容的 LaTeX：') : '\n请回答：');
  return parts.join('\n');
}
