Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Gracefully close OBS on Windows. Falls back to Kill if needed.

$process = Get-Process -Name 'obs64' -ErrorAction SilentlyContinue
if (-not $process) {
  Write-Host 'OBS is not running.'
  exit 0
}

if ($process.MainWindowHandle -ne [IntPtr]::Zero) {
  # Try a graceful close first
  $closed = $process.CloseMainWindow()
  if (-not $closed) {
    Write-Host 'CloseMainWindow returned false; proceeding to wait/terminate.'
  }
  if (-not ($process | Wait-Process -Timeout 20 -ErrorAction SilentlyContinue)) {
    Write-Host 'OBS did not exit gracefully in time; sending Stop-Process -Force.'
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
  }
} else {
  # No window (background or minimized to tray); attempt normal stop, then force.
  try {
    Stop-Process -Id $process.Id -ErrorAction Stop
  } catch {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
  }
}

Write-Host 'OBS stop command completed.'


