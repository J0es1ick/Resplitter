param(
    [ValidateSet('auto', 'quic', 'http2')][string]$TunnelProtocol = 'auto',
    [ValidateSet('cloudflare', 'ngrok')][string]$TunnelProvider = 'cloudflare'
)
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $projectRoot
if (-not (Test-Path -LiteralPath '.env')) { throw 'Create .env with TELEGRAM_TOKEN and OCR credentials first.' }
if (-not (Test-Path -LiteralPath 'dist/web/index.html')) { throw 'Run npm run build first.' }
$tunnelPort = if ($TunnelProvider -eq 'ngrok') { 43131 } else { 43130 }
foreach ($port in @(43127, $tunnelPort)) {
    $probe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $port)
    try { $probe.Start() } finally { $probe.Stop() }
}
$nodePath = (Get-Command node -ErrorAction Stop).Source
$runtimeDir = Join-Path $projectRoot 'data'
New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
$tag = Get-Date -Format 'yyyyMMdd-HHmmss'
$tunnelLog = Join-Path $runtimeDir "tunnel-$tag.log"
if ($TunnelProvider -eq 'ngrok') {
    $tunnelPath = (Get-Command ngrok -ErrorAction Stop).Source
    $ngrokBase = Join-Path $env:LOCALAPPDATA 'ngrok/ngrok.yml'
    if (-not (Test-Path -LiteralPath $ngrokBase)) {
        $ngrokBase = Join-Path $env:LOCALAPPDATA 'Packages/ngrok.ngrok_1g87z0zv29zzc/LocalCache/Local/ngrok/ngrok.yml'
    }
    if (-not (Test-Path -LiteralPath $ngrokBase)) { throw 'Configure ngrok authentication first. No credentials will be created automatically.' }
    $ngrokOverride = Join-Path $runtimeDir 'ngrok-test.yml'
    [System.IO.File]::WriteAllText($ngrokOverride, "version: '3'`nagent:`n  web_addr: 127.0.0.1:43131`n  console_ui: false`n  remote_management: false`n")
    $tunnelArgs = @('http','http://127.0.0.1:43127','--inspect=false','--log=stderr','--log-format=json','--config',('"' + $ngrokBase + ',' + $ngrokOverride + '"'))
    $tunnelMarker = $ngrokOverride
} else {
    $tunnelPath = 'C:\Program Files (x86)\cloudflared\cloudflared.exe'
    if (-not (Test-Path -LiteralPath $tunnelPath)) { $tunnelPath = (Get-Command cloudflared -ErrorAction Stop).Source }
    $tunnelArgs = @('tunnel','--no-autoupdate','--url','http://127.0.0.1:43127','--protocol',$TunnelProtocol,'--metrics','127.0.0.1:43130')
    $tunnelMarker = $tunnelPath
}
$tunnel = Start-Process -FilePath $tunnelPath -ArgumentList $tunnelArgs -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardError $tunnelLog -RedirectStandardOutput (Join-Path $runtimeDir "tunnel-$tag.out.log")
try {
    $publicUrl = $null
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        if ($tunnel.HasExited) { throw "Tunnel stopped. See $tunnelLog" }
        if (Test-Path -LiteralPath $tunnelLog) {
            $logContents = Get-Content -Raw -LiteralPath $tunnelLog
            if ($logContents) {
                $urlPattern = if ($TunnelProvider -eq 'ngrok') { 'https://[a-z0-9-]+\.ngrok(?:-free)?\.(?:app|dev|io)' } else { 'https://[a-z0-9-]+\.trycloudflare\.com' }
                $found = [regex]::Match($logContents, $urlPattern)
                if ($found.Success) { $publicUrl = $found.Value; break }
            }
        }
        Start-Sleep -Milliseconds 500
    }
    if (-not $publicUrl) { throw "Tunnel URL not received. See $tunnelLog" }
    $runtimeConfig = "NODE_ENV=development`nTELEGRAM_UPDATE_MODE=polling`nHOST=127.0.0.1`nPORT=43127`nMINI_APP_URL=$publicUrl`nENABLE_DEMO_COMMAND=true`n"
    [System.IO.File]::WriteAllText((Join-Path $projectRoot '.env.runtime'), $runtimeConfig)
    $entry = Join-Path $projectRoot 'dist/src/index.js'
    $botProcess = Start-Process -FilePath $nodePath -ArgumentList @('"' + $entry + '"') -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimeDir "bot-$tag.log") -RedirectStandardError (Join-Path $runtimeDir "bot-$tag.err.log")
    $record = @{ url=$publicUrl; provider=$TunnelProvider; botPid=$botProcess.Id; botStarted=$botProcess.StartTime.ToUniversalTime().ToString('o'); botEntry=$entry; tunnelPid=$tunnel.Id; tunnelStarted=$tunnel.StartTime.ToUniversalTime().ToString('o'); tunnelPath=$tunnelPath; tunnelMarker=$tunnelMarker }
    $record | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtimeDir 'test-processes.json') -Encoding utf8
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        if ($botProcess.HasExited) { throw "Bot stopped. See data/bot-$tag.err.log" }
        try {
            $health = Invoke-RestMethod 'http://127.0.0.1:43127/health/ready' -TimeoutSec 2
            if ($health.status -eq 'ready') { Write-Output "Ready. Mini App: $publicUrl/app/ | Browser demo: $publicUrl/app/?demo=1"; exit 0 }
        } catch { }
        Start-Sleep -Milliseconds 500
    }
    throw "Bot did not become ready. See data/bot-$tag.err.log"
} catch {
    if ($botProcess -and -not $botProcess.HasExited) { Stop-Process -Id $botProcess.Id }
    if (-not $tunnel.HasExited) { Stop-Process -Id $tunnel.Id }
    throw
}
