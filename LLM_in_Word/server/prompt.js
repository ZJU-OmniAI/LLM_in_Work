// 把"文档上下文 + 历史对话 + 本轮指令"拼成一段完整 prompt。
// claude -p / codex exec 都是一问一答、不记忆，所以每轮把全部上下文带上。
// 两种模式：
//   edit：改写选中的 Word 正文，要求模型把替换文本放进唯一的 ```text 围栏（前端解析后做 diff/应用）
//   ask ：针对选中片段或全文答疑，普通 Markdown 回答
// 与 LLM_in_Overleaf 的区别：这里处理的是 Word 纯文本正文，不是 LaTeX——
// 围栏里的内容会被"按字面"写进 Word 文档，所以必须禁止模型输出 Markdown 记号。

import { MAX_FULLTEXT_CHARS } from './config.js';

const EDIT_SYSTEM = `你是嵌入 Microsoft Word 的中文写作助手。下面会给你当前文档的完整正文（纯文本，段落用换行分隔），其中用【选中段开始】【选中段结束】标出了用户在 Word 里选中的一段，你要按用户指令给出"替换这段选中内容"的新文本。

【怎么用全文】给你整份文档是为了让你吃透上下文：全文的文体、语气、术语用法、选中段前后在讲什么……改写时都要与全文保持一致。但注意：全文只是背景，你要改的只有选中那一段。

【输出格式，必须严格遵守】
1. 把替换后的文本放在一个 \`\`\`text 围栏代码块里；整个回复只允许出现这一个代码块。
2. 代码块里的内容会被"按字面原样"写进 Word 文档，所以：
   - 必须是纯文本：不要用任何 Markdown 记号（# 标题、**加粗**、- 列表、> 引用等都不行，写了会原样出现在文档里）；
   - 只写替换选中段的内容本身：不要重复选区外的前后文，不要把全文其他部分抄进来；
   - 分段用换行表示，一行就是 Word 里的一个段落；没必要就不要改变原文的分段结构；
   - 原文里的编号（如"一、""1."）、专有名词、数据、引文照原样保留，除非用户明确要求改；
   - 没必要改动的词句请逐字保留原样：系统会把新旧文本逐字对比，把原有的加粗/斜体等格式迁移到没变的文字上——改动越少，格式保留越完整。
3. 代码块外可以加一两句简短中文说明改了什么（可选，别长篇大论）。
4. 如果指令无法执行（比如和选中内容无关），就不要输出代码块，直接用中文说明原因。`;

const EDIT_SYSTEM_MULTI = (n) => `你是嵌入 Microsoft Word 的中文写作助手。下面会给你当前文档的完整正文（纯文本，段落用换行分隔），其中用【目标1开始】【目标1结束】…【目标${n}开始】【目标${n}结束】标出了用户选中的 ${n} 段分散的文字，你要按用户指令分别给出每段的替换文本。

【怎么用全文】给你整份文档是为了让你吃透上下文：全文的文体、语气、术语用法、各目标段前后在讲什么……改写时都要与全文保持一致，并注意各目标段之间的呼应（用户常常就是要把分散的几处改得一致）。但你要改的只有标出的目标段。

【输出格式，必须严格遵守】
1. 对每个需要修改的目标：先单独一行写【目标k】（k 是编号），紧接着放一个 \`\`\`text 围栏，里面是该目标的替换文本；一个目标最多一个围栏，标签和围栏必须紧挨着。
2. 确实无需改动的目标可以不给围栏，但要在围栏外用一句话说明哪些目标没改、为什么。
3. 每个围栏里的内容会被"按字面原样"整体替换对应目标段，所以：
   - 必须是纯文本：不要用任何 Markdown 记号（# 标题、**加粗**、- 列表等都不行，写了会原样出现在文档里）；
   - 只写该目标段的替换内容本身：不要重复目标外的前后文，不要把别的目标的内容写进来；
   - 分段用换行表示，一行就是 Word 里的一个段落；没必要就不要改变原有分段结构；
   - 原文里的编号、专有名词、数据、引文照原样保留，除非用户明确要求改；
   - 没必要改动的词句请逐字保留原样：系统会逐字对比迁移格式，改动越少格式保留越完整。
4. 如果指令无法执行，就不要输出围栏，直接用中文说明原因。`;

