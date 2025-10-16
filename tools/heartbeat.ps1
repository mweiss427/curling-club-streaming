Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Configure these for the machine:
$sheet = $env:SHEET_KEY
if (-not $sheet) { $sheet = 'A' }
$streamKey = $env:YOUTUBE_STREAM_KEY # or set $streamId instead
$privacy = $env:YOUTUBE_PRIVACY
if (-not $privacy) { $privacy = 'public' }
$obsProfile = $env:OBS_PROFILE
if (-not $obsProfile) { $obsProfile = 'Untitled' }
$obsCollection = $env:OBS_COLLECTION
if (-not $obsCollection) { $obsCollection = 'Static Game Stream' }
$obsExe = $env:OBS_EXE

$args = @('run','tick','--prefix','scheduler','--')
if ($sheet) { $args += @('--sheet', $sheet) }
if ($streamKey) { $args += @('--stream-key', $streamKey) }
if ($privacy) { $args += @('--privacy', $privacy) }
if ($obsExe) { $args += @('--obs-exe', $obsExe) }
if ($obsProfile) { $args += @('--obs-profile', $obsProfile) }
if ($obsCollection) { $args += @('--obs-collection', $obsCollection) }

Start-Process -FilePath 'npm' -ArgumentList $args -WorkingDirectory (Split-Path -Parent $PSScriptRoot) -NoNewWindow -Wait


