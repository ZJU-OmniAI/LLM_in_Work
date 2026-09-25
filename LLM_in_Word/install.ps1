# Windows PowerShell 5.1+. Run as the Windows user who runs Word (no admin required).
[CmdletBinding()]
param([switch]$UpdateOnly, [switch]$SkipCertificateTrust)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Use install.sh on macOS.' }
$Base = Join-Path $env:LOCALAPPDATA 'LLM_in_Word'
$App = Join-Path $Base 'app'
$CertDir = Join-Path $Base 'cert'
$Node = (Get-Command node.exe -ErrorAction Stop).Source
& $Node -e "const [a,b]=process.versions.node.split('.').map(Number);if(!((a===22&&b>=12)||a>=24))process.exit(1)"
if ($LASTEXITCODE -ne 0) { throw 'Install Node.js 22.12+ (22.x) or 24+ first.' }
if ($UpdateOnly -and !(Test-Path (Join-Path $CertDir 'localhost.pfx'))) { throw 'Run install.ps1 once before updating.' }
New-Item -ItemType Directory -Force -Path $Base, $CertDir | Out-Null
# The runtime includes a private localhost key and potentially proxy credentials.
$Identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$Acl = Get-Acl $Base
$Acl.SetAccessRuleProtection($true, $false)
foreach ($Sid in @($Identity, [System.Security.Principal.SecurityIdentifier]'S-1-5-18', [System.Security.Principal.SecurityIdentifier]'S-1-5-32-544')) {
    $Rule = New-Object System.Security.AccessControl.FileSystemAccessRule($Sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $Acl.AddAccessRule($Rule)
}
Set-Acl -Path $Base -AclObject $Acl

$Pfx = Join-Path $CertDir 'localhost.pfx'
if (!(Test-Path $Pfx)) {
    Write-Host 'Creating a localhost certificate in the current-user certificate store...'
    $Cert = New-SelfSignedCertificate -Subject 'CN=LLM_in_Word-localhost' -Provider 'Microsoft Software Key Storage Provider' -KeyProtection None -Type Custom -KeyUsage DigitalSignature,KeyEncipherment -CertStoreLocation 'Cert:\CurrentUser\My' -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 -KeyExportPolicy Exportable -NotAfter (Get-Date).AddDays(365) -TextExtension @('2.5.29.17={text}DNS=localhost&IPAddress=127.0.0.1', '2.5.29.37={text}1.3.6.1.5.5.7.3.1')
    Write-Host 'Local certificate created; exporting the private key...'
    $Password = [Guid]::NewGuid().ToString('N') + [Guid]::NewGuid().ToString('N')
    Export-PfxCertificate -Cert $Cert -FilePath $Pfx -Password (ConvertTo-SecureString $Password -AsPlainText -Force) -CryptoAlgorithmOption AES256_SHA256 | Out-Null
    [IO.File]::WriteAllText((Join-Path $CertDir 'pfx-password.txt'), $Password)
    Write-Host 'Private key exported; exporting the public certificate...'
    Export-Certificate -Cert $Cert -FilePath (Join-Path $CertDir 'localhost.cer') | Out-Null
    [IO.File]::WriteAllText((Join-Path $CertDir 'thumbprint.txt'), $Cert.Thumbprint)
}
# Trust only this localhost certificate for this Windows user. Windows may prompt.
if ($SkipCertificateTrust) {
    Write-Warning 'OS certificate trust skipped (headless testing only). Word cannot use this install until the certificate is trusted.'
} else {
    Write-Host 'Trusting localhost for this user. Confirm the Windows certificate dialog if shown.'
    & certutil.exe -user -f -addstore Root (Join-Path $CertDir 'localhost.cer') | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not trust the localhost certificate for the current user.' }
}
Write-Host 'Certificate setup finished; staging runtime files...'

$Stage = Join-Path $Base ('app.stage.' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $Stage | Out-Null
try {
    foreach ($Name in @('server','taskpane','assets','tools','package.json','manifest.xml')) {
        Copy-Item (Join-Path $PSScriptRoot $Name) -Destination $Stage -Recurse
    }
    & $Node --check (Join-Path $Stage 'server\server.js')
    if ($LASTEXITCODE -ne 0) { throw 'Runtime validation failed.' }
    $OldManager = Join-Path $App 'tools\windows-service.ps1'
    if (Test-Path $OldManager) { & $OldManager -Action Stop -Base $Base }
    if (Test-Path $App) { Move-Item $App (Join-Path $Base ('app.backup.' + (Get-Date -Format 'yyyyMMddHHmmssfff'))) }
    Move-Item $Stage $App
} finally { if (Test-Path $Stage) { Remove-Item $Stage -Recurse -Force } }

Write-Host 'Runtime files installed; configuring the background service...'
$Config = @{ node = $Node; env = @{ LLM_IN_WORD_DATA_DIR = $Base; LLM_IN_WORD_CERT_DIR = $CertDir; LLM_IN_WORD_PORT = '8377' } }
foreach ($Name in @('HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','LLM_IN_WORD_TIMEOUT_MS','LLM_IN_WORD_MAX_CHARS')) {
    $Value = [Environment]::GetEnvironmentVariable($Name)
    if ($Value) { $Config.env[$Name] = $Value }
}
foreach ($Cli in @('claude','codex')) {
    $Key = 'LLM_IN_WORD_' + $Cli.ToUpperInvariant() + '_BIN'
    $Value = [Environment]::GetEnvironmentVariable($Key)
    if (!$Value) { $Value = [Environment]::GetEnvironmentVariable('WORD_EDIT_' + $Cli.ToUpperInvariant() + '_BIN') }
    if (!$Value) {
        # Prefer native executables; an npm .cmd shim is resolved by server/launch.js.
        $Command = Get-Command "$Cli.exe", "$Cli.cmd" -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($Command) { $Value = $Command.Source }
    }
    if ($Value) { $Config.env[$Key] = $Value }
}
[IO.File]::WriteAllText((Join-Path $Base 'runtime.json'), ($Config | ConvertTo-Json -Depth 4))

# Same current-user registration used by Microsoft's office-addin-dev-settings.
$Registry = 'HKCU:\Software\Microsoft\Office\16.0\WEF\Developer'
$Manifest = Join-Path $App 'manifest.xml'
[xml]$Xml = Get-Content $Manifest
$AddinId = $Xml.OfficeApp.Id
New-Item -Path $Registry -Force | Out-Null
New-ItemProperty -Path $Registry -Name $AddinId -Value $Manifest -PropertyType String -Force | Out-Null

# A per-user Startup shortcut requires neither elevation nor Task Scheduler rights.
$Shell = New-Object -ComObject WScript.Shell
$Shortcut = $Shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Startup')) 'LLM_in_Word.lnk'))
$Shortcut.TargetPath = Join-Path $PSHOME 'powershell.exe'
$Manager = Join-Path $App 'tools\windows-service.ps1'
$Shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $Manager + '" -Action Start'
$Shortcut.WorkingDirectory = $Base
$Shortcut.WindowStyle = 7
$Shortcut.Save()
Write-Host 'Starting the background service...'
& $Manager -Action Start -Base $Base
# Node trusts the exact generated certificate; validation is never globally disabled.
& $Node (Join-Path $App 'tools\check-install.js') $CertDir
if ($LASTEXITCODE -ne 0) { throw "Service health check failed. See $Base\server.log" }
Write-Host 'LLM_in_Word installed at https://localhost:8377.'
Write-Host 'Restart Word. Home > Add-ins > More Add-ins > MY ADD-INS > Developer Add-ins > LLM_in_Word.'
Write-Host "Runtime and logs: $Base"
