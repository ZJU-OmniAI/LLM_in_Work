# LLM_in_Overleaf

[← LLM_in_Work 首页](../README.zh-CN.md) · [LLM_in_Word](../LLM_in_Word/README.zh-CN.md)

**在 Overleaf 中选中 LaTeX，审阅 AI 修改，再写回源码。**

[English](README.md) · 简体中文

选中同一 `.tex` 文件中的一段或多段内容，输入修改要求，逐段查看差异，再一次应用。扩展通过 Chrome Native Messaging 调用本机的 **Claude Code / Codex CLI**，沿用已有登录，无需另配 API key 或手动启动服务。

## 可以做什么

| 功能 | 实际用途 |
| --- | --- |
| LaTeX 改写 | 学术润色、语法修正、精简、扩写、翻译和公式表达调整。 |
| 多个不连续选段 | 收集同一源码文件中的多处内容，用一条指令统一修改。 |
| 先看差异，再应用 | 通过「对比」查看新增和删除，也可直接阅读「新文本」。 |
| 写回前校验 | 核对文件名和原文；选段失效或替换稿不完整时拒绝应用。整组修改可一次撤销。 |
| 文档问答 | 围绕选段或当前源码提问，无需替换内容。 |
| 参考附件 | 添加项目其他文件、本地文本、图片或 PDF，实际读取能力取决于后端。 |
| 多轮与历史 | 继续细化、按项目恢复历史、导出 Markdown、开启新会话。 |
| 后端控制 | 切换 Claude / Codex、模型和思考强度，检测连接、停止生成。 |
| 阅读模式 | 放大回复区域，返回后保留输入草稿。 |

当前界面为**简体中文**，支持 Overleaf 主站和 `cn.overleaf.com` 中文站。随项目提供的安装器面向 **macOS 的 Chrome / Chromium 浏览器**；Windows / Linux 暂无受支持的安装流程。修改需要在 **Code Editor（源码编辑）**中进行，不能通过 PDF 预览或可视化编辑器选区写回。

## 安装（macOS）

准备 Node.js **22.12+（22.x）或 24+**，安装至少一个本机后端，并通过 `claude auth login` 或 `codex login` 登录。

```bash
git clone https://github.com/ZJU-OmniAI/LLM_in_Work.git
cd LLM_in_Work/LLM_in_Overleaf
./install.sh
```

Chrome 打开 `chrome://extensions` → 开启**开发者模式** → **加载已解压的扩展程序** → 选择本子项目的 **`LLM_in_Overleaf/extension`** 目录。

安装器注册本机消息桥，把当前 Node 路径、CLI 路径覆盖和代理环境写入仅当前用户可访问的启动脚本。浏览器按需拉起桥程序，不监听端口，也不需要你手动启动后台服务。日常使用无需 `npm ci`。

## 第一次改写

1. 在 Overleaf **Code Editor** 中打开 `.tex` 文件，选中一段源码。
2. 点击浮标 **✦ 改这段**、右下角 **✦ 写作助手**，或扩展弹窗中的 **打开写作助手**。
3. 需要多段时，继续选择同一文件中的其他内容，点击 **＋ 添加选段**。
4. 输入要求，例如：“润色学术表达，保留全部引用、数字和公式，不增加新结论。”
5. 在 **对比** 或 **新文本** 中审阅结果；不满意可继续输入要求。
6. 点击 **应用替换** 或 **应用全部选段**。整组修改通过一个 CodeMirror 编辑事务写回，可用 **Cmd+Z** 一次撤销。

应用成功后当前整组选段会清空，对话仍保留。只提问时，在设置中切换为 **问答**。**⌘⇧E** 开合侧栏；点击 **阅读** 放大回复区域，通过 **返回** 或 Esc 恢复输入。

## 上下文和附件

首轮会把**当前 `.tex` 文件**作为上下文，而不只是选区；超长文件会缩减为导言区和目标附近内容。可兼容的后续轮次复用 CLI 会话，并发送新的要求、目标和附件。手动大改文档后，建议通过 **开新会话** 刷新全文上下文。缓存命中和计费由服务商决定，不保证固定折扣。

