$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent
$Base = Join-Path $env:LOCALAPPDATA 'LLM_in_Word'
$Manager = Join-Path $Base 'app\tools\windows-service.ps1'
# CurrentUser Root trust requires an interactive Windows security dialog.
# CI validates PFX/HTTPS with an explicit CA, and skips OS trust rather than changing security policy.
# Only the isolated CI runner uses mocked model CLIs. No account or Word required.
$env:LLM_IN_WORD_CLAUDE_BIN = Join-Path $PSScriptRoot 'fixtures\mock-cli.cjs'
$env:LLM_IN_WORD_CODEX_BIN = $env:LLM_IN_WORD_CLAUDE_BIN
Get-ChildItem $Root -Filter '*.ps1' -Recurse | Where-Object { $_.FullName -notmatch 'node_modules' } | ForEach-Object {
    $Tokens = $null; $Errors = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile($_.FullName, [ref]$Tokens, [ref]$Errors)
    if ($Errors.Count) { throw ($Errors | Out-String) }
}
try {
    & (Join-Path $Root 'install.ps1') -SkipCertificateTrust
    $Value = Get-ItemPropertyValue 'HKCU:\Software\Microsoft\Office\16.0\WEF\Developer' '357a0a80-3537-4833-b135-a8177994730f'
    if ($Value -ne (Join-Path $Base 'app\manifest.xml')) { throw 'Manifest registration failed.' }
    $Shortcut = Join-Path ([Environment]::GetFolderPath('Startup')) 'LLM_in_Word.lnk'
    if (!(Test-Path $Shortcut)) { throw 'Login startup shortcut missing.' }
    & (Join-Path $Root 'install.ps1') -UpdateOnly -SkipCertificateTrust
    & $Manager -Action Restart
    & node (Join-Path $Root 'tools\check-install.js') (Join-Path $Base 'cert')
    if ($LASTEXITCODE -ne 0) { throw 'Restart failed.' }
    & $Manager -Action Uninstall
    if (Test-Path $Shortcut) { throw 'Uninstall did not remove startup shortcut.' }
    $Value = (Get-Item 'HKCU:\Software\Microsoft\Office\16.0\WEF\Developer').GetValue('357a0a80-3537-4833-b135-a8177994730f')
    if ($Value) { throw 'Uninstall did not unregister manifest.' }
    $Thumb = [IO.File]::ReadAllText((Join-Path $Base 'cert\thumbprint.txt')).Trim()
    if (Test-Path "Cert:\CurrentUser\Root\$Thumb") { throw 'Uninstall did not remove localhost trust.' }
    Write-Host 'Windows install, update, restart, TLS validation and uninstall passed.'
} finally {
    if (Test-Path $Manager) { & $Manager -Action Stop }
}
