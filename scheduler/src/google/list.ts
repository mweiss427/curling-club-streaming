import { google } from 'googleapis';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';

const SheetKeySchema = z.enum(['A', 'B', 'C', 'D']);

const ConfigSchema = z.object({
    timezone: z.string().default('America/Chicago'),
    sheets: z.record(SheetKeySchema, z.object({
        calendarId: z.string().min(3)
    }))
});

export type SheetKey = z.infer<typeof SheetKeySchema>;

export type UpcomingEvent = {
    sheet: SheetKey;
    start: string;
    end: string;
    summary?: string;
};

function loadConfig() {
    const configPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../config.json');
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    return ConfigSchema.parse(parsed);
}

function getAuth() {
    // Prefer service account via GOOGLE_APPLICATION_CREDENTIALS; fallback to OAuth client if later needed
    // For MVP we rely on ADC which supports service accounts.
    return new google.auth.GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/calendar.readonly']
    });
}

export type CalendarClient = ReturnType<typeof google.calendar>;
export type ListDeps = {
    now?: () => Date;
    configLoader?: () => z.infer<typeof ConfigSchema>;
    calendarClient?: CalendarClient;
};

export async function listUpcoming(opts: { days: number; max: number }, deps: ListDeps = {}): Promise<UpcomingEvent[]> {
    const config = (deps.configLoader ?? loadConfig)();
    const nowFn = deps.now ?? (() => new Date());
    const now = nowFn();
    const calendar = deps.calendarClient ?? google.calendar({ version: 'v3', auth: await getAuth().getClient() });

    const maxTime = new Date(now.getTime() + opts.days * 24 * 60 * 60 * 1000);

    const results: UpcomingEvent[] = [];

    for (const sheetKey of Object.keys(config.sheets) as SheetKey[]) {
        const calendarId = config.sheets[sheetKey].calendarId;
        const resp = await calendar.events.list({
            calendarId,
            timeMin: now.toISOString(),
            timeMax: maxTime.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
            maxResults: opts.max
        });

        const items = resp.data.items ?? [];
        for (const ev of items) {
            if (ev.start?.date || ev.end?.date) {
                continue; // ignore all-day events
            }
            const start = ev.start?.dateTime ?? '';
            const end = ev.end?.dateTime ?? '';
            results.push({ sheet: sheetKey, start, end, summary: ev.summary ?? undefined });
        }
    }

    return results;
}


