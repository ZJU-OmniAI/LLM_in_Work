# 参与开发 / Contributing

LLM_in_Work 包含两个独立子项目。请在 Issue 和 Pull Request 中说明涉及 `LLM_in_Word`、`LLM_in_Overleaf`，还是仓库公共文档 / CI。

使用 Node.js 22.12+（22.x）或 24+。以下命令在仓库根目录运行：

```bash
npm --prefix LLM_in_Word ci
npm --prefix LLM_in_Word test
npm --prefix LLM_in_Overleaf ci
npm --prefix LLM_in_Overleaf test
npm --prefix LLM_in_Overleaf run test:ui
npm --prefix LLM_in_Overleaf run test:ui:cn
```

Overleaf 浏览器测试默认使用 macOS 的 Google Chrome；可通过 `CHROME_BIN` 指定浏览器，或在子目录执行 `npx playwright-core install chromium` 安装测试浏览器。测试使用真实 CodeMirror 编辑器、合成页面和模拟模型回复，不连接真实 Overleaf 项目。

CI 在 Linux、macOS、Windows 上测试 Word；Windows 还测试安装和服务生命周期，但不包含桌面 Word 交互。Overleaf 的离线测试在 Linux / macOS 上运行，Linux 另跑主站和中文站地址下的浏览器回归。

`npm test` 对两个子项目都只运行离线测试。真实模型调用使用各自的 `npm run test:live` 或 `npm run test:live:codex`，需要登录且可能消耗额度，不在 CI 中运行。

## 修改约定

- 保持原生 JavaScript 和两空格缩进，不引入无必要的构建步骤。
- 保留扩展 / 加载项 ID、旧数据路径和会话键的兼容性；改动时说明迁移方式。
- 修改写回流程时，验证选区校验、失败结果不可应用、撤销 / 修订和多目标行为。
- 功能和安装方式变动时，同步更新根目录导航和对应子项目的中英文文档。
- Word 界面翻译及格式迁移约定见 [Word 开发指南](LLM_in_Word/CONTRIBUTING.md)。

请使用合成文档和去除敏感信息的日志复现问题。不要提交凭证、私钥、证书、CLI 会话、个人文档、`node_modules/` 或本机生成的配置。提交贡献表示你有权提供相应代码，并同意以本仓库的 [MIT 许可证](LICENSE) 分发。
