# LLM_in_PDF

[English](README.md) · **简体中文**

**把本机 Claude Code 或 Codex 接入 Chrome 中的 PDF，选字或框图，在文档旁精确提问。**

这是一个 Chrome 扩展，支持 **arXiv、其他平台论文网页、在线 PDF 和本地 PDF**。继续在浏览器中查看文档，直接选择想讨论的文字或图表，再在右侧对话栏提问；PDF 原文保持不变。回答用的是你本机登录的 **Claude Code** 或 **Codex** 命令行，
模型和思考强度（effort）都可选，使用你自己的 Claude/Codex 账号。界面目前为中文，支持中英文提问和回答。

![PDF 图片提问](docs/images/pdf-image-chat.jpg)

[Chrome 商店发布材料与流程](../docs/chrome-store/README.zh-CN.md) · [隐私政策](../docs/chrome-store/PRIVACY.md#中文)

## 安装

需要 Node.js 22.13+ 和已登录的 Claude Code 或 Codex CLI。macOS / Linux：

```bash
cd LLM_in_Work/LLM_in_PDF
./install.sh
```

然后装插件：
1. Chrome 打开 `chrome://extensions`，右上角开「**开发者模式**」
2. 「**加载已解压的扩展程序**」→ 选本项目的 **`extension/`** 目录

Windows 暂用 HTTP 模式：在本目录运行 `npm start`，保持终端开启，再按上述步骤加载扩展。

**macOS / Linux 原生消息模式不需要手动启动后端**——用的是 Chrome 官方的"原生消息"机制：
插件需要时，Chrome 自动把本机的桥程序拉起来跑 claude/codex，用完自动退出。

## 使用

**不同来源的打开方式：**

| 来源 | 打开方式 |
| --- | --- |
| arXiv | 直接打开论文页或 PDF，保留原有自动阅读体验 |
| 其他网站 PDF | 浏览器打开 PDF 时自动进入 PDF 界面；按 PDF 响应类型识别，支持无 `.pdf` 后缀且带参数的链接 |
| 其他平台论文详情页 | 点击扩展 →「打开当前 PDF / 论文的 PDF 链接」，会查找页面的 PDF 元数据或链接 |
| 论文网页正文 | 点击扩展 →「读取当前论文网页」，读取浏览器当前可见正文；不会绕过登录或付费限制 |
| 浏览器中的本地 PDF | 在扩展详情开启「允许访问文件网址」，再打开或刷新 `file:///…pdf`；也可点扩展手动打开 |
| 本地文件导入 | 点击扩展 →「选择 / 拖入本地 PDF」，选择或拖入文件，不需要文件网址权限 |
| 已知 PDF 地址 | 在扩展中粘贴 HTTP、HTTPS 或 file:// 地址并打开 |

自动打开开关对在线和本地 PDF 都生效；其他网站的普通网页需手动点击读取。网站明确标为附件下载的响应保留下载行为，下载后可以导入。若网站需要登录或阻止扩展直接读取，先在原站登录 / 下载 PDF，再导入文件。浏览器内部设置页和其他扩展页面不能注入。

**阅读与对话：**

1. 按上表打开论文；例如 arXiv 的 `https://arxiv.org/abs/1706.03762`
2. 右侧自动弹出对话栏（右下角 📄💬 悬浮球可开合）
3. 直接提问；或**选中论文里一段文字** → 点浮标「💬 问一下」→ 针对这段追问
4. 右上角三个下拉：
   - **后端**：Claude / Codex
   - **模型**：从本机 Claude Code 的初始化目录和 Codex `model/list` 动态读取；点击 ↻ 可刷新（缓存 5 分钟）。不再写死版本号。目录暂时不可用时保留默认配置和稳定别名。
   - **effort**：Codex 跟随所选模型的支持档位，保留 `max` / `ultra`，不再统一降到 `xhigh`。
5. 回答底部显示本轮所选模型；Claude 收到实际模型事件后显示真实 ID。Codex 默认项标明“本机配置”，不把配置值冒充服务端确认的实际模型。
6. **对话按论文自动保存**：arXiv 的 abs/HTML/PDF 页共享原有历史；其他在线文档按完整来源地址区分（忽略页码片段）；本地 PDF 按文件内容识别，重命名后仍恢复历史，同名不同文件不会串话。本地浏览器打开与导入同一文件也共享历史。
7. **历史会话管理**：🧹 开新对话时旧对话**自动归档**（每篇论文留最近 10 段）；
   点 **🕘** 查看本文所有历史会话——可「打开」继续聊、「📋 复制整段」导出为 Markdown、🗑 删除；
   面板上方 **📋 复制整段对话** 可复制当前全部问答（含论文标题、引用片段、模型信息和 Markdown 原文）；
   **复制本文全部历史** 可合并当前对话和已保存的归档会话。生成中也可复制已输出内容。
8. **Markdown 与公式渲染**：支持表格（列对齐、宽表横向滚动）、标题、嵌套列表、引用、代码块、删除线和链接。
   回答里的 LaTeX 公式（`$...$`、`$$...$$`）用 KaTeX 渲染成正常数学排版，
   本地打包不联网；超宽公式可横向滚动
9. **PDF 选字阅读**：打开 `/pdf/…` 会自动进入扩展内的 PDF.js 界面，保留原始排版，可选字、缩放、翻页、搜索；选择后点「问一下」即可引用提问。全文从 PDF 文字层提取，不依赖论文有 HTML 版。
10. **PDF 图片提问**：点 PDF 界面顶部「框选图片」，在一页内拖框选中图片、图表或扫描内容；松开后右侧出现截图预览，可移除或继续添加。输入问题后发送，留空发送则默认解释该图。按 Esc 取消框选。
    Claude 与 Codex 都接收实际图像；每轮最多附带最近 4 张图片，支持继续追问。较早的图可重新框选。

扩展设置提供自动打开开关。PDF 界面顶部的「原生 PDF」可打开来源地址的浏览器查看器，「打开文件」可切换论文。扫描件没有文字层时也能框选内容交给视觉模型，但不自动提取扫描件全文。

## 从 paper_read 迁移

项目已并入 [LLM_in_Work](../README.zh-CN.md)，目录及界面统一为 `LLM_in_PDF`。
在新目录重新运行 `./install.sh`，在浏览器的扩展开发者界面使用新 `extension/` 路径重新加载同一个扩展；不要先卸载旧扩展，以免清空浏览器保存的数据。
扩展公钥和 ID、会话键、PDF 文档指纹及原生消息名称 `com.paper_read.host` 保持不变。
新安装器将桥启动脚本写入 `~/.llm_in_pdf`，并把原有原生消息注册指向新代码。
环境变量改用 `LLM_IN_PDF_*`（例如 `LLM_IN_PDF_PORT`、`LLM_IN_PDF_CODEX_BIN`）；旧 `PAPER_READ_*` 仍兼容，新名称优先。

## 功能

- 新增其他平台 PDF、论文网页、浏览器本地文件，以及本地文件选择 / 拖放导入。
- 导入的 PDF 保存在浏览器本地，刷新可继续阅读；入口页列出已导入文件，可移除文件并保留对话历史。单个本地 PDF 最大 100 MB。
- 原有选字、图片框选、Markdown 渲染、整段复制和模型选择均可用于新来源。
- 重新加载扩展并刷新论文页面。新增网站访问、页面读取和 PDF 响应识别权限；如 Chrome 提示，请确认重新启用扩展。直接打开 file:// 文件需要在扩展详情手动开启「允许访问文件网址」；文件选择方式不需要该开关。
- 迁移到新目录时需重装原生桥；HTTP 模式需重启后端。

## 0.8.0 图片提问更新

- 新增「框选图片」，同时支持 PDF 中的位图和矢量图表，裁切后重新渲染为清晰截图。
- 原生桥和 HTTP 后端都支持传图：Claude 使用多模态消息，Codex 使用 CLI 图片参数；临时图片在请求结束后清理。
- 截图随对话保存在本机，刷新后仍可查看和追问；复制对话时包含图片的内嵌数据。新增本地 `unlimitedStorage` 权限，避免截图历史受默认存储配额影响。归档删除时连同该会话图片一起删除。
- 在 `chrome://extensions` 重新加载扩展，然后刷新 PDF 页面。原生桥会读取新代码；HTTP 模式需重启后端。

## 0.7.0 对话与 Markdown 更新

- 新增明确的「复制整段对话」与「复制本文全部历史」按钮，复制内容为可直接保存的 Markdown。
- 当前对话不再只保存最近 60 条消息；刷新后可继续复制完整已保存对话。旧版已经截掉的消息无法恢复；归档仍保留最近 10 段。
- 完整 Markdown 解析器在流式回答和历史消息中均生效，表格和数学公式可同时渲染，代码中的公式符号保持原样。
- 新增剪贴板写入权限，重新加载扩展并刷新论文页面后生效。

## 0.6.0 PDF 界面与后端更新

- 在 `chrome://extensions` 找到 LLM_in_PDF 并点「重新加载」，然后重新打开 arXiv PDF；已经打开的 PDF 可通过扩展弹窗按钮进入 PDF 界面。
- 原生桥直接引用本项目文件，通常无需重装。若修改过项目位置、Node 或代理，重新运行 `./install.sh`。使用 HTTP 模式时重启 `npm start`。
- 模型目录下方显示实际 CLI 版本，悬停可查看路径。后端比较 PATH、nvm、`~/.local/bin`、Codex/ChatGPT 应用包内的 CLI，选择已安装的较新版本；不修改系统安装。
- `LLM_IN_PDF_CLAUDE_BIN` / `LLM_IN_PDF_CODEX_BIN` 可固定可执行路径，优先级高于自动发现。默认模型跟随本机配置，已有手动模型选择保留。

## 架构（大白话）

```
论文网页 / PDF 界面 → 插件后台 → Chrome 自动拉起桥程序 → claude / codex 命令行
   对话栏/选中提问       消息中转      server/native-host.js       你已登录的账号
```

- **为什么要插件**：在论文页嵌入对话栏、读取选中文字，并用统一的 PDF 界面处理在线和本地 PDF。
- **为什么要桥程序**：浏览器不允许插件直接启动本机命令行（安全限制），
  必须通过 Chrome 的 Native Messaging 机制授权一个"桥"。`install.sh` 干的就是注册这座桥。
- **读全文**：PDF 界面在浏览器内提取所有页的文字；arXiv 网页优先抓 `arxiv.org/html/<id>`，没有就试 `ar5iv`，再不行退回摘要页；其他平台由用户点击后读取当前网页正文；
  公式尽量还原成 LaTeX；正文最多注入 60 万字符（≈15 万 token，基本不会截断）。
- **对话记忆**：claude/codex 每次都是一问一答，所以每轮把"论文全文 + 历史对话 + 本轮问题 + 最近 4 张截图"
  整个打包重发，模型才连得上上下文。
- **纯问答**：已禁用 Claude 的联网/执行/改文件类工具，文本和图像直接作为模型输入。

## 几个注意点

- **代理**：安装时会把你 shell 里的代理设置（`https_proxy` 等）"烤"进桥程序，
  因为 Chrome 拉起进程时不带 `~/.zshrc` 里的变量。**换了代理端口就重跑一次 `./install.sh`**。
- **换 node 版本 / 移动项目目录后**：同样重跑 `./install.sh`。
- **PDF 页**：扩展使用本地打包的 PDF.js 绕开 Chrome 原生查看器的选区隔离；在线 PDF 从用户打开的来源地址获取，本地 PDF 由浏览器读取。
- **只读到摘要**：若论文没有 HTML 版，可打开 PDF 界面读取全文。
- **卸载**：`./install.sh --uninstall`。该命令只移除新桥及指向它的注册；扩展内文档和会话不变。旧版 `~/.paper_read` 不自动删除。

## 备用方案：HTTP 后端

原生桥万一不可用（插件会自动探测并回退），可手动起 HTTP 后端顶上：

```bash
node server/server.js    # 或 ./start.sh，默认端口 8765，保持窗口开着
```

设置窗里的「后端地址」只在这个模式下才用到。

## 目录结构

```
LLM_in_PDF/
├── install.sh              # 一次性安装：注册原生消息桥（含代理烤入）
├── server/
│   ├── native-host.js      # 桥程序：Chrome 原生消息协议 ⇄ claude/codex
│   ├── server.js           # 备用 HTTP+SSE 后端（可不用）
│   ├── paper-fetcher.js    # 抓 arXiv 全文（html → ar5iv → 摘要 依次兜底）
│   ├── cli.js              # claude/codex 子进程适配 + 流式解析
│   ├── images.js           # 图片校验、多模态消息与临时图片
│   ├── models.js           # CLI 动态模型目录与推理档位
│   ├── runtime.js          # CLI 路径与版本发现
│   ├── launch.js / process.js # 子进程启动、超时与取消
│   ├── prompt.js           # 拼 prompt
│   └── config.js           # 截断长度 / effort 映射 / PATH 兜底
├── extension/              # Chrome 扩展（MV3 原生 JS，无需构建；ID 已用 key 固定）
│   ├── manifest.json
│   ├── background/service-worker.js   # 原生桥优先，自动回退 HTTP
│   ├── content/            # 各来源共用的对话栏 + 选中提问
│   ├── reader/             # PDF.js 界面、全文/图片提取与本地文件存储
│   ├── shared/             # 文档身份、URL 校验、打开入口与 arXiv 跳转规则
│   ├── popup/              # 设置窗
│   └── icons/
└── tools/
    ├── make-icons.js       # 生成图标
    ├── test-native-host.js # 不开 Chrome 直接测桥（node tools/test-native-host.js --wrapper）
    └── pubkey.b64 / ext_id.txt  # 固定插件 ID 的公钥信息；不需要私钥
```

## 隐私

桥程序只被你浏览器里的这一个插件（ID 已固定）调用，不开任何网络端口；
原始本地 PDF 保留在浏览器内，不上传到后端。你发送问题时，提取的论文正文、近期截图和对话通过你**本机登录的** Claude/Codex 发给其模型服务，不经过额外的中转服务器。未发送的框选图片只在页面内预览；已发送图片随历史保存在浏览器本地。

## 开发与验证

后端使用 Node 内置模块；开发环境建议 Node.js ≥ 22.13。

```bash
npm ci
npm run vendor       # 更新已打包的 PDF.js 与 Markdown 解析器
npm test             # 图片输入、Markdown/公式、原生桥、HTTP/SSE、模型目录与 CLI 回归测试
```

可选浏览器回归测试使用 Playwright（测试 PDF 和模拟后端，不调用真实模型）：

```bash
npx playwright-core install chromium
npm run test:ui      # PDF 界面、图片、Markdown、历史、网页、本地导入、file://
npm run test:install # 隔离目录中的安装 / 更新 / 原生桥 / 卸载
npm run test:live    # 可选：真实 Claude 调用，消耗账号用量
npm run test:live:codex
```

PDF.js 来源：[Mozilla PDF.js](https://mozilla.github.io/pdf.js/)，其 Apache-2.0 许可随打包文件保留。
Markdown-it 和 KaTeX 的 MIT 许可证随本地资源一起分发。后端模型目录与进程管理沿用本仓库其他助手的约定。更多数据说明见 [SECURITY.md](../SECURITY.md)。
