# 参与开发

感谢帮助改进 LLM_in_Word。请用合成文档描述问题，避免上传真实客户文件、未发表论文、账户信息或日志中的凭证。

## 开发环境

- Node.js 22.12+（22.x）或 24+
- `npm ci` 安装开发依赖
- `npm test` 运行格式、表格、后端和界面回归测试
- `npm run preview` 打开本地 HTTP 预览；实际读取与写回文档需在 Windows 或 macOS Word 加载项中测试

自动测试使用 `tools/fixtures/mock-cli.cjs`，不需要安装 Claude Code / Codex，也不调用真实模型。真实调用需自行登录相应 CLI，使用 `npm run test:live` 或 `npm run test:live:codex`；请勿把账户凭证加入 CI。

## 修改约定

- 保持原生 JavaScript 与现有两空格缩进，不引入无必要的构建步骤。
- 目标内容控件、格式迁移、修订写入、表格更新是核心兼容性边界；修改时验证相应回归用例。
- 新增 CLI 参数时核对本机 `--help`，并覆盖失败、取消、异常退出和空结果。
- 修改流式协议时同时更新服务端与面板，失败的部分输出不得作为可应用结果。
- UI 文案使用 `taskpane/i18n.js` 的 `t`（字符串或带参数模板），静态 HTML 使用 `data-i18n`；新增文案同时补英文映射和占位符。服务端已有提示用 `known` 翻译，禁止把文档正文、用户输入或模型回复交给该函数。
- 新功能或行为变动同步更新英文 README.md、中文 README.zh-CN.md 与 CHANGELOG。

## 提交与 Pull Request

请说明解决的问题、修改后的行为，以及执行的测试。界面调整可附使用合成内容的截图，并检查 320px 窄栏。提交前运行 `npm test` 和 `bash -n install.sh`。

不要提交 `node_modules/`、`.backups/`、`.env`、证书、CLI 会话、日志或个人文档。提交贡献表示你有权提供相应代码，并同意以仓库的 MIT 许可证分发。
