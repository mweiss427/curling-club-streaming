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

# Single-use: hardcoded path to .env on the host machine (use forward slashes for Git Bash compatibility)
$EnvFilePath = "C:/Users/Matt Weiss/src/.env"

# Helpers
function Load-DotEnvFile {
  param([Parameter(Mandatory=$true)][string]$Path)
  $envMap = @{}
  if (-not $Path -or -not (Test-Path -LiteralPath $Path)) { return $envMap }
  Get-Content -LiteralPath $Path -ErrorAction SilentlyContinue | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith('#')) { return }
    $idx = $line.IndexOf('=')
    if ($idx -lt 1) { return }
    $key = $line.Substring(0, $idx).Trim()
    $val = $line.Substring($idx + 1).Trim().Trim('"')
    if ($key -ne '') { $envMap[$key] = $val }
  }
  return $envMap
}

function Mask-UrlSecret {
  param([string]$Url)
  if (-not $Url) { return '' }
  try {
    return [regex]::Replace($Url, '(?i)://([^:@/]+):([^@/]+)@', '://****:****@')
  } catch { return $Url }
}

function Normalize-UrlSlashes {
  param([string]$Url)
  if (-not $Url) { return '' }
  try {
    return $Url -replace '\\','/'
  } catch { return $Url }
}

function Replace-Placeholders {
  param(
    [Parameter(Mandatory=$true)][string]$Text,
    [Parameter(Mandatory=$true)][hashtable]$Env
  )
  if (-not $Text) { return $Text }
  $result = $Text
  # ${ENV_VAR} style replacements from the loaded .env file
  $result = [regex]::Replace(
    $result,
    '\$\{([A-Za-z_][A-Za-z0-9_]*)\}',
    [System.Text.RegularExpressions.MatchEvaluator]{
      param($m)
      $name = $m.Groups[1].Value
      if ($Env.ContainsKey($name) -and $Env[$name] -and $Env[$name] -ne '') { $Env[$name] }
      else { $m.Value }
    }
  )
  return $result
}

