import { listCurrentSingle, SheetKey } from '../google/list.js';
import { createBroadcastAndBind, Privacy } from '../youtube/createBroadcast.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);

type NpxEnvInfo = {
    env: NodeJS.ProcessEnv;
    nodeDir?: string;
    pathKey: string;
    pathExtKey?: string;
};

// Ensure the Node installation directory is on PATH so `npx` resolves even if the service account PATH is minimal
const resolveNpxEnv = (): NpxEnvInfo => {
    if (process.platform !== 'win32') {
        return { env: process.env, pathKey: 'PATH' };
    }

    const env = { ...process.env };
    const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
    const pathExtKey = Object.keys(env).find((key) => key.toLowerCase() === 'pathext') ?? 'PATHEXT';
    const nodeDir = path.dirname(process.execPath);
    const currentPath = env[pathKey] ?? '';
    if (!currentPath.toLowerCase().includes(nodeDir.toLowerCase())) {
        env[pathKey] = `${nodeDir};${currentPath}`;
    }

    const currentPathExt = env[pathExtKey] ?? process.env[pathExtKey] ?? '';
    if (!currentPathExt.toUpperCase().includes('.CMD')) {
        const base = currentPathExt.length > 0 ? currentPathExt : '.COM;.EXE;.BAT';
        env[pathExtKey] = `${base};.CMD`;
    }

    return { env, nodeDir, pathKey, pathExtKey };
};

const npxEnvInfo = resolveNpxEnv();
const npxEnv = npxEnvInfo.env;
const resolveNpxBinary = (): { binary: string; argsPrefix: string[] } => {
    if (process.platform !== 'win32') {
        return { binary: 'npx', argsPrefix: [] };
    }
    const nodeDir = npxEnvInfo.nodeDir ?? path.dirname(process.execPath);
    const shimPath = path.join(nodeDir, 'npx.cmd');
    const shim = fs.existsSync(shimPath) ? shimPath : 'npx.cmd';
    const quotedShim = `"${shim.replace(/"/g, '""')}"`;
    return { binary: 'cmd.exe', argsPrefix: ['/d', '/s', '/c', quotedShim] };
};
const { binary: npxBinary, argsPrefix: npxArgsPrefix } = resolveNpxBinary();
let loggedNpxDiagnostics = false;

const logNpxDiagnostics = async (): Promise<void> => {
    if (loggedNpxDiagnostics || process.platform !== 'win32') {
        return;
    }
    loggedNpxDiagnostics = true;
    console.error(
        `[DEBUG] npx diagnostics -> nodeDir: ${npxEnvInfo.nodeDir ?? 'unknown'}, PATH: ${npxEnv[npxEnvInfo.pathKey] ?? ''}`
    );
    if (npxEnvInfo.pathExtKey) {
        console.error(`[DEBUG] npx diagnostics -> PATHEXT: ${npxEnv[npxEnvInfo.pathExtKey] ?? ''}`);
    }
    console.error(
        `[DEBUG] npx diagnostics -> binary: ${npxBinary} ${npxArgsPrefix.length ? `(via ${npxArgsPrefix.join(' ')})` : ''}`
    );

    try {
        const { stdout } = await execFileAsync('where', ['npx'], { env: npxEnv });
        const trimmed = stdout.trim();
        console.error(`[DEBUG] where npx => ${trimmed.length > 0 ? trimmed : '(no match)'}`);
    } catch (err) {
        console.error('[WARN] `where npx` failed (diagnostic only):', err);
    }
};

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

        // Fire-and-forget: helper to dismiss crash/safe-mode dialog if it appears
        try {
            const repoRoot = path.resolve(moduleDir, '../../..');
            const dismissScript = path.join(repoRoot, 'tools', 'dismiss-obs-safemode.ps1');
            const escapedPath = dismissScript.replace(/'/g, "''");
            const psArg = `Start-Process -WindowStyle Hidden -FilePath powershell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','${escapedPath}'`;
            await execFileAsync('powershell', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', psArg]);
        } catch (e) {
            console.error('[WARN] Failed to start safe-mode dismissal helper:', e);
        }

        // Poll up to ~60 seconds for OBS to appear
        for (let i = 0; i < 20; i++) {
            if (await isObsRunning()) break;
            await sleep(3000);
        }
        console.error(`[DEBUG] OBS started (detached)`);
        return 'STARTED';
    } else {
        console.error(`[DEBUG] OBS already running, using obs-websocket to start streaming...`);
        // Use obs-websocket instead of launching OBS again (which causes "already running" dialog)
        const wsPass = process.env.OBS_WEBSOCKET_PASSWORD;
        if (wsPass) {
            try {
                const repoRoot = path.resolve(moduleDir, '../../..');
                const schedulerDir = path.join(repoRoot, 'scheduler');
                await logNpxDiagnostics();
                const npxArgs = [
                    '--yes',
                    '--prefix', schedulerDir,
                    'obs-cli',
                    '--host', '127.0.0.1',
                    '--port', '4455',
                    '--password', wsPass,
                    'StartStream'
                ];
                await withTimeout(
                    execFileAsync(npxBinary, [...npxArgsPrefix, ...npxArgs], { env: npxEnv }),
                    5000,
                    'OBS websocket StartStream'
                );
                console.error(`[DEBUG] OBS startstreaming command sent via websocket`);
            } catch (e) {
                console.error(`[WARN] Failed to start stream via websocket, falling back to launch method:`, e);
                // Fallback: try launch method (may show dialog, but better than nothing)
                await withTimeout(
                    execFileAsync('powershell', [
                        '-NoProfile',
                        '-Command',
                        `Start-Process -FilePath '${obsExe}' -ArgumentList '--startstreaming' -WorkingDirectory '${obsCwd}' -WindowStyle Minimized`
                    ]),
                    5000,
                    'OBS startstreaming command (fallback)'
                );
            }
        } else {
            console.error(`[WARN] OBS_WEBSOCKET_PASSWORD not set, cannot use websocket. Launching OBS may show "already running" dialog.`);
            // Fallback: try launch method (will show dialog)
            await withTimeout(
                execFileAsync('powershell', [
                    '-NoProfile',
                    '-Command',
                    `Start-Process -FilePath '${obsExe}' -ArgumentList '--startstreaming' -WorkingDirectory '${obsCwd}' -WindowStyle Minimized`
                ]),
                5000,
                'OBS startstreaming command (fallback)'
            );
        }
        return 'ALREADY_LIVE';
    }
}


