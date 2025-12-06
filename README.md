# curling-club-streaming (Windows-only)
Configuration and operational docs for the Stevens Point Curling Club streaming setup on Windows.

This repository contains:
- `scheduler/`: a headless Node.js scheduler that reads Google Calendar and exposes a CLI.
- `tools/`: helper PowerShell scripts for OBS configuration sync and operations.
- `obs/`: reference OBS profiles and scene collections per sheet.

OBS camera inputs are configured inside OBS and are not part of this repository.

## Quickstart (Windows 11)

### Prerequisites
- Windows 11 on the club LAN (same subnet as the OBS PCs).
- Outbound HTTPS (443) to Google APIs.
- Correct system time (NTP) so event windows are accurate.

### Install Node.js and dependencies
Option A — Use our bootstrap script:
```
powershell -ExecutionPolicy Bypass -File tools\bootstrap-windows.ps1
```

Option B — Manual steps:
1) Install Node.js 20+ (winget or installer).  
2) Install dependencies:
```
cd scheduler
npm ci
```

### Create your environment file
1) Copy `scheduler\.env.example` to `scheduler\.env`.
2) Edit the values to match your environment (calendar, YouTube, OBS paths, and credential JSON paths).

The canonical variables are documented in `scheduler/.env.example`.

### Run the scheduler CLI
List upcoming events (defaults: 7 days, max 10 per sheet):
```
cd scheduler
npm run list -- --days 7 --max 10
```

## OBS configuration (separate from this repo)
- Configure OBS on each machine. Inputs (cameras/audio) are created in OBS, not via `.env` or scripts here.
- Streaming settings should be:
  - Service: “YouTube - RTMPS”
  - Server: “Primary YouTube ingest server”
- Ensure the profile and scene collection named in `.env` exist in OBS (e.g., `OBS_PROFILE=Untitled`, `OBS_COLLECTION=Static Game Stream`).

## Optional: Sync OBS profiles/collections (does not create camera inputs)
You can sync the profile/scene collection files from this repo to an OBS machine. This does not create or modify camera inputs.
```
powershell -ExecutionPolicy Bypass -File tools\push-obs-configs.ps1 -Sheet sheet-a -EnvPath C:\path\to\.env
```

## Scheduler details
- **Location in repo**: `scheduler/`
- **Config file**: `scheduler/config.json` (see also `scheduler/README.md`)
- **Timezone**: America/Chicago

### Network placement
- **Lives on**: the club LAN, same subnet as the OBS PCs (e.g., 192.168.1.0/24)
- **Host recommendation**: a small always-on machine named `stream-scheduler` with a DHCP reservation/static IP
- **Connectivity**: requires outbound HTTPS (443) to Google; no inbound ports are required for the current CLI
- **Time sync**: ensure correct system time (NTP) so event windows are accurate

### Operations notes
- Keep `scheduler/config.json`, `scheduler/.env`, and any credential JSON files out of source control.
- Place the scheduler host on the same VLAN as OBS machines to minimize future control latency.

## 📚 Docs
- Operations how-to: `rfc/0008-curling-club-streaming.md`
