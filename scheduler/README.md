## Scheduler (headless)

Headless scheduler that reads 4 Google Calendars (Sheets A-D) and exposes a CLI to list upcoming events. Future tasks will translate events into OBS actions.

### Setup
1. Node 20+.
2. `cd scheduler && npm install`.
3. Copy `config.json.example` to `config.json` and fill in the 4 calendar IDs (for multi-sheet mode).
4. Authenticate with Google:
   - Recommended: Service account with access to all 4 calendars. Set `GOOGLE_APPLICATION_CREDENTIALS` to the JSON key file path.
   - Or use any ADC-supported method on your environment.

Security tip: keep `config.json` and any credential JSON out of source control.

### Commands
- `npm run list` — list upcoming events (defaults: 7 days, max 10 per sheet)
  - Flags: `--days N`, `--max N`
- `npm run status` — print whether any sheet is LIVE now, or OFF

Single-calendar mode (useful for local testing or per-OBS PC):

- Env variables (choose one source):
  - `CALENDAR_ID=your-calendar@group.calendar.google.com`
  - `SHEET_KEY=A` (uses `scheduler/config.json` to resolve calendarId)

- Commands:
  - `npm run status-one`
  - `npm run list-one -- --days 7 --max 10`

### Notes
- All-day events are ignored.
- This project intentionally has no UI; Google Calendar is the UI.

### Auth and .env
- Place your service account key at `scheduler/streaming.key.json` (ignored by git).
- Create a `scheduler/.env` with either `CALENDAR_ID=...@group.calendar.google.com` or `SHEET_KEY=A`.

### Troubleshooting
- If you see an auth error, confirm the key path and that the calendar is shared with the service account email (Viewer).
