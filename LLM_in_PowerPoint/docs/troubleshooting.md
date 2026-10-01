# Troubleshooting / 故障排查

[English guide](../README.md) · [中文指南](../README.zh-CN.md)

## macOS

```bash
launchctl kickstart -k gui/$(id -u)/com.llm_in_powerpoint.server
tail -30 ~/.llm_in_powerpoint/server.log
```

| Symptom / 现象 | What to check / 处理方式 |
| --- | --- |
| No LLM_in_PowerPoint button / 找不到按钮 | PowerPoint reads new add-in manifests at start-up. Quit it completely with Cmd+Q and reopen. If the button is still missing, open **Insert → Add-ins → My Add-ins → Developer Add-ins** once. / 装完需完全退出 PowerPoint 再打开。 |
| “This add-in is no longer available” / 提示「此加载项不再可用」 | The manifest was added while PowerPoint was running, or removed. Re-run `./install.sh`, then restart PowerPoint. / 重跑安装脚本并重启 PowerPoint。 |
| Blank pane / 空白侧栏 | Re-run `./install.sh`; it checks that the localhost certificate is trusted (`security verify-cert -c ~/.llm_in_powerpoint/cert/localhost-cert.pem -p ssl -s localhost`). Make sure your proxy bypasses localhost. / 多半是证书信任或代理问题。 |
| Word add-in works, PowerPoint does not / Word 能用 PowerPoint 不能用 | They are separate services (8377 and 8387). Check `curl -s --noproxy '*' https://localhost:8387/api/ping`. / 两个服务分别检查。 |

## Windows

| Symptom / 现象 | What to check / 处理方式 |
| --- | --- |
| Script execution is blocked / 脚本被阻止 | Run `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install.ps1`. Domain policy may still block scripts. / 单位组策略仍可能限制脚本。 |
| No add-in in PowerPoint / 找不到加载项 | Completely exit PowerPoint and reopen. Look in **Home → Add-ins → Developer Add-ins**. Check the value under `HKCU\Software\Microsoft\Office\16.0\WEF\Developer`. / 完全重启 PowerPoint。 |
| Service stopped / 服务停止 | `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\windows-service.ps1 -Action Restart`; log at `%LOCALAPPDATA%\LLM_in_PowerPoint\server.log`. |

## Editing / 使用中

| Symptom / 现象 | Explanation / 处理 |
| --- | --- |
| “Add selection” adds the whole slide / 添加了整页 | Nothing was selected, so the current slide was added. Select words or a shape first, or remove unwanted targets in Settings. / 没选中内容时会加整页。 |
| “The original text was changed or deleted” / 「目标原文已被改动或删除」 | A partial target is found by its original text. After editing those words yourself, add them again. / 手动改过的文字请重新添加。 |
| “Changed after it was sent” / 「发送后已变化」 | The target was edited while the answer was on screen. Click **Apply** again to overwrite it, or generate again. / 再点一次应用即覆盖。 |
| Undo is unavailable / 无法撤销 | Undo only works while the applied text is unchanged. Restore by hand, or try PowerPoint's own Undo. / 应用后又改过就只能手动改回。 |
| Text overflows the box / 文字溢出 | Ask for shorter text, or let PowerPoint's AutoFit shrink it. Attach a **Slide image** so the model can see the space. / 附上当前页截图让模型看空间。 |
| Table cannot be applied / 表格不能应用 | Column changes and merged cells are not supported; adding or removing rows needs PowerPointApi 1.9. / 列数变化、合并单元格暂不支持。 |
| “The format plan could not be read” / 「格式方案没能解析」 | The reply had no valid ```` ```format ```` JSON (often because the model only explained what to do by hand). Click **🔁 Retry**, or say exactly which property to change. / 点「重试」或说得更具体。 |
| “This shape is outside the selection” / 「这个形状不在修改范围内」 | Format mode only changes the shapes that were selected when you clicked **Plan**. Select every shape you want changed, or nothing for the whole slide, and generate again. / 把要改的形状都选上，或者什么都不选（整页）再生成。 |
| “… is out of range” or “… is not reasonable” / 「超出范围」「不合理」 | The plan had an implausible value (font size, line weight, a shape far off the slide). That item was skipped; the rest can be applied. / 这一项已跳过，其他项照常应用。 |
| “This version of PowerPoint does not let add-ins …” / 「这个版本的 PowerPoint 不能通过插件……」 | Rotation, background and theme colours need PowerPointApi 1.10, table formatting 1.9, stacking order 1.8. Update PowerPoint, or change it by hand. / 升级 PowerPoint 或手动修改。 |
| A table shows “table style” as the old value / 表格旧值显示「表格样式」 | The table's colours come from its table style, which add-ins cannot read. The model goes by the slide image. / 表格颜色来自表格样式，加载项读不到，模型按截图判断。 |
| After Undo, table header text is black / 撤销后表头文字变黑 | Text colour and bold drawn by a table style cannot be read or restored; the card warned before applying. Set the header text colour and bold back by hand (re-applying the table style does not reset text that was formatted directly). / 表格样式的文字颜色读不到也还原不了，请手动设回。 |
| Font changed for the whole box / 整个文本框的字体都变了 | Format mode sets the font for all text in a shape. To style a few words, select them and use PowerPoint's own font controls. / 只改几个字请用 PowerPoint 自己的字体按钮。 |
| Format Undo left a plain fill / 撤销后填充变成了无填充 | Gradient, pattern and picture fills cannot be restored through the add-in; the card warned before applying. Re-apply the fill by hand. / 渐变或图片填充无法通过插件还原，请手动设回。 |
| SmartArt, charts, notes / SmartArt、图表、备注 | Not reachable through PowerPoint's add-in API. / 加载项接口读写不到。 |
| New Chinese text uses another font (e.g. SimSun) / 新写入的中文字体不一样（如宋体） | PowerPoint gives new Chinese text the theme's Chinese font. If the existing text is not tagged as Chinese (common in decks generated by scripts), it may be showing a fallback font instead. Set the theme fonts (Design → Variants → Fonts) or apply the font to the text box. / 新写入的中文使用主题的中文字体；原文没有标记为中文（脚本生成的文稿常见）时显示的是替代字体。在「设计 → 变体 → 字体」里设好主题字体，或给文本框统一设置字体。 |

When reporting a bug, include OS, PowerPoint version, Node/CLI versions and a synthetic deck. Do not attach real presentations, tokens or proxy credentials. / 报错请用合成的演示文稿。
