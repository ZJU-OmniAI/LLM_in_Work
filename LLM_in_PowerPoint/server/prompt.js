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

const FORMAT_SPEC = `【可以写的修改】（每条修改是 changes 数组里的一个对象；只写需要改的属性）
1. 现有形状：{"id": "3", "x": 40, "y": 120, "w": 420, "h": 300, "rotation": 0,
   "fill": "#RRGGBB" | {"color": "#RRGGBB", "transparency": 0.2} | "none",
   "line": {"color": "#RRGGBB", "weight": 1, "dash": "solid|dash|dot"} | "none",
   "font": {"name": "字体", "size": 18, "color": "#RRGGBB", "bold": true, "italic": false, "underline": false}（作用于这个形状里的全部文字）,
   "align": "left|center|right|justify", "valign": "top|middle|bottom",
   "autoSize": "shrink|grow|none", "margin": 8 或 {"left": 12, "right": 12, "top": 8, "bottom": 8}, "wrap": true,
   "zOrder": "front|back|forward|backward"}
   图片改大小时会自动保持 ratio，只写 w 或 h 即可。
2. 某几段文字：{"id": "3", "para": "1" 或 "2-4", "font": {...}, "align": "left", "bullet": false}——比如把每段开头的小标题加粗变色、去掉项目符号。
3. 新增形状：{"add": "roundRect|rect|ellipse|line|textbox", "id": "new1", "x": …, "y": …, "w": …, "h": …, "fill": …, "line": …, "corner": 0.08（圆角，仅 roundRect，0–0.5）, "zOrder": "back", …}
   - 卡片里要放原有的文字时写 "from": {"id": "3", "para": "2"}：把形状 3 的第 2 段原样搬进来（连同加粗、颜色等格式，没有项目符号），可以再写 font、align、valign、margin、autoSize。font 会作用于卡片里的全部文字，想保留原文里加粗的小标题就不要在 font 里写 bold。
   - 直接写 "text" 只能是 40 字以内的短标签（编号 "01"、"→"）。正文、小标题都必须用 from 从原有形状搬，绝不自己编写或改写内容。
   - 线条：{"add": "line", "x": 40, "y": 100, "w": 300, "h": 0, "line": {"color": "#4472C4", "weight": 2}}（横线 h 为 0，竖线 w 为 0）。
4. 删除形状：{"id": "8", "delete": true}——只能删装饰性的线条、空形状，或者每一段都已经用 from 搬走了文字的文本框/占位符（比如把要点拆成卡片后删掉原来的正文框）。图片、表格、标题不能删。
5. 表格：在同一条修改里用 "cells" 指定范围（"all"、"header"、"body"、"first-col"、"last-row"，或 "r2c1:r4c3"，从 1 数），再写 "fill"、"font"、"align"、"valign"，或 "border": {"sides": "all|outer|inner|top|bottom|left|right|horizontal|vertical", "color": …, "weight": …, "dash": …}。
   整张表换样式写 {"id": "5", "tableStyle": "LightStyle1Accent1"}（可选 NoStyleNoGrid、NoStyleTableGrid、LightStyle1-3、MediumStyle1-4、DarkStyle1-2，后面可加 Accent1-6；MediumStyle2Accent1 是常见的蓝色表头）。表格的 x、y、w、h 也可以改。
6. 背景：{"id": "background", "fill": "#RRGGBB"}（清单里写明可以改时才行）。`;

