# Chrome 商店发布包与操作指南

核对日期：2026-10-08。适用：LLM_in_Overleaf 0.9.1、LLM_in_PDF 0.9.2。

核心介绍统一为：**把本机已安装、已登录的 Claude Code、Codex Agent 接入日常工作流，在原软件中使用它们的能力，精确选定局部，审阅并确认修改，或围绕选区问答。** Overleaf 可以修改 LaTeX；PDF 帮你在 Chrome 中阅读本地 PDF 和 arXiv 等平台论文，交互式调用本机 Agent，选中文字或框选图表进行局部问答，原 PDF 保持不变。桥在本机，模型推理通常仍在服务商。

这是可复现的发布准备材料。商店条目 ID、账号验证、最终申报、审核结果由 Chrome 开发者后台确定；本目录不表示已上架。

## 1. 文件对应关系

在仓库根目录运行 `python3 tools/package-chrome.py`，生成 `dist/chrome-store/`：

| 文件 | 用途 |
| --- | --- |
| `LLM_in_Overleaf-0.9.1-chrome.zip` | 上传 Overleaf 的 Chrome 商店条目 |
| `LLM_in_PDF-0.9.2-chrome.zip` | 上传 PDF 的 Chrome 商店条目 |
| `*-companion.zip` | 给用户下载的本机桥及完整运行源码；不要上传到商店的扩展包栏 |
| `package-report.json`、`SHA256SUMS.txt` | 包内容、权限、资源引用及 SHA-256 校验 |
| `LLM_in_Work-chrome-store-materials-0.9.2.zip` | 文案、权限说明、审核步骤和图片的材料合集，由 `python3 tools/bundle-store-materials.py` 生成；不上传到扩展包栏 |

浏览器 ZIP 根目录就是 `manifest.json`，包含全部扩展脚本、图片及第三方运行依赖和许可证，不包含 Node 后端、node_modules、凭证、私钥或测试数据。商店 ZIP 不携带开发版公钥 `key`；源码保留原公钥，避免改变现有开发版 ID。

每个 `companion.zip` 解压后进入 `LLM_in_Overleaf` 或 `LLM_in_PDF` 子目录运行安装命令。普通使用无需 `npm install`；Node 与已登录的 Agent CLI 仍是前置条件。

## 2. 先找到旧条目，避免重复创建

1. 打开 [Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole)，使用原来准备发布时的 Google 账号。
2. 查看是否已有 LLM_in_Overleaf、LLM_in_PDF 或旧名 paper_read。已有条目就进入该条目更新；确认没有才选 **Add new item**。
3. 完成开发者注册、邮箱验证和两步验证。账号身份、费用及分发资格按后台提示由账号持有人确认。
4. 记录每个条目的 **Item ID** 和当前最高包版本。这里准备的是 Overleaf 0.9.1、PDF 0.9.2；如果后台曾上传相同或更高版本，先把项目 `package.json`、锁文件、manifest 和本机桥版本一起提升，再重新打包，不要新建重复条目来绕过版本要求。

## 3. 上传包，核对扩展 ID

分别上传对应的 `*-chrome.zip`。首次上传可以先保存草稿，不必提交审核。

开发版 ID 是：

- Overleaf：`fabclfbbpmgoojaccbpmopjfkocoaoik`
- PDF：`acafiedlcaibhilacmadmiklkfhmlhjo`

**不要假定商店 Item ID 与上面相同。** 原生桥按扩展 ID 授权；新的 ID 也意味着另一份浏览器存储。不要先卸载旧 PDF 扩展；先导出重要会话。当前未实现跨 ID 自动迁移。

拿到 Item ID 后，把下面 `<STORE_ID>` 替换成真实的 32 位小写 ID（字母 a–p，不保留尖括号）。安装命令也会在扩展弹窗中根据实际 ID 自动显示。

Overleaf / macOS、Linux：

```bash
cd LLM_in_Overleaf
./install.sh --extension-id <STORE_ID>
```

Overleaf / Windows PowerShell：

```powershell
cd LLM_in_Overleaf
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -ExtensionId <STORE_ID>
```

PDF / macOS、Linux：

```bash
cd LLM_in_PDF
./install.sh --extension-id <STORE_ID>
```

PDF / Windows PowerShell（HTTP 模式）：

```powershell
cd LLM_in_PDF
$env:LLM_IN_PDF_EXTENSION_ID='<STORE_ID>'
npm start
```

PDF / macOS、Linux 的 HTTP 备用方式：

```bash
LLM_IN_PDF_EXTENSION_ID=<STORE_ID> npm start
```

更新或移动目录后重装本机桥时，继续带上同一个商店 ID。省略 ID 会恢复开发版授权；安装器不会授权通配符。PDF HTTP 服务也只接受配置的那一个扩展来源和本机无 Origin 请求。