function Inject-SceneInputs {
  param(
    [Parameter(Mandatory=$true)][string]$ScenesDir,
    [Parameter(Mandatory=$true)][hashtable]$Env
  )
  if (-not (Test-Path -LiteralPath $ScenesDir)) { return }
  Write-Host ("Debug: Using creds OBS_RTSP_USERNAME='{0}' OBS_RTSP_PASSWORD='{1}'" -f ($Env['OBS_RTSP_USERNAME']), ($Env['OBS_RTSP_PASSWORD']))
  Get-ChildItem -LiteralPath $ScenesDir -Filter '*.json' -File -ErrorAction SilentlyContinue | ForEach-Object {
    try {
      $file = $_
      $raw = Get-Content -LiteralPath $file.FullName -Raw -ErrorAction Stop
      $obj = $raw | ConvertFrom-Json -Depth 64 -ErrorAction Stop
      if ($null -eq $obj.sources) { return }
      foreach ($src in $obj.sources) {
        if ($src.id -ne 'ffmpeg_source') { continue }
        $sourceName = [string]$src.name
        $keyBase = ($sourceName -replace '[^A-Za-z0-9]', '_').ToUpper()
        $specificKey = "OBS_INPUT_" + $keyBase
        $updated = $false
        $before = [string]$src.settings.input
        Write-Host ("   - {0}: BEFORE => {1}" -f $sourceName, $before)
        if ($Env.ContainsKey($specificKey) -and $Env[$specificKey] -and $Env[$specificKey] -ne '') {
          $src.settings.input = Normalize-UrlSlashes -Url $Env[$specificKey]
          $updated = $true
        }
        if (-not $updated -and $src.settings -and $src.settings.input) {
          $inputVal = [string]$src.settings.input
          if ($Env.ContainsKey('OBS_RTSP_USERNAME') -and $Env['OBS_RTSP_USERNAME']) {
            $inputVal = $inputVal -replace '<username>', $Env['OBS_RTSP_USERNAME']
          }
          if ($Env.ContainsKey('OBS_RTSP_PASSWORD') -and $Env['OBS_RTSP_PASSWORD']) {
            $inputVal = $inputVal -replace '<password>', $Env['OBS_RTSP_PASSWORD']
          }
          # Generic placeholder replacement using OBS_SECRET_<TOKEN>
          $inputVal = Replace-Placeholders -Text $inputVal -Env $Env
          $src.settings.input = Normalize-UrlSlashes -Url $inputVal
        }
        # If placeholders remain, fail (${VAR})
        if (([string]$src.settings.input) -match '\$\{[A-Za-z_][A-Za-z0-9_]*\}') {
          throw ("Unresolved placeholders for source '{0}' in {1}. Check .env values." -f $sourceName, (Split-Path -Leaf $file.FullName))
        }
        $after = [string]$src.settings.input
        $b = Mask-UrlSecret -Url $before
        $a = Mask-UrlSecret -Url $after
        Write-Host ("   - {0}: AFTER  => {1}" -f $sourceName, $after)
        if ($after -ne $before) {
          Write-Host ("   - Updated source '{0}' in {1}`n     {2}`n     -> {3}" -f $sourceName, (Split-Path -Leaf $file.FullName), $b, $a)
        } else {
          Write-Host ("   - Source '{0}' in {1} unchanged. RTSP: {2}" -f $sourceName, (Split-Path -Leaf $file.FullName), $a)
        }
      }
      ($obj | ConvertTo-Json -Depth 64) | Set-Content -LiteralPath $file.FullName -Encoding UTF8
    } catch { }
  }
}
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
  if ((Test-Path -LiteralPath $Source -PathType Container)) {
    Copy-Item -Path (Join-Path $Source '*') -Destination $Destination -Recurse -Force -ErrorAction Stop
  } else {
    Copy-Item -Path $Source -Destination $Destination -Recurse -Force -ErrorAction Stop
  }
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

$toPush = @()

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

# Inject secrets into ffmpeg inputs (from hardcoded .env)
if (-not (Test-Path -LiteralPath $EnvFilePath)) {
  throw ("Env file not found at: {0}. Aborting." -f $EnvFilePath)
}
Write-Host ("Using env file: {0}" -f $EnvFilePath)
$envMap = Load-DotEnvFile -Path $EnvFilePath

# Prepare scenes in a temporary folder (avoids editing locked files if OBS is open)
$repoScenes = Join-Path $RepoCfg 'basic\scenes'
if (-not (Test-Path -LiteralPath $repoScenes)) { throw "Repo scenes not found: $repoScenes" }
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("obs-scenes-" + $Sheet + "-" + ([System.Guid]::NewGuid().ToString()))
New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null
Copy-Item -Path (Join-Path $repoScenes '*') -Destination $tempRoot -Recurse -Force

$tempScenesDir = $tempRoot

Inject-SceneInputs -ScenesDir $tempScenesDir -Env $envMap

# Validate no placeholders remain
$placeholders = Get-ChildItem -LiteralPath $tempScenesDir -Filter '*.json' -File -Recurse -ErrorAction SilentlyContinue |
  Select-String -Pattern '\$\{[A-Za-z_][A-Za-z0-9_]*\}' -List
if ($placeholders) {
  throw "Credentials placeholders remain after injection. Check .env values."
}

# Copy prepared scenes to destination
$destScenesDir = Join-Path $ObsDest 'basic\scenes'
Copy-Dir-WithoutBak -Source $tempScenesDir -Destination $destScenesDir

# Cleanup temp
Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue

Restore-ServiceJsonKeysFromMap -Map $keysMap

Write-Host "Pushed repo configs to OBS for '$Sheet' (preserved stream keys, skipped basic.ini)"
Write-Host "   Source : $RepoCfg"
Write-Host "   Dest   : $ObsDest"
Write-Host ""
Write-Host "Restart OBS if running to pick up profile/scene changes."
