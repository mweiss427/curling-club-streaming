<# 
Bootstrap script for Windows:
 - Ensures Node.js (LTS) and npm are installed (via winget if missing)
 - Installs scheduler dependencies (npm ci)
 - Creates scheduler\.env from example if missing and opens it in Notepad
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-Section([string]$text) {
	Write-Host "==> $text" -ForegroundColor Cyan
}

function Ensure-Node {
	$node = Get-Command node -ErrorAction SilentlyContinue
	if ($null -ne $node) {
		return
	}
	Write-Section "Node.js not found. Installing Node.js LTS via winget..."
	$winget = Get-Command winget -ErrorAction SilentlyContinue
	if ($null -eq $winget) {
		throw "winget is not available. Please install Node.js 20+ manually from https://nodejs.org and re-run this script."
	}
	# Try LTS channel first
	winget install --id OpenJS.NodeJS.LTS -e --source winget --accept-package-agreements --accept-source-agreements --silent | Out-Null
	# Verify installation
	$node = Get-Command node -ErrorAction SilentlyContinue
	if ($null -eq $node) {
		# Fallback to current channel
		winget install --id OpenJS.NodeJS -e --source winget --accept-package-agreements --accept-source-agreements --silent | Out-Null
	}
	if ($null -eq (Get-Command node -ErrorAction SilentlyContinue)) {
		throw "Node.js installation failed. Install Node.js 20+ manually and re-run."
	}
}

function Install-Dependencies {
	$repoRoot = Split-Path -Parent $PSScriptRoot
	$schedulerDir = Join-Path $repoRoot 'scheduler'
	if (-not (Test-Path $schedulerDir)) {
		throw "Scheduler directory not found at $schedulerDir"
	}
	Write-Section "Installing npm dependencies in scheduler/"
	Push-Location $schedulerDir
	try {
		if (Test-Path 'package-lock.json') {
			npm ci
		} else {
			npm install
		}
	} finally {
		Pop-Location
	}
}

function Ensure-EnvFile {
	$repoRoot = Split-Path -Parent $PSScriptRoot
	$schedulerDir = Join-Path $repoRoot 'scheduler'
	$envPath = Join-Path $schedulerDir '.env'
	$exampleCandidates = @(
		Join-Path $schedulerDir '.env.example'),
		Join-Path $schedulerDir 'env.example'
	)

	if (Test-Path $envPath) {
		Write-Section "Found scheduler\.env"
		return
	}

	foreach ($candidate in $exampleCandidates) {
		if (Test-Path $candidate) {
			Copy-Item -Path $candidate -Destination $envPath -Force
			Write-Section "Created scheduler\.env from $(Split-Path $candidate -Leaf)"
			if (Get-Command notepad -ErrorAction SilentlyContinue) {
				Start-Process notepad $envPath
			}
			return
		}
	}

	# Fallback: create a minimal template inline
	Write-Section "No example env found. Creating a minimal scheduler\.env template."
	@"
# Calendar selection (choose ONE; do not set both)
CALENDAR_ID=c_…@group.calendar.google.com
# SHEET_KEY=A

# YouTube live control
YOUTUBE_STREAM_ID=YOUR_STREAM_ID
YOUTUBE_OAUTH_CREDENTIALS=C:\path\to\desktop-client.json

# OBS auto-launch + profile/collection names
OBS_EXE=C:\Program Files\obs-studio\bin\64bit\obs64.exe
OBS_PROFILE=Untitled
OBS_COLLECTION=Static Game Stream

# Google service account creds for Calendar read-only
GOOGLE_APPLICATION_CREDENTIALS=C:\path\to\streaming.key.json
"@ | Set-Content -Path $envPath -Encoding UTF8
	if (Get-Command notepad -ErrorAction SilentlyContinue) {
		Start-Process notepad $envPath
	}
}

try {
	Write-Section "Checking Node.js"
	Ensure-Node
	Write-Host "Node version: $(node -v)"
	Write-Host "npm version:  $(npm -v)"

	Install-Dependencies
	Ensure-EnvFile

	Write-Section "Next steps"
	Write-Host "1) Verify paths in scheduler\.env (credential JSONs, OBS path, etc.)"
	Write-Host "2) Run:  cd scheduler; npm run list -- --days 7 --max 10"
	Write-Host "3) In OBS, ensure the profile and scene collection from scheduler\.env exist."
} catch {
	Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
	exit 1
}

