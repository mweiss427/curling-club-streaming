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

if ($wsPass) {
  try {
    Write-Host 'Stopping outputs via obs-websocket...'
    Invoke-ObsCli -Args @('--host', $wsHost, '--port', "$wsPort", '--password', $wsPass, 'StopStream') | Out-Null
    Invoke-ObsCli -Args @('--host', $wsHost, '--port', "$wsPort", '--password', $wsPass, 'StopRecord') | Out-Null
    Invoke-ObsCli -Args @('--host', $wsHost, '--port', "$wsPort", '--password', $wsPass, 'StopVirtualCam') | Out-Null
    Invoke-ObsCli -Args @('--host', $wsHost, '--port', "$wsPort", '--password', $wsPass, 'StopReplayBuffer') | Out-Null
    Start-Sleep -Seconds 2
    Write-Host 'Requesting OBS Quit via obs-websocket...'
    Invoke-ObsCli -Args @('--host', $wsHost, '--port', "$wsPort", '--password', $wsPass, 'Quit') | Out-Null
    Start-Sleep -Seconds 2
  } catch {
    Write-Host 'obs-websocket step failed; falling back to window-close.'
  }
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
    Wait-Process -Id $process.Id -Timeout 60
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
    Wait-Process -Id $process.Id -Timeout 60
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


