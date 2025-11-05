Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Gracefully close OBS on Windows. Falls back to Kill if needed.

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


