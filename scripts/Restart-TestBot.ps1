$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$recordPath = Join-Path $projectRoot 'data/test-processes.json'
$entry = Join-Path $projectRoot 'dist/src/index.js'
foreach ($requiredFile in @($recordPath, $entry, (Join-Path $projectRoot '.env.runtime'))) {
    if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) { throw "Missing $requiredFile. Run npm run build and npm run test:start first." }
}
$record = Get-Content -Raw -LiteralPath $recordPath | ConvertFrom-Json
if ($record.botEntry -ne $entry) { throw 'Recorded bot entry does not belong to this project; not restarting it.' }
$nodePath = (Get-Command node -ErrorAction Stop).Source
$process = Get-Process -Id $record.botPid -ErrorAction SilentlyContinue
if (-not $process) { throw 'Recorded bot is not running. Use npm run test:start for a new test run.' }
$actual = Get-CimInstance Win32_Process -Filter "ProcessId = $($record.botPid)"
$sameTime = [Math]::Abs(($process.StartTime.ToUniversalTime() - [DateTime]::Parse($record.botStarted).ToUniversalTime()).TotalSeconds) -lt 1
if (-not $sameTime -or -not $actual.CommandLine -or -not $actual.CommandLine.Contains($entry)) {
    throw "PID $($record.botPid) no longer belongs to this test run; not stopping it."
}
Stop-Process -Id $process.Id
if (-not $process.WaitForExit(5000)) { throw 'Old bot did not stop; not starting a second instance.' }
$probe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 43127)
try { $probe.Start() } finally { $probe.Stop() }
$tag = Get-Date -Format 'yyyyMMdd-HHmmss'
$runtimeDir = Join-Path $projectRoot 'data'
$botProcess = Start-Process -FilePath $nodePath -ArgumentList @('"' + $entry + '"') -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimeDir "bot-$tag.log") -RedirectStandardError (Join-Path $runtimeDir "bot-$tag.err.log")
$record.botPid = $botProcess.Id
$record.botStarted = $botProcess.StartTime.ToUniversalTime().ToString('o')
$record | ConvertTo-Json | Set-Content -LiteralPath $recordPath -Encoding utf8
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    if ($botProcess.HasExited) { throw "Bot stopped. See data/bot-$tag.err.log" }
    try {
        $health = Invoke-RestMethod 'http://127.0.0.1:43127/health/ready' -TimeoutSec 1
        if ($health.status -eq 'ready') {
            Write-Output "Bot restarted, PID $($botProcess.Id). Local readiness OK. Tunnel and public URL unchanged."
            exit 0
        }
    } catch { }
    Start-Sleep -Milliseconds 500
}
throw "Bot did not become ready. See data/bot-$tag.err.log"