- **项目文件**：通过 Overleaf 下载源码接口读取文件，支持把 `.tex`、`.bib`、`.cls`、`.sty` 等文本加入参考。
- **本地文件**：添加本机文本、图片和 PDF。PDF 通常优先使用 Claude 后端，具体能力随 CLI 和模型变化。
- 面板最多允许 8 个附件；单个图片 / PDF 不超过 10 MB，合计不超过 25 MB。二进制附件由桥程序临时落盘，请求结束后清理。

会话按 Overleaf 项目保存在浏览器扩展存储中，CLI 也可能保存提示和回复。桥在本机运行，模型推理通常连接相应服务商。详见[安全与数据说明](../SECURITY.md)。

## 从 overleaf_edit 迁移

扩展现在显示为 **LLM_in_Overleaf**。为兼容已有安装，manifest 公钥和扩展 ID 保持不变，本机桥名 `com.overleaf_edit.host`、运行目录 `~/.overleaf_edit`、`OVERLEAF_EDIT_*` 环境变量和会话键继续沿用。

源码合并到本仓库后：

1. 在 `LLM_in_Work/LLM_in_Overleaf` 中运行 `./install.sh`，更新本机桥所指向的源码路径。
2. 在 `chrome://extensions` 使用 **加载已解压的扩展程序**，选择新的 `LLM_in_Overleaf/extension` 目录，然后刷新 Overleaf。希望保留历史时，不要先删除旧扩展。
3. 后续同路径更新，执行 `git pull --ff-only`，重新加载扩展并刷新网页即可。源码路径、Node / CLI 路径或代理变化时，重新运行安装器。

仓库不分发扩展打包私钥，加载和运行解压扩展不需要该私钥。

## 常见问题

| 症状 | 处理 |
| --- | --- |
| 选中了文字，没有浮标 | 确认选中的是 Code Editor 源码；从右下角入口或扩展弹窗打开后，点击「添加选段」。 |
| 本机桥未就绪 | 在本子项目目录运行 `./install.sh`，再检查扩展弹窗的连接状态。 |
| 移动目录后无法使用 | 重新运行安装器，并从新路径加载扩展。 |
| 拒绝应用替换 | 切回原文件，或重新选择已经修改过的原文。过时目标会被拒绝。 |
| CLI 登录或网络失败 | 在终端检查 CLI；代理或路径变更后重跑安装器。 |
| 自建 Overleaf | 需同时修改 manifest 两处 `matches` 和后台脚本的网址校验；默认不支持。 |

## 开发与测试

在 `LLM_in_Overleaf/` 中运行：

```bash
npm ci
npm test                   # 离线回归，不需要模型账号
npm run test:ui            # 真实 CodeMirror，合成页面与模拟回复
npm run test:ui:cn         # 中文站选区与开启入口回归
```

macOS 默认使用标准路径下的 Google Chrome，可用 `CHROME_BIN` 指定其他路径。Linux CI 使用 `npx playwright-core install --with-deps chromium` 安装测试浏览器。浏览器测试不会修改真实 Overleaf 项目。

可选的真实后端测试需要登录，可能消耗模型额度：

```bash
npm run test:live
npm run test:live:codex
npm run test:wrapper       # 通过 ~/.overleaf_edit/host.sh 验证已安装桥
```

技术结构：`extension/content/bridge.js` 在页面 MAIN world 访问 CodeMirror；`content.js` 提供面板；`background/service-worker.js` 通过原生消息连接 `server/native-host.js`，再调用选定的 CLI。

## 卸载

在浏览器中移除扩展。移除 Chrome 消息桥注册和本地启动目录：

```bash
rm "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.overleaf_edit.host.json"
rm -rf "$HOME/.overleaf_edit"
```

如同时安装了其他 Chromium 浏览器，还需删除对应的本机桥注册文件。CLI 管理的会话历史独立存在。

[更新记录](CHANGELOG.md) · [参与开发](../CONTRIBUTING.md) · [MIT 许可证](../LICENSE)
