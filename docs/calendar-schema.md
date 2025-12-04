## Calendar-driven streaming conventions

This repository manages stream schedules using Google Calendar as the single source of truth. There are four sheets; each sheet maps to a dedicated Google Calendar that defines when that sheet should be streaming.

### Calendars
- Sheet A → Calendar ID: to be configured
- Sheet B → Calendar ID: to be configured
- Sheet C → Calendar ID: to be configured
- Sheet D → Calendar ID: to be configured

You can use any human-readable calendar names in Google; the scheduler only requires the Calendar IDs.

### Event semantics
- The event start time marks when streaming for that sheet should turn ON.
- The event end time marks when streaming for that sheet should turn OFF.
- Overlapping events on the same sheet are resolved by the latest start time taking precedence, and stream remains ON until the maximum end time across overlapping events.
- All-day events are ignored.

### Optional event metadata (via extended properties)
If needed later, we can add private extended properties to events. None are required for MVP.
- `scene`: optional scene/profile name to activate in OBS for this window.
- `note`: optional free-form notes.

### Timezone
- The scheduler respects the timezone defined on each event; if absent, it falls back to the calendar's timezone.

### Minimum viable flow
1. Create four calendars (A/B/C/D) and share them with the service account (recommended) or a bot account.
2. Add events for streaming windows. Title and description are informational only.
3. The scheduler polls calendars and emits stream ON/OFF intents per sheet.
4. A downstream controller (later task) will translate intents to OBS actions.

### Configuration
Add a `scheduler/config.json` file with the following shape:

```json
{
  "timezone": "America/Chicago",
  "sheets": {
    "A": { 
      "calendarId": "...",
      "streamId": "stream-id-for-sheet-a",
      "streamKey": "stream-key-for-sheet-a"
    },
    "B": { 
      "calendarId": "...",
      "streamId": "stream-id-for-sheet-b",
      "streamKey": "stream-key-for-sheet-b"
    },
    "C": { 
      "calendarId": "...",
      "streamId": "stream-id-for-sheet-c",
      "streamKey": "stream-key-for-sheet-c"
    },
    "D": { 
      "calendarId": "...",
      "streamId": "stream-id-for-sheet-d",
      "streamKey": "stream-key-for-sheet-d"
    }
  }
}
```

**Required fields:**
- `calendarId`: Google Calendar ID for each sheet

**Optional fields (per sheet):**
- `streamId`: YouTube Live Stream ID (preferred over streamKey) - used when creating new broadcasts
- `streamKey`: YouTube Live Stream key/name (alternative to streamId) - used when creating new broadcasts

**Broadcast-based routing:**
The system uses broadcast-based routing to ensure each sheet streams to the correct YouTube stream:

1. When a calendar event starts, a YouTube broadcast is created for that event
2. The broadcast is bound to a stream (using `streamId`/`streamKey` from config.json or environment variables)
3. The system looks up which stream the broadcast is bound to and extracts the stream key
4. This stream key is stored in state and logged for verification
5. OBS must be configured with this stream key to stream to the correct broadcast

**Important:** 
- Each sheet should have its own unique `streamId` or `streamKey` in `config.json` (or per-machine environment variables)
- The broadcast is the source of truth - it determines which stream to use
- After creating a broadcast, the system logs the expected stream key - verify OBS is configured with this key
- If `streamId`/`streamKey` is not specified in `config.json`, the system falls back to environment variables `YOUTUBE_STREAM_ID` or `YOUTUBE_STREAM_KEY`