// 表格协议（edit 模式统一附加）：表格目标用 ```table 围栏放 Markdown 表格
const TABLE_RULES = `
【表格目标】标注为"表格"的目标，其当前内容以 Markdown 表格给出（第一行为表头行，第二行是 |---| 分隔线）。要修改它时：
- 输出一个 \`\`\`table 围栏（多目标时同样前置【目标k】标签），里面放**完整的改后 Markdown 表格**；
- 单元格内不要换行；竖线字符写成 \\|；可以增删行、也可以增删列（列数变化会导致表格样式重置，非必要不改列数）；
- 只改需要改的单元格，其余单元格逐字保留原样（系统按单元格对比，改得越少格式保留越好）。
【文字转表格】用户要求把某个文本目标整理成表格时，也可对该目标输出 \`\`\`table 围栏（Markdown 表格），系统会插入为真正的 Word 表格。`;

const ASK_SYSTEM = `你是嵌入 Microsoft Word 的写作助手，帮用户理解和改进他们的文档。请遵守：
- 只依据提供的文档内容和你已有的知识回答；文档里没有的信息就说"文中未提及"，不要编造。
- 回答默认用中文；用户用英文提问则用英文。
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
// 本轮只发：最新的目标段（权威版本）+ 新增附件 + 指令 + 输出格式提醒。
export function buildTurnPrompt({ mode, backend = 'claude', doc = {}, instruction = '', files = [] }) {
  const isEdit = mode === 'edit';
  const targets = Array.isArray(doc.targets) && doc.targets.length
    ? doc.targets
    : (typeof doc.selection === 'string' && doc.selection !== '' ? [{ k: 1, text: doc.selection }] : []);
  const parts = [];
  const turnLabel = (t) => (t.kind === 'table' ? `目标${t.k}（表格 ${t.rows || '?'}×${t.cols || '?'}，输出用 \`\`\`table）` : `目标${t.k}`);
  if (targets.length === 1) {
    const t0 = targets[0];
    parts.push(t0.kind === 'table'
      ? `本轮用户选中的是一张表格（${t0.rows || '?'}×${t0.cols || '?'}，Markdown 表示）。文档可能已被编辑过，以下面为准${isEdit ? '；修改请用 \`\`\`table 围栏输出完整改后表格，只改需要改的单元格' : ''}：`
      : `本轮用户在 Word 里选中的文本如下。注意：文档可能已被编辑过，与你记忆中的版本不同时，以下面这段为准${isEdit ? '；你的输出将整体替换这一段' : ''}：`);
    parts.push('==== 选中内容开始 ====');
    parts.push(t0.text);
    parts.push('==== 选中内容结束 ====');
  } else if (targets.length > 1) {
    parts.push(`本轮用户选中了 ${targets.length} 段目标。注意：文档可能已被编辑过，一律以下面为准${isEdit ? '；请按编号分别给出替换内容（表格目标用 \`\`\`table）' : ''}：`);
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
      ? `\n仍按最初约定输出：每个要改的目标前单独一行【目标k】+ 紧跟围栏——文本目标用 \`\`\`text 放纯文本（禁 Markdown 记号；没必要改的词句逐字保留以利格式迁移）${hasTable ? '，表格目标用 \`\`\`table 放完整改后 Markdown 表格（只改需要改的单元格）' : ''}；不改的目标围栏外说明。`
      : (targets[0] && targets[0].kind === 'table'
        ? '\n仍按最初约定输出：唯一一个 ```table 围栏放完整的改后 Markdown 表格（只改需要改的单元格，其余逐字保留；单元格内不换行），围栏外最多一两句说明；无法执行就不出围栏、直接说明原因。'
        : '\n仍按最初约定输出：唯一一个 ```text 围栏放纯文本替换内容（禁 Markdown 记号；只写替换段本身；没必要改的词句逐字保留以利格式迁移），围栏外最多一两句说明；无法执行就不出围栏、直接说明原因。'))
    : '\n请直接用 Markdown 回答。');
  return parts.join('\n');
}

