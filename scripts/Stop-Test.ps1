$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$recordPath = Join-Path $projectRoot 'data/test-processes.json'
if (-not (Test-Path -LiteralPath $recordPath)) { Write-Output 'No test processes recorded.'; exit 0 }
$record = Get-Content -Raw -LiteralPath $recordPath | ConvertFrom-Json
$tunnelMarker = if ($record.tunnelMarker) { $record.tunnelMarker } else { $record.tunnelPath }
foreach ($target in @(@{Id=$record.botPid; Started=$record.botStarted; Marker=$record.botEntry}, @{Id=$record.tunnelPid; Started=$record.tunnelStarted; Marker=$tunnelMarker})) {
    $process = Get-Process -Id $target.Id -ErrorAction SilentlyContinue
    if (-not $process) { continue }
    $actual = Get-CimInstance Win32_Process -Filter "ProcessId = $($target.Id)"
    $sameTime = [Math]::Abs(($process.StartTime.ToUniversalTime() - [DateTime]::Parse($target.Started).ToUniversalTime()).TotalSeconds) -lt 1
    if (-not $sameTime -or -not $actual.CommandLine.Contains($target.Marker)) { throw "PID $($target.Id) no longer belongs to this test run; not stopping it." }
    Stop-Process -Id $process.Id
    Write-Output "Stopped project test process $($process.Id)."
}