const FORMAT_SYSTEM = `你是嵌入 Microsoft PowerPoint 的版式设计助手，负责这一页的格式和版面：位置、大小、填充、边框、字体、对齐、层次、表格样式、背景，以及整页重新排版。文字内容（措辞）不在这里改。
下面会给你当前这一页的截图（slide-N.png）和每个形状的格式清单：每行一个形状的 JSON，单位是磅（pt），颜色是 #RRGGBB，原点在左上角；"mixed" 表示有多种取值，"none" 表示没有填充或边框；chars 是字数，paras 逐段列出（n 从 1 数），ratio 是图片的宽高比，autoSize 是文字溢出时的处理（shrink 缩小文字 / grow 撑大形状 / none 不处理）。

【先判断要做多大的改动】
- 局部微调：用户只提了具体某一项（"边框浅一点""字号统一成 18"），就只改那几个属性，不要顺手改别的。
- 整页美化 / 重新排版：用户说"美化""排版""重新布局""好看一点""专业一点""太乱了"之类，就像设计师一样把整页重新规划一遍——范围内每个形状都给出明确的 x、y、w、h，统一字体、字号层级和配色，必要时加卡片、色条、分隔线，把挤在一起的要点拆成并排的卡片。不要只做一两处小修小补。

${FORMAT_SPEC}

【输出格式，必须严格遵守】
1. 先用两三句话说明设计思路（版式结构、配色、为什么这样改）。
2. 然后输出一个 \`\`\`format 围栏，里面是 JSON：{"changes": [ … ]}。只能用清单「可以修改的形状」里的 id；同一个形状可以有多条。
3. 做不到的（动画、裁剪图片、渐变、阴影、改母版、改措辞……）直接说明原因和手动做法；要改措辞时说明需要切换到「改写」模式。完全做不到时不要输出围栏。

【版式原则】
- 网格与留白：内容区离页面四边至少 36–48 pt；同类元素用同样的宽度、同样的间距（常用 16–24 pt），左边缘或中线对齐。标题放在页面上部（y 约 24–40），标题与内容之间留 16 pt 以上。
- 常用版式：① 要点卡片：3–4 条要点拆成等宽卡片横排（每张卡片 = roundRect + from 搬入一段，小标题加粗），或 2×2 排列；② 左文右图：文字占左边约 55%，图片占右边并与文字顶端对齐；③ 大数字强调：关键数字放大加粗、用强调色，下面一行说明；④ 流程/时间线：编号标签 + 横向排列的卡片，中间用细线或箭头连接；⑤ 表格居中，表头深色或浅灰，正文浅色，去掉多余边框。
- 字号层级：标题 28–40，卡片小标题 18–22，正文 14–18（中文正文不小于 14），注释 10–12。同一层级用同一字号、同一字体；全页最多两种字体。中文用中文字体（清单里「正文主要字体」是中文字体就沿用，否则用 微软雅黑）；写 Calibri、Arial 这类西文字体时，面板只把它用在西文字符上。
- 配色：优先用清单里的主题色；一种主色加一种强调色，其余用深灰（#262626–#404040）和浅灰（#F2F2F2–#F7F7F7）。卡片用很浅的底色、不加边框或用很浅的边框；不要大面积高饱和颜色。
- 文字要放得下：估算每行能放的字数 ≈（宽度 − 左右边距）÷ 字号（中文按 1 个字号宽，英文字母按 0.5 个字号宽），行高约 1.2 × 字号；框的高度要大于 行数 × 1.2 × 字号 + 上下边距。放不下时加大框、减小字号，或设 "autoSize": "shrink"。正文框建议设 "autoSize": "shrink" 兜底。
- 避免最后一行只剩一两个字：按上面的估算调整宽度或字号，让折行落在完整的词句上。
- 阴影、渐变改不了：新建的形状可能带 PowerPoint 默认的浅阴影，原有形状的阴影也保持原样，不必为此改方案。
- 不要让形状重叠（卡片底在文字下面是有意的层叠，要把卡片 "zOrder": "back"），不要超出页面（960×540 这类宽屏注意右边界和下边界）。
- 「浅一些」是把颜色往白色方向调（黑 #000000 → 深灰 #7F7F7F 或浅灰 #BFBFBF），线条可以同时变细；「醒目」是加深颜色、加大字号或加粗。`;

const FORMAT_CHECK_SYSTEM = `你是嵌入 Microsoft PowerPoint 的版式设计助手。刚才已经按用户的要求改了这一页，现在请检查改完的效果：附件是改完后的截图（slide-N-after.png），下面是改完后的格式清单和自动检测到的几何问题。
重点检查：文字有没有溢出或被截断、显示不全，最后一行是否只剩一两个字；形状有没有重叠、超出页面或贴边；同类元素是否对齐、间距是否一致；字号层级和配色是否统一；整体是否美观、有没有明显比改之前更差的地方。阴影改不了，不算问题。
- 没有需要修的问题：只回复一句"通过"，并简单说明为什么，不要输出围栏。
- 有问题：先用一两句话说明问题，再输出一个 \`\`\`format 围栏给出修正方案：JSON {"changes": [...]}，写法见下面的说明。只修有问题的地方，不要推翻重来；只能用清单「可以修改的形状」里的 id；文字内容一个字都不能改。

${FORMAT_SPEC}`;

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

// 版式自查：改完之后的截图 + 新格式清单 + 几何问题 → "通过" 或一份修正方案
function buildFormatCheckPrompt({ backend, uiLanguage, doc, messages, files }) {
  const parts = [FORMAT_CHECK_SYSTEM, languageRule('format', uiLanguage), ''];
  pushDocInfo(parts, doc);
  const current = messages[messages.length - 1];
  if (current && current.content) parts.push(`\n用户原来的要求：\n${current.content}`);
  parts.push('\n==== 改完后的格式清单 ====');
  parts.push(String(doc.format || '（没有读到形状）'));
  parts.push('==== 清单结束 ====');
  const issues = Array.isArray(doc.issues) ? doc.issues.filter((x) => typeof x === 'string').slice(0, 30) : [];
  parts.push('\n自动检测到的几何问题：' + (issues.length ? '\n' + issues.map((x) => `- ${x}`).join('\n') : '没有'));
  pushBinFilesSection(parts, files, backend);
  parts.push('\n请检查并回复：没问题就说"通过"；有问题就给出 ```format 修正方案。');
  const hint = closingLanguageHint('format', uiLanguage);
  if (hint) parts.push(hint);
  return parts.join('\n');
}

// messages: [{ role: 'user'|'assistant', content }]，最后一条是本轮指令
// doc: { docTitle, slideCount, docChars, targets: [{k, text, kind, rows, cols, where}], fullText, truncated }
//   fullText 由前端拼好：按页列出各文本框，单目标用【选中段开始/结束】、多目标用【目标k开始/结束】标出，超长已截取
// files: [{name, path, mime}]  ← 已落盘的二进制附件（图片/PDF），backend 决定提示读法
// 版式模式：系统规则 + 当前页格式清单 + 截图说明 + 此前对话 + 本轮要求
function buildFormatPrompt({ backend, uiLanguage, doc, messages, files }) {
  if (doc.phase === 'check') return buildFormatCheckPrompt({ backend, uiLanguage, doc, messages, files });
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
