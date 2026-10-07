# Chrome 发布准备检查

核对日期：2026-10-08。范围：LLM_in_Overleaf 0.9.1、LLM_in_PDF 0.9.1。

**文案修订：PDF 0.9.2。** 将定位明确为“在 Chrome 中阅读本地 PDF 和 arXiv 等平台论文，交互式调用本机 Claude Code、Codex，选局部问答”，同步 README、商店短介绍/长介绍、弹窗和宣传图。功能、权限和数据流未改动。下文记录 0.9.1 的完整功能验收；0.9.2 重新进行打包检查与实际 ZIP 的独立加载、PDF 导入/渲染/刷新、本机桥安装和连接测试。Overleaf 仍为 0.9.1。

## 结论与边界

已整理可上传的扩展 ZIP、单独的本机桥下载包和中英文商店材料。介绍统一强调：**把本机 Claude Code、Codex Agent 接入用户已有工作流，在软件中精确选定局部、审阅和确认修改，或围绕选区问答。** PDF 只提供问答，不改写原文件，也不宣称是 Chrome 原生 PDF 查看器的直接注入插件；技术实现使用随包提供的 PDF.js 视图。

本轮没有向 Chrome Web Store 提交或发布。仓库此前有版本和演示视频发布；是否已有商店草稿、审核记录或条目，仍应登录原开发者账号确认。不能把 GitHub Release 当作商店上架凭据。

## 包完整性

| 检查项 | 结果 |
| --- | --- |
| ZIP 根目录 manifest.json、Manifest V3、版本一致 | 通过；两个项目均为 0.9.1 |
| 本地脚本、样式、图标、静态资源引用 | 通过；Overleaf 13 个扩展文件，PDF 376 个扩展文件，另各含仓库 LICENSE |
| PDF.js worker、WASM、字体、KaTeX、Markdown-it 与许可证 | 随扩展打包；无需远程加载执行代码 |
| JavaScript 语法、ZIP CRC、资源路径逃逸和敏感文件模式扫描 | 通过；并非对任意形式秘密或漏洞的全面证明 |
| 本机桥与浏览器扩展分包 | 扩展 ZIP 无 Node 后端；companion 包含运行源码、安装器、锁文件、图片说明及许可证 |
| 开发版身份与商店身份 | 源码保留原公钥；商店上传 ZIP 去掉 key，实际 ID 以后台为准 |
| 原生桥授权 | 安装器接受实际商店 ID，拒绝非法 ID；只授权一个明确来源 |
| PDF HTTP 来源检查 | 接受配置 ID，拒绝其他 ID；维持回环地址、Host 与 JSON 检查 |
| 可复现构建和校验 | tools/package-chrome.py；输出 package-report.json、SHA256SUMS.txt |

源码里的旧 PDF 原生桥名 `com.paper_read.host` 是兼容既有安装的内部标识，不是遗漏的商店品牌名称。

## 功能验证

- Overleaf 单元测试：**38/38 通过**。包含 CLI 调用限制、错误处理、国际化、选区替换和会话行为。
- Overleaf 安装测试：macOS 临时 HOME 中安装、指定 ID 更新、非法 ID 拒绝、原生消息 ping、卸载通过。
- Overleaf 浏览器回归：中英文 CodeMirror 选区、多选段原子应用/撤销、过期替换拒绝、流式状态及弹窗通过。
- PDF 单元/集成测试：**19/19 通过**，覆盖安装器、原生消息、CLI 与 HTTP 来源限制。
- PDF 两套浏览器回归通过：文字/图片、Markdown/数学、历史、在线 PDF、无扩展名 PDF、页面提取、本地导入、文件权限与刷新恢复。
- 商店截图由真实 Claude 调用生成：Overleaf 仅替换选中段落，完整比对其他源码；PDF 文字问答、框图问答、导入、刷新和复制通过。模型回复没有手工改写。来源与限制见 [ASSETS.md](ASSETS.md)。
- 最终 ZIP 独立验证：`node tools/test-chrome-packages.mjs` 在临时 Chromium 配置中加载实际解压包，检查每个资源、后台、弹窗、翻译与实际 ID；PDF 还检查导入、渲染、文字提取、刷新恢复。两个 companion 解压包在临时 HOME 中安装、原生 ping 和卸载。该测试不依赖开发目录的 node_modules 运行桥。

本机验证环境为 macOS、Node 22.22.2 和独立 Chromium/Chrome。未将自动化测试等同于商店审核；真实 Overleaf 官网账号下的最终商店 ID 流程仍需发布前验收。Windows 与 Linux 的结果查看该提交的 [GitHub CI](https://github.com/ZJU-OmniAI/LLM_in_Work/actions/workflows/ci.yml)：包含原有平台测试及新增 Linux 打包/解压验证。本地不宣称已完成 Windows 真人端到端验收。

## 材料完整性

两个扩展分别具备：

- 中英文短描述（manifest，每条不超过 132 字符）及完整商店介绍。
- 128×128 图标，96×96 图形加 16 px 透明留白。
- 440×280 必需宣传图，1400×560 可选大图。
- 每个语言目录三张 1280×800 PNG 功能截图。PDF 产品界面仍为中文，两份目录使用真实中文界面，介绍已披露。
- 隐私政策、支持和源码链接；本机桥、全文上下文、附件、服务商和本地历史的说明。
- 单一用途、逐项权限/host 权限、远程代码与数据用途申报建议。
- 英文审核测试步骤，以及可逐步照做的中文发布指南。

尚需账号持有人在后台完成的项目：找到原条目/确认是否新建、账号与两步验证、实际 Item ID、版本高于后台已上传版本、最终隐私声明、必要的审核测试账号/额度安排、地区与分发范围，以及点击提交审核。宣传视频可选；商店视频栏需要 YouTube 链接，已有 GitHub 视频不直接填入该栏。

## 复现

在两个项目分别安装开发依赖后，于仓库根目录运行：

```bash
python3 tools/package-chrome.py
node tools/test-chrome-packages.mjs
python3 tools/bundle-store-materials.py
```

浏览器测试需 Playwright Chromium（`cd LLM_in_PDF && npx playwright-core install chromium`）；安装器解压测试当前在 macOS/Linux 执行，Windows 原生安装器由项目的跨平台 CI 测试。测试使用临时目录和合成文档，不改动用户已有浏览器配置与本机桥注册。
