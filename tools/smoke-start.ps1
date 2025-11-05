Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

param(
  [Parameter(Mandatory=$true)] [string]$title,
  [string]$description,
  [ValidateSet('public','unlisted','private')] [string]$privacy = 'public',
  [string]$streamId,
  [string]$streamKey,
  [string]$credentials,
  [string]$obsExe,
  [string]$obsProfile = 'Untitled',
  [string]$obsCollection = 'Static Game Stream'
)

# Resolve repo root
$repoRoot = Split-Path -Parent $PSScriptRoot

# Defaults from environment if not provided
if (-not $streamId -and -not $streamKey) { $streamKey = $env:YOUTUBE_STREAM_KEY }
if (-not $credentials) { $credentials = $env:YOUTUBE_OAUTH_CREDENTIALS }
if (-not $obsExe) { $obsExe = $env:OBS_EXE }
if (-not $obsExe) {
  if (Test-Path 'C:\Program Files\obs-studio\bin\64bit\obs64.exe') { $obsExe = 'C:\Program Files\obs-studio\bin\64bit\obs64.exe' }
  elseif (Test-Path 'C:\Program Files (x86)\obs-studio\bin\64bit\obs64.exe') { $obsExe = 'C:\Program Files (x86)\obs-studio\bin\64bit\obs64.exe' }
}

if (-not (Test-Path $obsExe)) { throw "OBS executable not found: $obsExe" }

Write-Host 'Creating YouTube broadcast via scheduler...'
$ytArgs = @('--prefix','scheduler','run','yt-create','--','--title', $title)
if ($description) { $ytArgs += @('--description', $description) }
if ($privacy) { $ytArgs += @('--privacy', $privacy) }
if ($streamId) { $ytArgs += @('--stream-id', $streamId) }
if ($streamKey) { $ytArgs += @('--stream-key', $streamKey) }
if ($credentials) { $ytArgs += @('--credentials', $credentials) }

$ytProc = Start-Process -FilePath 'npm' -ArgumentList $ytArgs -WorkingDirectory $repoRoot -NoNewWindow -PassThru -Wait
if ($ytProc.ExitCode -ne 0) { throw "Failed to create/bind YouTube broadcast (exit $($ytProc.ExitCode))." }

Write-Host "Launching OBS with profile '$obsProfile' and collection '$obsCollection'..."
$obsArgs = @('--profile', $obsProfile, '--collection', $obsCollection, '--startstreaming', '--disable-shutdown-check')
Start-Process -FilePath $obsExe -ArgumentList $obsArgs | Out-Null
Write-Host 'Smoke start issued. If OBS was already running, it will reuse the same instance.'

# USAGE EXAMPLE:
#   powershell -File .\tools\smoke-start.ps1 -title "Test Broadcast" -description "Test" -privacy public -streamKey "$env:YOUTUBE_STREAM_KEY"




