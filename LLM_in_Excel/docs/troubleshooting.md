# Troubleshooting / 故障排查

[English guide](../README.md) · [中文指南](../README.zh-CN.md)

## macOS

```bash
launchctl kickstart -k gui/$(id -u)/com.llm_in_excel.server
tail -30 ~/.llm_in_excel/server.log
```

| Symptom / 现象 | What to check / 处理方式 |
| --- | --- |
| No LLM_in_Excel button / 找不到按钮 | Excel reads new add-in manifests at start-up. Quit it completely with Cmd+Q and reopen. If the button is still missing, open **Insert → Add-ins → My Add-ins → Developer Add-ins** once. / 装完需完全退出 Excel 再打开。 |
| “This add-in is no longer available” / 提示「此加载项不再可用」 | The manifest was added while Excel was running, or removed. Re-run `./install.sh`, then restart Excel. / 重跑安装脚本并重启 Excel。 |
| Blank pane / 空白侧栏 | Re-run `./install.sh`; it checks that the localhost certificate is trusted (`security verify-cert -c ~/.llm_in_excel/cert/localhost-cert.pem -p ssl -s localhost`). Make sure your proxy bypasses localhost. / 多半是证书信任或代理问题。 |
| Word or PowerPoint works, Excel does not / Word、PowerPoint 能用而 Excel 不能用 | They are separate services (8377, 8387 and 8397). Check `curl -s --noproxy '*' https://localhost:8397/api/ping`. / 三个服务分别检查。 |

## Windows

| Symptom / 现象 | What to check / 处理方式 |
| --- | --- |
| Script execution is blocked / 脚本被阻止 | Run `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install.ps1`. Domain policy may still block scripts. / 单位组策略仍可能限制脚本。 |
| No add-in in Excel / 找不到加载项 | Completely exit Excel and reopen. Look in **Home → Add-ins → Developer Add-ins**. Check the value under `HKCU\Software\Microsoft\Office\16.0\WEF\Developer`. / 完全重启 Excel。 |
| Service stopped / 服务停止 | `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\windows-service.ps1 -Action Restart`; log at `%LOCALAPPDATA%\LLM_in_Excel\server.log`. |

## Editing / 使用中

| Symptom / 现象 | Explanation / 处理 |
| --- | --- |
| “Contains merged cells” / 「含合并单元格」 | Ranges with merged cells cannot be targets. Unmerge them, or select only the unmerged part. / 先取消合并，或只选没合并的部分。 |
| “Too large” / 「太大了」 | A target can hold up to 2,000 cells (4,000 in total). Select only the rows or columns that need to change. Whole columns are trimmed to the used rows automatically. / 只选需要改的部分；整列会自动截到有数据的行。 |
| “Changed after it was sent” / 「发送后已变化」 | The range was edited while the answer was on screen. Click **Apply** again to overwrite it, or generate again. / 再点一次应用即覆盖。 |
| “The reply writes to cells outside the target that already have content” / 「回复要写入目标区域外已有内容的单元格」 | Nothing was written. Add those cells to the target (or select a larger range) and try again. / 把这些单元格也选进目标后重试。 |
| “The table in the reply does not map to cells” / 「回复里的表格对不上单元格」 | The reply had no row numbers and column letters and a different size. Click **🔁 Retry**. / 点「重试」。 |
| Formula error such as `#NAME?` / 公式出错（如 `#NAME?`） | Usually a misspelled or localized function name. The card names the cells; click **↩ Undo** and ask again, for example “use English function names”. / 一般是函数名写错；撤销后重新生成。 |
| “Held numbers and now hold text” / 「原来是数字，现在存成了文本」 | The reply put words into a number cell (for example “about 1,300”). Undo, or fix the cell by hand. / 撤销或手动改回。 |
| IDs lost their leading zeros / 编号的前导零丢了 | Should not happen through the pane: IDs are sent with a leading `'` and kept as text. If you typed them yourself without `'`, Excel stored numbers; format the column as Text before typing. / 手动输入时 Excel 会转成数字，先把列设为文本格式。 |
| Undo is unavailable / 无法撤销 | Undo refuses when a written cell was edited again after applying. Restore those cells by hand. / 应用后又改过的单元格只能手动改回。 |
| The answer ignores rows far down a big sheet / 大表下面的行没被看到 | Large sheets are sent in part (header rows, rows around each target, rows from the top). Add the relevant rows as a target, or ask about a narrower range. / 把相关的行选进目标。 |

When reporting a bug, include OS, Excel version, Node/CLI versions and a synthetic workbook. Do not attach real workbooks, tokens or proxy credentials. / 报错请用合成的工作簿。
