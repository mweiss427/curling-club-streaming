Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Gracefully close OBS on Windows. Tries obs-websocket StopStream + Quit first,
# then falls back to window-close. Uses -Force only as a last resort.

# Hardcoded obs-websocket endpoint; password comes from environment
$wsHost = '127.0.0.1'
$wsPort = 4455
$wsPass = $env:OBS_WEBSOCKET_PASSWORD

function Invoke-ObsCli {
  param([string[]]$Args)
  $repoRoot = Split-Path -Parent $PSScriptRoot
  $obsCli = (Get-Command obs-cli -ErrorAction SilentlyContinue)
  if ($obsCli) {
    & $obsCli.Source @Args
    return
  }
  # Prefer local devDependency under scheduler via npx --prefix (offline-friendly)
  & npx --yes --prefix (Join-Path $repoRoot 'scheduler') obs-cli @Args
}

function Try-Stop {
  param([string]$cmd)
  try {
    Invoke-ObsCli -Args @('--host', $wsHost, '--port', "$wsPort", '--password', $wsPass, $cmd) | Out-Null
  } catch { }
}

function Wait-Until {
  param(
    [scriptblock]$check,
    [int]$timeoutSec = 15,
    [int]$sleepMs = 300
  )
  $deadline = (Get-Date).AddSeconds($timeoutSec)
  while ((Get-Date) -lt $deadline) {
    if (& $check) { return $true }
    Start-Sleep -Milliseconds $sleepMs
  }
  return $false
}

function IsInactive {
  param([string]$what)
  try {
    switch ($what) {
      'stream'       { $out = Invoke-ObsCli -Args @('--host', $wsHost, '--port', "$wsPort", '--password', $wsPass, 'GetStreamStatus', '--json');       return ($out -notmatch '\"outputActive\"\\s*:\\s*true') }
      'record'       { $out = Invoke-ObsCli -Args @('--host', $wsHost, '--port', "$wsPort", '--password', $wsPass, 'GetRecordStatus', '--json');       return ($out -notmatch '\"outputActive\"\\s*:\\s*true') }
      'virtualcam'   { $out = Invoke-ObsCli -Args @('--host', $wsHost, '--port', "$wsPort", '--password', $wsPass, 'GetVirtualCamStatus', '--json');   return ($out -notmatch '\"outputActive\"\\s*:\\s*true') }
      'replaybuffer' { $out = Invoke-ObsCli -Args @('--host', $wsHost, '--port', "$wsPort", '--password', $wsPass, 'GetReplayBufferStatus', '--json'); return ($out -notmatch '\"outputActive\"\\s*:\\s*true') }
    }
  } catch { }
  return $true
}

if ($wsPass) {
  Write-Host 'Stopping outputs via obs-websocket...'
  Try-Stop 'StopStream'
  Try-Stop 'StopRecord'
  Try-Stop 'StopVirtualCam'
  Try-Stop 'StopReplayBuffer'

  # Wait (best-effort) for outputs to report inactive
  $null = Wait-Until { IsInactive 'stream' } -timeoutSec 15
  $null = Wait-Until { IsInactive 'record' } -timeoutSec 15
  $null = Wait-Until { IsInactive 'virtualcam' } -timeoutSec 10
  $null = Wait-Until { IsInactive 'replaybuffer' } -timeoutSec 10

  Write-Host 'Requesting OBS Quit via obs-websocket...'
  Try-Stop 'Quit'
  Start-Sleep -Seconds 2
}

$process = Get-Process -Name 'obs64' -ErrorAction SilentlyContinue
if (-not $process) {
  Write-Host 'OBS is not running.'
  exit 0
}

if ($process.MainWindowHandle -ne [IntPtr]::Zero) {
  Write-Host 'Requesting graceful close via CloseMainWindow...'
  $null = $process.CloseMainWindow()
  try {
    Wait-Process -Id $process.Id -Timeout 90
  } catch {
    # timed out waiting
  }
} else {
  # No main window (e.g., minimized to tray). Try a normal Stop-Process (no -Force) first, then wait.
  Write-Host 'No main window; attempting normal Stop-Process (no -Force)...'
  try {
    Stop-Process -Id $process.Id -ErrorAction Stop
  } catch {
    # may already be exiting or gone
  }
  try {
    Wait-Process -Id $process.Id -Timeout 90
  } catch {
    # timed out waiting
  }
}

# If still running after graceful attempts, use -Force as a last resort
if (Get-Process -Id $process.Id -ErrorAction SilentlyContinue) {
  Write-Host 'OBS did not exit cleanly in time; sending Stop-Process -Force (last resort).'
  Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
} else {
  Write-Host 'OBS exited cleanly.'
}

Write-Host 'OBS stop command completed.'


