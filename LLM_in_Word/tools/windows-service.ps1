[CmdletBinding()]
param(
    [ValidateSet('Start','Stop','Restart','Status','Uninstall')][string]$Action = 'Status',
    [string]$Base = (Join-Path $env:LOCALAPPDATA 'LLM_in_Word')
)
$ErrorActionPreference = 'Stop'
$Runner = Join-Path $Base 'app\tools\windows-runner.js'
function Get-Runner {
    $PidFile = Join-Path $Base 'runner.pid'
    if (!(Test-Path $PidFile)) { return $null }
    $RunnerId = 0
    if (![int]::TryParse(([IO.File]::ReadAllText($PidFile)).Trim(), [ref]$RunnerId)) { return $null }
    $Process = Get-CimInstance Win32_Process -Filter "ProcessId=$RunnerId" -ErrorAction SilentlyContinue
    if ($Process -and $Process.CommandLine -and $Process.CommandLine.Contains($Runner)) { return $Process }
    return $null
}
$Running = Get-Runner
if ($Action -eq 'Status') {
    if ($Running) { Write-Host "LLM_in_Word running (PID $($Running.ProcessId)); log: $Base\server.log" }
    else { Write-Host 'LLM_in_Word stopped.' }
    return
}
if ($Action -in @('Stop','Restart','Uninstall') -and $Running) {
    & taskkill.exe /PID $Running.ProcessId /T /F | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not stop LLM_in_Word.' }
    # Wait for the supervisor and its file handles to close before replacing files.
    Wait-Process -Id $Running.ProcessId -Timeout 10 -ErrorAction SilentlyContinue
}
if ($Action -eq 'Uninstall') {
    $Reg = 'HKCU:\Software\Microsoft\Office\16.0\WEF\Developer'
    Remove-ItemProperty -Path $Reg -Name '357a0a80-3537-4833-b135-a8177994730f' -ErrorAction SilentlyContinue
    Remove-Item (Join-Path ([Environment]::GetFolderPath('Startup')) 'LLM_in_Word.lnk') -Force -ErrorAction SilentlyContinue
    $ThumbFile = Join-Path $Base 'cert\thumbprint.txt'
    if (Test-Path $ThumbFile) {
        $Thumb = ([IO.File]::ReadAllText($ThumbFile)).Trim()
        if ($Thumb -match '^[A-Fa-f0-9]{40}$') {
            foreach ($Store in @('Root','My')) { Remove-Item "Cert:\CurrentUser\$Store\$Thumb" -ErrorAction SilentlyContinue }
        }
    }
    Write-Host "Unregistered and stopped. Local data retained at $Base; remove it manually if no longer needed."
    return
}
if ($Action -in @('Start','Restart')) {
    if ($Action -eq 'Start' -and $Running) { Write-Host 'Already running.'; return }
    $Config = Get-Content (Join-Path $Base 'runtime.json') -Raw | ConvertFrom-Json
    Start-Process -FilePath $Config.node -ArgumentList ('"' + $Runner + '" "' + $Base + '"') -WorkingDirectory $Base -WindowStyle Hidden
}