function pushDocInfo(parts, doc) {
  const info = [];
  if (doc.docTitle) info.push(`文档：${doc.docTitle}`);
  if (doc.docChars) info.push(`全文长度：约 ${doc.docChars} 字符`);
  if (info.length) parts.push(info.join(' · '));
}

// messages: [{ role: 'user'|'assistant', content }]，最后一条是本轮指令
// doc: { docTitle, docChars, targets: [{k, text}], fullText, truncated }
//   fullText 由前端拼好：单目标用【选中段开始/结束】、多目标用【目标k开始/结束】标出，超长已截取
//   （兼容旧字段 doc.selection = 单目标文本）
// files: [{name, path, mime}]  ← 已落盘的二进制附件（图片/PDF），backend 决定提示读法
export function buildPrompt({ mode, backend = 'claude', doc = {}, messages = [], files = [] }) {
  const isEdit = mode === 'edit';
  const targets = Array.isArray(doc.targets) && doc.targets.length
    ? doc.targets
    : (typeof doc.selection === 'string' && doc.selection !== '' ? [{ k: 1, text: doc.selection }] : []);
  const parts = [];
  parts.push(isEdit ? (targets.length > 1 ? EDIT_SYSTEM_MULTI(targets.length) : EDIT_SYSTEM) : ASK_SYSTEM);
  if (isEdit) parts.push(TABLE_RULES);
  parts.push('');
  pushDocInfo(parts, doc);

  if (doc.fullText) {
    let t = doc.fullText;
    let truncated = doc.truncated;
    if (t.length > MAX_FULLTEXT_CHARS) {
      t = t.slice(0, MAX_FULLTEXT_CHARS) + '\n…（过长已截断）';
      truncated = true;
    }
    parts.push(`\n==== 当前文档完整正文${truncated ? '（过长，已截取选中段周边）' : ''} ====`);
    parts.push(t);
    parts.push('==== 正文结束 ====');
  }

  const tgtLabel = (t) => (t.kind === 'table' ? `目标${t.k}（表格 ${t.rows || '?'}×${t.cols || '?'}，Markdown 表示，输出用 \`\`\`table）` : `目标${t.k}`);
  if (targets.length === 1) {
    const t0 = targets[0];
    parts.push(isEdit
      ? (t0.kind === 'table'
        ? `\n==== 用户选中的表格（${t0.rows || '?'}×${t0.cols || '?'}，Markdown 表示；修改请用 \`\`\`table 围栏输出完整改后表格）====`
        : '\n==== 用户选中的文本（正文中已标出位置；你的输出将整体替换这一段）====')
      : '\n==== 用户选中的内容（提问针对这一段）====');
    parts.push(t0.text);
    parts.push('==== 选中内容结束 ====');
  } else if (targets.length > 1) {
    parts.push(isEdit
      ? `\n==== 用户选中的 ${targets.length} 段目标（正文中已标出位置；请按编号分别给出替换内容）====`
      : `\n==== 用户选中的 ${targets.length} 段内容（提问针对这几段）====`);
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
    parts.push('\n==== 此前的对话（同一目标片段的上几轮）====');
    for (const m of history) {
      const c = m.content.length > 4000 ? m.content.slice(0, 4000) + '…（截断）' : m.content;
      parts.push(`${m.role === 'assistant' ? '助手' : '用户'}：${c}`);
    }
    parts.push('==== 对话历史结束 ====');
  }

  parts.push(`\n用户本轮的指令：\n${current ? current.content : ''}`);
  parts.push(isEdit
    ? (targets.length > 1
      ? '\n请按上面的输出格式，对各目标段分别给出替换文本（每段前一行写【目标k】）：'
      : '\n请按上面的输出格式要求，给出替换选中内容的纯文本：')
    : '\n请回答：');
  return parts.join('\n');
}
