# 参与开发

感谢帮助改进 LLM_in_PowerPoint。请用合成的演示文稿描述问题，不要上传真实客户文件、账户信息或带凭证的日志。

## 开发环境

- Node.js 22.12+（22.x）或 24+
- `npm ci` 安装开发依赖
- `npm test` 运行离线测试：改动规划、上下文组装、面板在模拟 PowerPoint 上的完整流程、界面、翻译、提示词和后端
- `npm run preview` 打开本地 HTTP 预览；读取和写回幻灯片需要在 Windows 或 macOS 的 PowerPoint 加载项里测试

自动测试使用 `tools/fixtures/mock-cli.cjs` 和 `tools/fixtures/fake-powerpoint.js`，不需要安装 Claude Code / Codex，也不需要 PowerPoint。真实调用需要自行登录相应 CLI，使用 `npm run test:live` 或 `npm run test:live:codex`；不要把账户凭证加入 CI。

## 修改约定

- 保持原生 JavaScript 和两空格缩进，不引入不必要的构建步骤。
- 目标定位（页 ID + 形状 ID + 字符位置 + 原文核对）、只改变化片段的写回、撤销和表格行对齐是核心边界，改动时补充 `tools/test-deck.js` 里的用例。
- `fake-powerpoint.js` 只模拟在真实 PowerPoint 里观察到的行为；发现新的 PowerPoint 行为时，先在真实 PowerPoint 里确认，再同步到模拟器并在注释里写明。
- 修改流式协议时同时更新服务端和面板；失败或中断的输出不得作为可应用的结果。
- 界面文字使用 `taskpane/i18n.js` 的 `t`，静态 HTML 用 `data-i18n`；新增文字同时补英文翻译（`npm test` 会检查是否齐全）。服务端已有提示用 `known` 翻译，不要把幻灯片内容、用户输入或模型回复交给它。
- 新功能或行为变动同步更新 README.md、README.zh-CN.md 和 CHANGELOG.md。

## 提交与 Pull Request

请说明解决的问题、修改后的行为，以及执行过的测试。界面调整请附使用合成内容的截图，并检查 320px 窄栏。提交前运行 `npm test` 和 `bash -n install.sh`。

不要提交 `node_modules/`、`.env`、证书、CLI 会话、日志或个人文件。提交贡献表示你有权提供相应代码，并同意以仓库的 MIT 许可证分发。
