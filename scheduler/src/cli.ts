import 'dotenv/config';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { listUpcoming, listCurrent, listUpcomingSingle, listCurrentSingle, SheetKey } from './google/list.js';
import { createBroadcastAndBind } from './youtube/createBroadcast.js';
import { tick } from './runner/tick.js';

async function main(): Promise<void> {
    const argv = await yargs(hideBin(process.argv))
        .command('list', 'List upcoming events for all configured sheets', (y) =>
            y.option('max', { type: 'number', default: 10 })
                .option('days', { type: 'number', default: 7 })
        )
        .command('status', 'Show if there is a live event right now for any sheet')
        .command('list-one', 'List upcoming events for a single calendar (env or flags)', (y) =>
            y.option('max', { type: 'number', default: 10 })
                .option('days', { type: 'number', default: 7 })
                .option('calendar-id', { type: 'string' })
                .option('sheet', { choices: ['A', 'B', 'C', 'D'] as const })
        )
        .command('status-one', 'Show if there is a live event right now for a single calendar (env or flags)', (y) =>
            y.option('calendar-id', { type: 'string' })
                .option('sheet', { choices: ['A', 'B', 'C', 'D'] as const })
        )
        .command('yt-create', 'Create a YouTube broadcast and bind to a stream', (y) =>
            y.option('title', { type: 'string', demandOption: true })
                .option('description', { type: 'string' })
                .option('privacy', { choices: ['public', 'unlisted', 'private'] as const, default: 'public' })
                .option('stream-id', { type: 'string' })
                .option('stream-key', { type: 'string' })
                .option('credentials', { type: 'string', describe: 'Path to OAuth client credentials JSON' })
        )
        .command('tick', 'Run one minute-tick pass for a single sheet', (y) =>
            y.option('calendar-id', { type: 'string' })
                .option('sheet', { choices: ['A', 'B', 'C', 'D'] as const })
                .option('privacy', { choices: ['public', 'unlisted', 'private'] as const, default: 'public' })
                .option('stream-id', { type: 'string' })
                .option('stream-key', { type: 'string' })
                .option('credentials', { type: 'string' })
                .option('obs-exe', { type: 'string' })
                .option('obs-profile', { type: 'string', default: 'Untitled' })
                .option('obs-collection', { type: 'string', default: 'Static Game Stream' })
        )
        .demandCommand(1)
        .help()
        .parse();

    const [cmd] = argv._;
    if (cmd === 'list') {
        const results = await listUpcoming({ days: Number(argv.days), max: Number(argv.max) });
        for (const r of results) {
            console.log(`[Sheet ${r.sheet}] ${r.start} → ${r.end}  ${r.summary ?? ''}`.trim());
        }
        return;
    }

    if (cmd === 'status') {
        try {
            const lives = await listCurrent();
            if (lives.length === 0) {
                console.log('OFF: no sheets are live right now');
            } else {
                for (const ev of lives) {
                    console.log(`LIVE [Sheet ${ev.sheet}] ${ev.summary ?? ''}  ${ev.start} → ${ev.end}`.trim());
                }
            }
            return;
        } catch (err: any) {
            const msg = String(err?.message ?? err);
            if (msg.includes('Could not load the default credentials')) {
                console.error('ERROR: Unable to authenticate to Google Calendar. Set GOOGLE_APPLICATION_CREDENTIALS to a readable service account JSON with access to your calendars.');
            } else {
                console.error(`ERROR: Failed to read calendar status: ${msg}`);
            }
            process.exitCode = 1;
            return;
        }
    }

    if (cmd === 'list-one') {
        const source = {
            calendarId: (argv['calendar-id'] as string | undefined) ?? process.env.CALENDAR_ID,
            sheetKey: (argv.sheet as SheetKey | undefined) ?? (process.env.SHEET_KEY as SheetKey | undefined)
        };
        const results = await listUpcomingSingle({ days: Number(argv.days), max: Number(argv.max) }, source);
        for (const r of results) {
            const sheetSuffix = r.sheet ? ` [Sheet ${r.sheet}]` : '';
            console.log(`${sheetSuffix} ${r.start} → ${r.end}  ${r.summary ?? ''}`.trim());
        }
        return;
    }

    if (cmd === 'status-one') {
        try {
            const source = {
                calendarId: (argv['calendar-id'] as string | undefined) ?? process.env.CALENDAR_ID,
                sheetKey: (argv.sheet as SheetKey | undefined) ?? (process.env.SHEET_KEY as SheetKey | undefined)
            };
            const lives = await listCurrentSingle(source);
            if (lives.length === 0) {
                console.log('OFF');
            } else {
                for (const ev of lives) {
                    const sheetSuffix = ev.sheet ? ` [Sheet ${ev.sheet}]` : '';
                    console.log(`LIVE${sheetSuffix} ${ev.summary ?? ''}  ${ev.start} → ${ev.end}`.trim());
                }
            }
            return;
        } catch (err: any) {
            const msg = String(err?.message ?? err);
            if (msg.includes('Provide a calendarId or sheetKey')) {
                console.error('ERROR: Provide --calendar-id or --sheet, or set CALENDAR_ID / SHEET_KEY env variables.');
            } else if (msg.includes('Could not load the default credentials')) {
                console.error('ERROR: Unable to authenticate to Google Calendar. Set GOOGLE_APPLICATION_CREDENTIALS to a readable service account JSON with access to your calendars.');
            } else {
                console.error(`ERROR: Failed to read calendar status: ${msg}`);
            }
            process.exitCode = 1;
            return;
        }
    }

    if (cmd === 'yt-create') {
        const id = await createBroadcastAndBind({
            title: String(argv.title),
            description: (argv.description as string | undefined) ?? undefined,
            privacy: (argv.privacy as any) ?? 'public',
            streamId: (argv['stream-id'] as string | undefined) ?? undefined,
            streamKey: (argv['stream-key'] as string | undefined) ?? undefined,
            credentialsPath: (argv.credentials as string | undefined) ?? undefined
        });
        console.log(id);
        return;
    }

    if (cmd === 'tick') {
        const result = await tick({
            sheet: (argv.sheet as SheetKey | undefined) ?? (process.env.SHEET_KEY as SheetKey | undefined),
            calendarId: (argv['calendar-id'] as string | undefined) ?? process.env.CALENDAR_ID,
            privacy: (argv.privacy as any) ?? 'public',
            streamId: (argv['stream-id'] as string | undefined) ?? undefined,
            streamKey: (argv['stream-key'] as string | undefined) ?? undefined,
            credentialsPath: (argv.credentials as string | undefined) ?? undefined,
            obsExe: (argv['obs-exe'] as string | undefined) ?? undefined,
            obsProfile: (argv['obs-profile'] as string | undefined) ?? 'Untitled',
            obsCollection: (argv['obs-collection'] as string | undefined) ?? 'Static Game Stream'
        });
        console.log(result);
        return;
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});


