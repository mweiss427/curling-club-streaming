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

### Python quick-check (prints "is live" / "is off")
A simple Python script is provided to check one calendar and print whether there is an in-progress event right now.

Setup:
- Python 3.9+
- `cd scheduler/python`
- `pip install -r requirements.txt`
- Ensure Google auth is available (prefer `GOOGLE_APPLICATION_CREDENTIALS` pointing to a service account key JSON that can read the calendar).

Usage (choose one):
- Resolve from `scheduler/config.json` by sheet key:
  - `python is_live.py --sheet A --config ../config.json`
- Provide calendar ID directly:
  - `python is_live.py --calendar-id your-calendar-id@group.calendar.google.com`

Exit prints:
- `is live` if now is within any event window
- `is off` otherwise


