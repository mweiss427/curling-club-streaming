Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

param(
  [string]$Profile    = 'Untitled',
  [string]$Collection = 'Static Game Stream',
  [string]$ObsExe     = ''
)

# Resolve OBS exe if not passed
if (-not $ObsExe -or -not (Test-Path -LiteralPath $ObsExe)) {
  $candidates = @(
    'C:\Program Files\obs-studio\bin\64bit\obs64.exe',
    'C:\Program Files (x86)\obs-studio\bin\64bit\obs64.exe'
  )
  $ObsExe = ($candidates | Where-Object { Test-Path $_ } | Select-Object -First 1)
}
if (-not $ObsExe) { throw 'OBS executable not found.' }

# Paths to helpers
$repoRoot   = Split-Path -Parent $PSScriptRoot
$stopScript = Join-Path $repoRoot 'tools\stop-obs.ps1'
$dismissDlg = Join-Path $repoRoot 'tools\dismiss-obs-safemode.ps1'

function Wait-UntilFalse {
  param([scriptblock]$check,[int]$timeoutSec=60,[int]$sleepMs=500)
  $deadline = (Get-Date).AddSeconds($timeoutSec)
  while ((Get-Date) -lt $deadline) {
    if (-not (& $check)) { return $true }
    Start-Sleep -Milliseconds $sleepMs
  }
  return $false
}

function IsObsRunning { (Get-Process -Name 'obs64' -ErrorAction SilentlyContinue) -ne $null }

# 1) Stop OBS (cleanly; websocket + graceful close, Force only last resort)
if (Test-Path -LiteralPath $stopScript) {
  Write-Host 'Stopping OBS...'
  try { powershell -NoProfile -ExecutionPolicy Bypass -File $stopScript | Out-Null } catch { }
}

# 2) Confirm process is gone
$stopped = Wait-UntilFalse -check { IsObsRunning } -timeoutSec  ninety
if (-not $stopped) { Write-Host 'OBS did not stop in time; proceeding to restart anyway.' }

# 3) Start OBS
$obsArgs = @('--profile', $Profile, '--collection', $Collection, '--disable-auto-updater')
Write-Host "Starting OBS: $ObsExe $($obsArgs -join ' ')"
Start-Process -FilePath $ObsExe -ArgumentList $obsArgs -WorkingDirectory (Split-Path -Parent $ObsExe) -WindowStyle Minimized

# 4) Fire-and-forget: auto-dismiss Safe Mode dialog if it appears
if (Test-Path -LiteralPath $dismissDlg) {
  try {
    Start-Process -WindowStyle Hidden -FilePath powershell -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File', $dismissDlg) | Out-Null
  } catch { }
}

# 5) Wait for OBS to be running
$started = $false
for ($i=0; $i -lt 40; $i++) {
  if (IsObsRunning) { $started = $true; break }
  Start-Sleep -Milliseconds 500
}
if (-not $started) { throw 'OBS failed to start.' }

# 6) Optional: ensure streaming via websocket (if password set)
$wsPass = $env:OBS_WEBSOCKET_PASSWORD
if ($wsPass) {
  function ObsCli([string[]]$Args) {
    $obsCli = (Get-Command obs-cli -ErrorAction SilentlyContinue)
    if ($obsCli) { & $obsCli.Source @Args }
    else { & npx --yes --prefix (Join-Path $repoRoot 'scheduler') obs-cli @Args }
  }
  $host='127.0.0.1'; $port='4455'
  try {
    # Wait for websocket to come up
    $out = ''
    for ($i=0; $i -lt 40; $i++) {
      try {
        $out = ObsCli @('--host',$host,'--port',$port,'--password',$wsPass,'GetStreamStatus','--json')
        if ($out -match '\"outputActive\"\\s*:\\s*(true|false)') { break }
      } catch { }
      Start-Sleep -Milliseconds 500
    }
    # Start streaming if not already active
    if ($out -notmatch '\"outputActive\"\\s*:\\s*true') {
      ObsCli @('--host',$host,'--port',$port,'--password',$wsPass,'StartStream') | Out-Null
    }
  } catch { }
}

Write-Host 'OBS restart complete.'
exit 0


