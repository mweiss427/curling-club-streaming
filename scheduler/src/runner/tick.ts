import { listCurrentSingle, SheetKey } from '../google/list.js';
import { createBroadcastAndBind, Privacy } from '../youtube/createBroadcast.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);

// Timeout wrapper to prevent infinite hangs
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, operation: string): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms: ${operation}`)), timeoutMs);
    });

    try {
        return await Promise.race([promise, timeoutPromise]);
    } catch (error) {
        console.error(`[ERROR] ${operation} failed:`, error);
        throw error;
    }
}

// Simple sleep helper for polling loops
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function tick(opts: {
    sheet?: SheetKey;
    calendarId?: string;
    streamId?: string;
    streamKey?: string;
    privacy?: Privacy;
    obsExe?: string;
    obsProfile?: string;
    obsCollection?: string;
    credentialsPath?: string;
    tokenPath?: string;
}): Promise<'STARTED' | 'ALREADY_LIVE' | 'STOPPED' | 'IDLE'> {
    console.error(`[DEBUG] Tick started - Sheet: ${opts.sheet}, Calendar: ${opts.calendarId}`);

    const privacy = opts.privacy ?? 'public';
    const obsExe =
        opts.obsExe ??
        (fs.existsSync('C:/Program Files/obs-studio/bin/64bit/obs64.exe')
            ? 'C:/Program Files/obs-studio/bin/64bit/obs64.exe'
            : 'C:/Program Files (x86)/obs-studio/bin/64bit/obs64.exe');
    const profile = opts.obsProfile ?? 'Untitled';
    const collection = opts.obsCollection ?? 'Static Game Stream';

    console.error(`[DEBUG] OBS config - Exe: ${obsExe}, Profile: ${profile}, Collection: ${collection}`);

    console.error(`[DEBUG] Checking for current events...`);
    const [current] = await withTimeout(
        listCurrentSingle({ sheetKey: opts.sheet, calendarId: opts.calendarId }),
        10000, // 10 second timeout for calendar check
        'Calendar event lookup'
    );

    if (current) {
        console.error(`[DEBUG] Found live event: ${current.summary} (${current.start} - ${current.end})`);
    } else {
        console.error(`[DEBUG] No live events found`);
    }

    // Helper: is OBS running?
    async function isObsRunning(): Promise<boolean> {
        try {
            const { stdout } = await execFileAsync('powershell', ['-NoProfile', '-Command', "Get-Process obs64 -ErrorAction SilentlyContinue | Select-Object -First 1 | ForEach-Object { $_.Id }"]);
            return stdout.trim().length > 0;
        } catch {
            return false;
        }
    }

    // Helper: stop OBS gracefully using the shared PowerShell script
    async function stopObs(): Promise<void> {
        const moduleDir = path.dirname(fileURLToPath(import.meta.url));
        const repoRoot = path.resolve(moduleDir, '../../..');
        const stopScript = path.join(repoRoot, 'tools', 'stop-obs.ps1');
        await execFileAsync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', stopScript]);
    }

    // Simple state persistence to ensure one broadcast per event
    type TickState = { eventKey: string; broadcastId: string };
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    const stateDir = path.resolve(moduleDir, '../../.state');
    const statePath = path.join(stateDir, 'current.json');
    const readState = (): TickState | undefined => {
        try { return JSON.parse(fs.readFileSync(statePath, 'utf8')) as TickState; } catch { return undefined; }
    };
    const writeState = (s: TickState): void => {
        fs.mkdirSync(stateDir, { recursive: true });
        fs.writeFileSync(statePath, JSON.stringify(s), 'utf8');
    };
    const clearState = (): void => { try { fs.unlinkSync(statePath); } catch { } };

    if (!current) {
        // No event — ensure OBS is stopped
        console.error(`[DEBUG] No live event, checking OBS status...`);
        if (await isObsRunning()) {
            console.error(`[DEBUG] OBS is running but no event, stopping OBS...`);
            await stopObs();
            clearState();
            console.error(`[DEBUG] OBS stopped, returning STOPPED`);
            return 'STOPPED';
        }
        clearState();
        console.error(`[DEBUG] No event and OBS not running, returning IDLE`);
        return 'IDLE';
    }

    // Build stable key for the current calendar event window
    const eventKey = `${current.start}|${current.end}`;
    const st = readState();

    // Construct a friendly title using event time and sheet
    const start = new Date(current.start);
    const date = start.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit' });
    const time = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const sheetTag = current.sheet ? ` - Sheet ${current.sheet}` : '';
    const title = `${current.summary ?? 'Untitled Event'}${sheetTag} - ${date} - ${time}`;
    const description = current.description ?? current.summary ?? undefined;

    // Ensure a broadcast is ready and bound, but only once per event
    if (!st || st.eventKey !== eventKey) {
        console.error(`[DEBUG] Creating new broadcast for event: ${title}`);
        const broadcastId = await withTimeout(
            createBroadcastAndBind({
                title,
                description,
                privacy,
                streamId: opts.streamId,
                streamKey: opts.streamKey,
                credentialsPath: opts.credentialsPath,
                tokenPath: opts.tokenPath,
                scheduledStart: current.start
            }),
            30000, // 30 second timeout for YouTube operations
            'YouTube broadcast creation'
        );
        console.error(`[DEBUG] Broadcast created successfully: ${broadcastId}`);
        writeState({ eventKey, broadcastId });
    } else {
        console.error(`[DEBUG] Using existing broadcast for event: ${st.broadcastId}`);
    }

    // Start OBS if not already running; the single-instance will reuse
    console.error(`[DEBUG] Checking if OBS is running...`);
    const running = await isObsRunning();
    console.error(`[DEBUG] OBS running status: ${running}`);

    const args = [
        '--profile', profile,
        '--collection', collection,
        '--startstreaming',
        '--disable-auto-updater',
        '--disable-shutdown-check'
    ];
    const obsCwd = path.dirname(obsExe);

    if (!running) {
        console.error(`[DEBUG] Starting OBS (detached) with args: ${args.join(' ')}`);
        // Launch OBS detached via PowerShell to avoid blocking on first-run dialogs/crash recovery
        await withTimeout(
            execFileAsync('powershell', [
                '-NoProfile',
                '-Command',
                `Start-Process -FilePath '${obsExe}' -ArgumentList '${args.join(' ')}' -WorkingDirectory '${obsCwd}' -WindowStyle Minimized`
            ]),
            5000, // quick launch
            'OBS launch'
        );

        // Poll up to ~60 seconds for OBS to appear
        for (let i = 0; i < 20; i++) {
            if (await isObsRunning()) break;
            await sleep(3000);
        }
        console.error(`[DEBUG] OBS started (detached)`);
        return 'STARTED';
    } else {
        console.error(`[DEBUG] OBS already running, nudging startstreaming...`);
        await withTimeout(
            execFileAsync(obsExe, ['--startstreaming'], { cwd: obsCwd }),
            5000, // 5 second timeout for OBS command
            'OBS startstreaming command'
        );
        console.error(`[DEBUG] OBS startstreaming command sent`);
        return 'ALREADY_LIVE';
    }
}