为在送审前验证商店 ID，可在后台 **Package → View public key** 复制公钥，填入一份临时解压包的 manifest `key`（去掉 PEM 头尾和换行），加载该副本，确认生成的 ID 与商店一致。不要修改原开发版源码中的公钥，除非已决定迁移策略。[Chrome 的 ID 核对方法](https://developer.chrome.com/docs/extensions/reference/manifest/key)。

## 4. 填 Store listing

| 后台字段 | 从哪里取 |
| --- | --- |
| 名称、短描述、版本 | 来自上传包内 manifest；已更新核心理念，中英文短描述均不超过 132 字符 |
| 详细介绍 | `overleaf/listing.en.md`、`overleaf/listing.zh-CN.md` 或 `pdf/` 中同名文件，按语言复制正文 |
| 分类 | 选择后台当前提供的 Productivity / Tools 中最贴近文档写作或阅读的分类 |
| 128×128 图标 | 各项目 `assets/icon-128.png`，四边有 16 px 透明留白 |
| 截图 | `assets/en/` 或 `assets/zh_CN/` 中的 PNG，均为 1280×800；按选区 → 差异 → 应用，或导入 → 选字问答 → 框图问答排序 |
| 小宣传图 | `assets/small-promo-440x280.png`（必需） |
| 大宣传图 | `assets/marquee-1400x560.png`（可选） |
| 支持链接 | `https://github.com/ZJU-OmniAI/LLM_in_Work/issues` |
| 首页链接 | 对应项目 README，见详细介绍末尾 |
| 隐私政策 | `https://github.com/ZJU-OmniAI/LLM_in_Work/blob/main/docs/chrome-store/PRIVACY.md` |
| 宣传视频 | 可选；此字段用 YouTube 链接。已有 GitHub 内嵌视频不能直接填入这个字段，暂可留空 |

PDF 只有商店元数据双语化，产品界面仍以中文显示，介绍里已经注明。英文截图也如实保留中文界面。Overleaf 截图来自真实扩展与 CodeMirror 的合成演示页，画面标注了 DEMO WORKSPACE；不是伪装成登录后的 Overleaf 官网。两者均使用真实 Claude 回复，详见 [截图来源](ASSETS.md)。

## 5. 填 Privacy practices

打开对应项目的 `permissions.json`：

- `single_purpose`：复制到单一用途说明。
- `permissions`：逐项复制权限理由。
- `host_permissions`：PDF 的 HTTP(S) 与 file 访问用途。
- `remote_code`：说明执行代码全部随扩展打包，模型回复是数据；本机桥/CLI 单独安装。
- `data_practices`：按后台当前定义申报文档内容、用于会话定位的文档/项目网址，以及用户和模型的对话。不能声明“不处理用户数据”或“全文离线”。

PDF 的广泛网站权限支持任意网站 PDF 检测、抓取与选区问答；它不能被描述成只访问 arXiv。解释中同时列出自动 PDF 打开开关与 file 权限的单独控制。隐私政策说明了全文上下文、附件/框图、模型服务、CLI 留存和 HTTP 后端。

勾选不出售数据、不用于与单一用途无关的目的、不用于信贷判断前，账号持有人需确认未来的实际运营也遵守这些声明。本材料描述的是当前源码行为。

## 6. 填 Test instructions，实际走一遍

分别复制 `overleaf/reviewer-notes.md` 或 `pdf/reviewer-notes.md` 的英文审核步骤。需要本机 Node、桥及已登录模型 CLI；Overleaf 的官网操作还需要测试用 Overleaf 项目。只安装扩展无法完成 Agent 调用。

先在自己的测试环境完成：安装 → 就绪 → 选段/框图 → 提交 → 看到真实回复 → Overleaf 审阅后应用与撤销 / PDF 刷新恢复会话。

如审核人员没有所需账号/额度，需通过后台专用测试说明提供合规可用的测试访问方式，或与审核团队确认测试安排。不要把自己的密码、令牌或 CLI 认证文件放入 ZIP、仓库或公开说明。该访问安排未由代码或截图替代。

## 7. 选择分发范围并提交

本次发布选择 **Public（公开）**，并选择**审核通过后自动发布**。确认地区、定价和账号信息，点击 **Submit for review**。公开发布仍须经过 Chrome Web Store 审核；提交成功或处于审核中不代表已经上架。后续修复和功能迭代上传更高版本，沿用同一个条目。

批准后：发布 → 用全新 Chrome 配置从商店安装 → 安装 companion → 完成上述真实流程 → 在 README 添加商店安装链接。测试应覆盖 macOS 和 Windows；PDF Windows 当前只有 HTTP 方式，不要写成已有 Windows 原生安装器。

## 检查记录与复现

- [检查结果](AUDIT.md)
- [隐私政策](PRIVACY.md)
- [图片来源和生成方式](ASSETS.md)
- 打包：`python3 tools/package-chrome.py`
- 材料合集：`python3 tools/bundle-store-materials.py`
- Overleaf：`npm test`、`npm run test:install`、`npm run test:ui`
- PDF：`npm test`、`npm run test:ui`

官方依据（2026-10-08 核对）：[准备 ZIP](https://developer.chrome.com/docs/webstore/prepare)、[商店字段](https://developer.chrome.com/docs/webstore/cws-dashboard-listing)、[图片规格](https://developer.chrome.com/docs/webstore/images)、[隐私与权限字段](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)、[审核测试说明](https://developer.chrome.com/docs/webstore/cws-dashboard-test-instructions)、[发布流程](https://developer.chrome.com/docs/webstore/publish)。
