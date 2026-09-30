# Contributing / 参与开发

English · [中文](#中文)

LLM_in_Work contains three independent projects. In issues and pull requests, say whether a change concerns `LLM_in_Word`, `LLM_in_PowerPoint`, `LLM_in_Overleaf`, or the shared documentation / CI.

## Setup and tests

Use Node.js 22.12+ (22.x) or 24+. From the repository root:

```bash
npm --prefix LLM_in_Word ci
npm --prefix LLM_in_Word test              # formatting, tables, backend, pane, prompts
npm --prefix LLM_in_PowerPoint ci
npm --prefix LLM_in_PowerPoint test        # edit planning, deck context, pane against a PowerPoint stand-in, i18n, backend
npm --prefix LLM_in_Overleaf ci
npm --prefix LLM_in_Overleaf test          # native host, CLI adapters, prompts, i18n, activation
npm --prefix LLM_in_Overleaf run test:ui   # real CodeMirror, Chinese and English interfaces
npm --prefix LLM_in_Overleaf run test:ui:cn
npm --prefix LLM_in_Overleaf run test:install   # installer in a temporary home, then uninstall
```

Browser tests use Google Chrome at its standard macOS path; set `CHROME_BIN` to use another browser, or run `npx playwright-core install chromium` in `LLM_in_Overleaf/`. They use synthetic pages and mock model replies and never touch a real Overleaf project.

All `npm test` commands run offline with mock CLIs. Live model calls use `npm run test:live` or `npm run test:live:codex` in each project; they need a signed-in CLI, may consume quota, and are not part of CI.

**CI** tests all projects on Linux, macOS and Windows. Windows also runs the Word and PowerPoint installer lifecycles and the Overleaf installer; Linux runs the Overleaf browser regressions. CI does not automate desktop Word, desktop PowerPoint or a real Chrome profile.

## Conventions

- Plain JavaScript with two-space indentation; no build step unless it is really needed.
- Keep the extension / add-in IDs, legacy data paths and conversation keys compatible, and describe any migration.
- When you change write-back, re-check selection validation, that failed or partial replies cannot be applied, undo / tracked changes, and multi-target behaviour.
- UI text goes through the translation helpers: `LLM_in_Word/taskpane/i18n.js`, `LLM_in_PowerPoint/taskpane/i18n.js` and `LLM_in_Overleaf/extension/shared/i18n.js` (Chinese source string as key, English entry with the same `{0}` placeholders). Never pass document text, user input or model output to `known()`.
- When features or installation change, update the root overview and both language versions of the affected project's README.
- More project notes: [LLM_in_Word](LLM_in_Word/CONTRIBUTING.md) · [LLM_in_PowerPoint](LLM_in_PowerPoint/CONTRIBUTING.md).

Reproduce problems with synthetic documents and redacted logs. Do not commit credentials, private keys, certificates, CLI sessions, personal documents, `node_modules/` or machine-specific configuration. By contributing you confirm that you may provide the code and agree to distribute it under the repository's [MIT license](LICENSE).

---

## 中文

LLM_in_Work 包含三个独立子项目。请在 Issue 和 Pull Request 中注明涉及 `LLM_in_Word`、`LLM_in_PowerPoint`、`LLM_in_Overleaf`，还是仓库公共文档 / CI。

### 开发与测试

使用 Node.js 22.12+（22.x）或 24+。上面的命令在仓库根目录运行：`test` 为离线回归，`test:ui` 用真实 CodeMirror 同时测中文和英文界面，`test:install` 在临时目录里完成「安装 → 本机桥应答 → 卸载」。

浏览器测试默认使用 macOS 标准路径下的 Google Chrome，可用 `CHROME_BIN` 指定其他浏览器，或在 `LLM_in_Overleaf/` 中执行 `npx playwright-core install chromium`。测试使用合成页面和模拟回复，不会连接真实 Overleaf 项目。

`npm test` 全部离线运行、使用模拟 CLI。真实模型调用使用各子项目的 `npm run test:live` 或 `npm run test:live:codex`，需要已登录的 CLI，可能消耗额度，不在 CI 中运行。

**CI** 在 Linux、macOS、Windows 上测试所有子项目；Windows 另测 Word、PowerPoint 的安装生命周期和 Overleaf 安装器，Linux 另跑 Overleaf 浏览器回归。CI 不自动操作桌面 Word 和 PowerPoint，也不使用真实 Chrome 用户配置。

### 修改约定

- 保持原生 JavaScript 和两空格缩进，不引入无必要的构建步骤。
- 保留扩展 / 加载项 ID、旧数据路径和会话键的兼容性；改动时写明迁移方式。
- 修改写回流程时，验证选区校验、失败或不完整的回复不可应用、撤销 / 修订、多目标行为。
- 界面文案统一经过翻译函数：`LLM_in_Word/taskpane/i18n.js`、`LLM_in_PowerPoint/taskpane/i18n.js` 与 `LLM_in_Overleaf/extension/shared/i18n.js`（中文原文作键，英文条目保留相同的 `{0}` 占位符）。不要把文档正文、用户输入或模型回复交给 `known()`。
- 功能或安装方式变化时，同步更新根目录总览和对应子项目的中英文 README。
- 子项目专项说明见 [LLM_in_Word](LLM_in_Word/CONTRIBUTING.md) · [LLM_in_PowerPoint](LLM_in_PowerPoint/CONTRIBUTING.md)。

请用合成文档和脱敏日志复现问题。不要提交凭证、私钥、证书、CLI 会话、个人文档、`node_modules/` 或本机生成的配置。提交贡献即表示你有权提供相应代码，并同意以本仓库的 [MIT 许可证](LICENSE) 分发。
