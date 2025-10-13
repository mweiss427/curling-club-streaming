# curling-club-streaming
Configuration and Technical Documentation for the Stevens Point Curling Clubs Streaming

Secrets management (.env)
-------------------------

Create a .env file on each OBS machine (not committed) and point the push script to it with -EnvPath, or place it at one of these auto-discovered locations:

- <repo>/.env.<sheet>.local
- <repo>/.env.local
- %USERPROFILE%/.curling-club-streaming/.env.<sheet>
- %USERPROFILE%/.curling-club-streaming/.env

Recommended variables:

- OBS_INPUT_NEAR_WALL=rtsp://username:password@192.168.1.47:554/h264Preview_01_main
- OBS_INPUT_NEAR_HOUSE=rtsps://192.168.1.30:7441/etQ4c6ZW4tjeAAmK?enableSrtp
- OBS_INPUT_FAR_WALL=rtsp://username:password@192.168.1.42:554/h264Preview_01_main
- OBS_INPUT_FAR_HOUSE=rtsps://192.168.1.30:7441/LCDrHl0s3t7s7jFP?enableSrtp

Fallbacks (used only if a per-source override is missing):

- OBS_RTSP_USERNAME=yourUser
- OBS_RTSP_PASSWORD=yourPass

Usage:

powershell -ExecutionPolicy Bypass -File tools\push-obs-configs.ps1 -Sheet sheet-a -EnvPath C:\\path\\to\\.env

## Scheduler (headless)

The scheduler polls Google Calendars for Sheets A–D and (for now) provides a CLI to list upcoming streaming windows. Future work will translate these into OBS actions.

- **Location in repo**: `scheduler/`
- **Config file**: `scheduler/config.json` (see also `scheduler/README.md`)
- **Timezone**: America/Chicago

### Network placement
- **Lives on**: the club LAN, same subnet as the OBS PCs (e.g., 192.168.1.0/24)
- **Host recommendation**: a small always-on machine named `stream-scheduler` with a DHCP reservation/static IP
- **Connectivity**: requires outbound HTTPS (443) to Google; no inbound ports are required for the current CLI
- **Time sync**: ensure correct system time (NTP) so event windows are accurate

### Setup
1. Install Node 20+.
2. In `scheduler/`: install deps and create config.

```bash
cd scheduler
npm install
# edit config
$EDITOR config.json
```

3. Authentication (recommended): Google service account with Calendar Read-only.

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
```

### Running
- List upcoming events (defaults: 7 days, max 10 per sheet):

```bash
cd scheduler
npm run list -- --days 7 --max 10
```

- The config supports iCal sources and per-sheet metadata. Example shape (Sheet A shown) lives in `scheduler/config.json`.

### Operations notes
- Keep `scheduler/config.json` and any credential JSON files out of source control.
- Place the scheduler host on the same VLAN as OBS machines to minimize future control latency.

## 📚 Docs

- Operations how-to: `rfc/0008-curling-club-streaming.md`
