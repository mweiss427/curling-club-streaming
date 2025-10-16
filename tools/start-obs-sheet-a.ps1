Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$obsExeCandidates = @(
  'C:\Program Files\obs-studio\bin\64bit\obs64.exe',
  'C:\Program Files (x86)\obs-studio\bin\64bit\obs64.exe'
)
$obsExe = $obsExeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $obsExe) {
  Write-Error 'OBS executable not found. Please install OBS from https://obsproject.com/.'
  exit 1
}

# These names must match the provided configs
$profileName = 'Untitled'
$collectionName = 'Static Game Stream'

Write-Host "Launching OBS with profile '$profileName' and collection '$collectionName'..."
Start-Process -FilePath $obsExe -ArgumentList @('--profile', $profileName, '--collection', $collectionName, '--startstreaming')

Write-Host 'OBS launch command issued. If OBS was already running, it will reuse the same instance.'


