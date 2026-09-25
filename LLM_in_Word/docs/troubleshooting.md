# Troubleshooting / 故障排查

[English guide](../README.md) · [中文指南](../README.zh-CN.md)

## Windows

| Symptom / 现象 | What to check / 处理方式 |
| --- | --- |
| Installer cannot find Node / 找不到 Node | Install Node.js 22.12+ (22.x) or 24+. Reopen PowerShell; check `node --version`. / 安装后重新打开终端。 |
| Script execution is blocked / 脚本执行被阻止 | Run `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install.ps1`. This is process-scoped. Domain policy may still block scripts; ask the administrator rather than changing global policy. / 单位组策略仍可能限制脚本。 |
| No add-in in Word / 找不到加载项 | Completely exit Word and reopen. Look in Home → Add-ins → Developer Add-ins. Check the registry value under `HKCU\Software\Microsoft\Office\16.0\WEF\Developer`; reinstall if missing. / 完全重启 Word，重新安装可恢复注册。 |
| Blank pane / 空白侧栏 | Verify the installer passed HTTPS checks. Re-run installation to restore current-user certificate trust. Ensure Word/Edge WebView2 is updated and your proxy bypasses localhost. / 检查证书、WebView2 与代理绕过。 |
| CLI missing / 未找到 CLI | Use native Windows Claude/Codex. A WSL-only install is insufficient. Run `where.exe claude` / `where.exe codex`; set `LLM_IN_WORD_CLAUDE_BIN` / `LLM_IN_WORD_CODEX_BIN` before reinstalling if needed. / 支持原生 exe 和官方 npm 入口。 |
| Service stopped / 后台服务停止 | Run `tools\windows-service.ps1 -Action Status` or `-Action Restart` via PowerShell. Inspect `%LOCALAPPDATA%\LLM_in_Word\server.log`. / 连接设置也会显示日志位置。 |
| Does not start at sign-in / 登录未自启 | Check Windows Settings → Apps → Startup and the `LLM_in_Word.lnk` shortcut in your user Startup folder. Reinstall if the shortcut was removed. / 启动项被系统禁用时需手动恢复。 |
| Certificate expired / 证书过期 | Uninstall, rename the local `cert` directory as a backup, then reinstall to issue a fresh certificate. / 保留旧证书备份，再重新生成。 |

Windows lifecycle commands (run from the source repository):

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\windows-service.ps1 -Action Status
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\windows-service.ps1 -Action Restart
Get-Content "$env:LOCALAPPDATA\LLM_in_Word\server.log" -Tail 30
```

## macOS

Fresh installs use `~/.llm_in_word`; upgrades keep an existing `~/.word_edit`. / 新安装使用新目录，旧安装沿用原目录。

```bash
launchctl kickstart -k gui/$(id -u)/com.llm_in_word.server
# Use ~/.word_edit/server.log for a legacy installation.
tail -30 ~/.llm_in_word/server.log
```

If the pane is blank, re-run `./install.sh` and check the localhost certificate in Keychain Access. If your Word build exposes add-ins under Home rather than Insert, use Home → Add-ins → Developer Add-ins. Completely quit Word with Cmd+Q after manifest changes. / 空白面板优先检查钥匙串信任；清单更新后需完全退出 Word。

## Both platforms / 通用问题

| Symptom / 现象 | Explanation / 处理 |
| --- | --- |
| “Not logged in” / 需要登录 | Run `claude auth login` or `codex login` as the same OS user. Click Check again afterward. / 用运行 Word 的同一用户登录。 |
| Connection check is green but generation fails / 检测正常但生成失败 | Health checks inspect CLI and login state without model generation. Check provider access, proxy, account limits, or model availability. / 状态检测不等同于模型网络连通性验证。 |
| Proxy port changed / 代理端口变化 | Re-run `npm run update` with the new proxy environment. The installer persists those settings for background processes. / 从配置了新代理的终端重新更新。 |
| Stalled request / 请求停滞 | The backend sends a heartbeat every 15 seconds. The pane has a 45-second stream watchdog; the default CLI timeout is 5 minutes. Retry or inspect logs if repeated. / 可停止生成，排查后重试。 |
| Partial answer cannot be applied / 半截结果不能应用 | Intentional: only a completed, successful response is eligible for writing into Word. / 防止中断结果覆盖正文。 |
| Selection differs from model context / 选了一段却读取全文 | Targets limit write locations; document text supplies context. See the README data section. / 这是当前设计。 |
| Formatting changes / 格式变化 | Complex HTML can fall back to plain text. Review a copy and keep tracked changes enabled. / 复杂文档需要人工检查。 |

When reporting a bug, include OS, Word version, Node/CLI versions, and a synthetic example. Do not attach real document content, tokens, or proxy credentials. / 报错请使用合成示例，删除敏感内容。
