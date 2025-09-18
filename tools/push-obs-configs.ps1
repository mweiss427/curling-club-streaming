<# push-obs-configs.ps1  (push repo configs to OBS, preserve secrets)

  Usage examples:
    # push repo configs to OBS for sheet-a (preserves stream keys, skips basic.ini)
    powershell -ExecutionPolicy Bypass -File tools\push-obs-configs.ps1 -Sheet sheet-a
#>

param(
  [string]$Sheet = "",
  [switch]$List
)

$ErrorActionPreference = "Stop"

# Helpers
function Get-ServiceJsonKeysMap {
  param([Parameter(Mandatory=$true)][string]$ProfilesRoot)
  $map = @{}
  if (-not (Test-Path -LiteralPath $ProfilesRoot)) { return $map }
  Get-ChildItem -LiteralPath $ProfilesRoot -Recurse -Filter 'service.json' -File -ErrorAction SilentlyContinue | ForEach-Object {
    try {
      $obj = (Get-Content -LiteralPath $_.FullName -Raw -ErrorAction Stop) | ConvertFrom-Json -Depth 64 -ErrorAction Stop
      $key = $obj.settings.key
      if ($key -and $key -ne '' -and $key -ne 'REDACTED') {
        $map[$_.FullName] = $key
      }
    } catch { }
  }
  return $map
}

function Restore-ServiceJsonKeysFromMap {
  param([Parameter(Mandatory=$true)][hashtable]$Map)
  foreach ($path in $Map.Keys) {
    if (-not (Test-Path -LiteralPath $path)) { continue }
    try {
      $raw = Get-Content -LiteralPath $path -Raw -ErrorAction Stop
      $obj = $raw | ConvertFrom-Json -Depth 64 -ErrorAction Stop
      if (-not $obj.settings) { $obj | Add-Member -NotePropertyName settings -NotePropertyValue (@{}) -Force }
      $obj.settings.key = $Map[$path]
      ($obj | ConvertTo-Json -Depth 64) | Set-Content -LiteralPath $path -Encoding UTF8
    } catch { }
  }
}

function Copy-Dir-WithoutBak {
  param(
    [Parameter(Mandatory=$true)][string]$Source,
    [Parameter(Mandatory=$true)][string]$Destination
  )
  if (-not (Test-Path -LiteralPath $Source)) { return }
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  Get-ChildItem -LiteralPath $Destination -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
  Copy-Item -Path $Source -Destination $Destination -Recurse -Force
  Get-ChildItem -LiteralPath $Destination -Recurse -Force -File -Filter '*.bak' -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
}

# Map each sheet to its OBS config folder
$SheetMap = @{
  "sheet-c" = "C:\Users\Matt Weiss\AppData\Roaming\obs-studio"
  "sheet-a" = "C:\Users\Matt Weiss\AppData\Roaming\obs-studio"
  "sheet-b" = "C:\Users\Matt Weiss\AppData\Roaming\obs-studio"
  "sheet-d" = "C:\Users\Matt Weiss\AppData\Roaming\obs-studio"
}

if ($List) {
  Write-Host "Known sheets and destination paths:`n"
  $SheetMap.GetEnumerator() | Sort-Object Key | ForEach-Object {
    "{0}`t{1}" -f $_.Key, $_.Value
  }
  exit 0
}

if (-not $Sheet) { throw "Please pass -Sheet <name>. Try -List to see options." }
if (-not $SheetMap.ContainsKey($Sheet)) { throw "Unknown sheet '$Sheet'. Add it to `$SheetMap." }

# Paths
$RepoRoot  = (Resolve-Path "$PSScriptRoot\..").Path
$ObsDest   = $SheetMap[$Sheet]
$RepoCfg   = Join-Path $RepoRoot ("obs\" + $Sheet + "\configs")

if (!(Test-Path $RepoCfg)) { throw "Repo configs not found: $RepoCfg" }
if (!(Test-Path $ObsDest)) { throw "OBS config not found: $ObsDest" }

$toPush = @(
  "basic\scenes"
)

# Preserve existing stream keys in destination
$destProfiles = Join-Path $ObsDest 'basic\profiles'
$keysMap = Get-ServiceJsonKeysMap -ProfilesRoot $destProfiles

foreach ($rel in $toPush) {
  $src = Join-Path $RepoCfg $rel
  $dst = Join-Path $ObsDest $rel
  if (Test-Path $src) {
    Copy-Dir-WithoutBak -Source $src -Destination $dst
  }
}

Restore-ServiceJsonKeysFromMap -Map $keysMap

Write-Host "✅ Pushed repo configs to OBS for '$Sheet' (preserved stream keys, skipped basic.ini)"
Write-Host "   Source : $RepoCfg"
Write-Host "   Dest   : $ObsDest"
Write-Host ""
Write-Host "Restart OBS if running to pick up profile/scene changes."



