import { listCurrentSingle, SheetKey, getSheetConfig } from '../google/list.js';
import { createBroadcastAndBind, Privacy, getBroadcastStreamInfo } from '../youtube/createBroadcast.js';
import { getOAuthClient as getOAuthClientWithToken } from '../youtube/auth.js';
import { google } from 'googleapis';
import { execFile, exec, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

type NpxEnvInfo = {
    env: NodeJS.ProcessEnv;
    nodeDir?: string;
    pathKey: string;
    pathExtKey?: string;
};

// Ensure the Node installation directory is on PATH so `npx` resolves even if the service account PATH is minimal
const resolveNpxEnv = (): NpxEnvInfo => {
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

// Get npx.cmd path and validate it exists
const nodeDir = npxEnvInfo.nodeDir ?? path.dirname(process.execPath);
const npxCmdPath = path.join(nodeDir, 'npx.cmd');
const npxCommand = fs.existsSync(npxCmdPath) ? npxCmdPath : 'npx.cmd';

// Validate npx.cmd exists before use
if (!fs.existsSync(npxCommand) && npxCommand !== 'npx.cmd') {
    console.error(`[ERROR] npx.cmd not found at ${npxCommand}`);
}

let loggedNpxDiagnostics = false;
let npxTested = false;

// Pre-flight test: verify npx.cmd and obs-cli command structure works
const testNpxCommand = async (schedulerDir: string): Promise<void> => {
    if (npxTested) {
        return;
    }
    npxTested = true;
    try {
        // Test 1: Verify npx works
        const testNpxCmd = `"${npxCommand}" --version`;
        console.error(`[DEBUG] Testing npx.cmd: ${testNpxCmd}`);
        await execAsync(testNpxCmd, { env: npxEnv, timeout: 2000 });
        console.error(`[DEBUG] npx.cmd test passed`);

        // Test 2: Verify obs-cli can be invoked with proper -- separator
        // Use --help which doesn't require websocket connection
        const escapeArg = (arg: string): string => `"${arg.replace(/"/g, '""')}"`;
        const testObsCliCmd = `"${npxCommand}" ${escapeArg('--yes')} ${escapeArg('--prefix')} ${escapeArg(schedulerDir)} obs-cli -- --help`;
        console.error(`[DEBUG] Testing obs-cli command structure: ${testObsCliCmd}`);
        await execAsync(testObsCliCmd, { env: npxEnv, timeout: 5000 });
        console.error(`[DEBUG] obs-cli command structure test passed`);
    } catch (e) {
        console.error(`[WARN] Pre-flight test failed (will continue anyway):`, e);
        // Don't throw - we'll try anyway and fail with better error if it doesn't work
    }
};

// Redact sensitive values from command strings for logging
const redactSensitiveArgs = (args: string[], sensitiveKeys: string[]): string[] => {
    const redacted = [...args];
    for (let i = 0; i < redacted.length - 1; i++) {
        if (sensitiveKeys.includes(redacted[i])) {
            redacted[i + 1] = '***REDACTED***';
        }
    }
    return redacted;
};

const logNpxDiagnostics = async (npxArgs: string[]): Promise<void> => {
    if (loggedNpxDiagnostics) {
        return;
    }
    loggedNpxDiagnostics = true;
    console.error(
        `[DEBUG] npx diagnostics -> nodeDir: ${npxEnvInfo.nodeDir ?? 'unknown'}, PATH: ${npxEnv[npxEnvInfo.pathKey] ?? ''}`
    );
    if (npxEnvInfo.pathExtKey) {
        console.error(`[DEBUG] npx diagnostics -> PATHEXT: ${npxEnv[npxEnvInfo.pathExtKey] ?? ''}`);
    }
    // Redact password from command preview for safe logging
    const redactedArgs = redactSensitiveArgs(npxArgs, ['--password']);
    console.error(
        `[DEBUG] npx diagnostics -> command: ${npxCommand} ${redactedArgs.join(' ')}`
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

// Check if OBS stream is currently active via websocket
// Returns: true if active, false if confirmed inactive, null if unknown (can't check)
// Retries with longer waits if OBS was recently started
async function checkStreamStatus(
    schedulerDir: string,
    wsHost: string,
    wsPort: string,
    wsPass: string,
    obsStartTime?: string
): Promise<boolean | null> {
    const npxOptions = ['--yes', '--prefix', schedulerDir];
    const statusArgs = [
        '--host', wsHost,
        '--port', wsPort,
        '--password', wsPass,
        'GetStreamStatus',
        '--json'
    ];

    const escapeArg = (arg: string): string => `"${arg.replace(/"/g, '""')}"`;
    const npxOptionsStr = npxOptions.map(escapeArg).join(' ');
    const statusArgsStr = statusArgs.map(escapeArg).join(' ');
    const command = `"${npxCommand}" ${npxOptionsStr} obs-cli -- ${statusArgsStr}`;

    // Determine retry count and wait time based on when OBS was started
    let maxAttempts = 6;
    let waitTimeMs = 2000; // 2 seconds between retries

    if (obsStartTime) {
        const startTime = new Date(obsStartTime).getTime();
        const now = Date.now();
        const secondsSinceStart = (now - startTime) / 1000;

        // If OBS was started less than 60 seconds ago, wait longer
        if (secondsSinceStart < 60) {
            maxAttempts = 10; // More attempts for recently started OBS
            waitTimeMs = 3000; // 3 seconds between retries
        }
    }

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            if (attempt > 0) {
                console.error(`[DEBUG] Retrying stream status check (attempt ${attempt + 1}/${maxAttempts})...`);
                await sleep(waitTimeMs);
            } else {
                console.error(`[DEBUG] Checking stream status: ${command.replace(wsPass, '***REDACTED***')}`);
            }

            const { stdout } = await withTimeout(
                execAsync(command, { env: npxEnv, timeout: 3000 }),
                3000,
                'GetStreamStatus'
            );

            // Parse JSON response
            const status = JSON.parse(stdout.trim());
            const isActive = status.outputActive === true;
            console.error(`[DEBUG] Stream status: outputActive=${isActive}`);
            return isActive;
        } catch (e) {
            // Connection errors are expected if websocket isn't ready - retry or return null
            if (attempt < maxAttempts - 1) {
                // Will retry on next iteration
                continue;
            }
            // Last attempt failed - return null to indicate unknown status
            console.error(`[WARN] Failed to check stream status after ${attempt + 1} attempts (websocket may not be ready):`, e);
            return null; // Unknown - can't check, don't assume inactive
        }
    }
    return null; // Should never reach here, but TypeScript needs this
}

// Get OBS stream service settings (including stream key) via websocket
// Returns: stream key if found, null if can't retrieve
async function getObsStreamKey(
    schedulerDir: string,
    wsHost: string,
    wsPort: string,
    wsPass: string
): Promise<string | null> {
    const npxOptions = ['--yes', '--prefix', schedulerDir];
    const settingsArgs = [
        '--host', wsHost,
        '--port', wsPort,
        '--password', wsPass,
        'GetStreamServiceSettings',
        '--json'
    ];

    const escapeArg = (arg: string): string => `"${arg.replace(/"/g, '""')}"`;
    const npxOptionsStr = npxOptions.map(escapeArg).join(' ');
    const settingsArgsStr = settingsArgs.map(escapeArg).join(' ');
    const command = `"${npxCommand}" ${npxOptionsStr} obs-cli -- ${settingsArgsStr}`;

    try {
        const { stdout } = await withTimeout(
            execAsync(command, { env: npxEnv, timeout: 3000 }),
            3000,
            'GetStreamServiceSettings'
        );

        // Parse JSON response
        const settings = JSON.parse(stdout.trim());
        // Stream key is typically in settings.streamServiceSettings.key or settings.settings.key
        const streamKey = settings.streamServiceSettings?.key ?? settings.settings?.key ?? settings.key;
        if (streamKey && typeof streamKey === 'string' && streamKey.length > 0) {
            console.error(`[DEBUG] OBS stream key retrieved via websocket: ${streamKey.substring(0, 10)}...`);
            return streamKey;
        }
        console.error(`[WARN] Stream key not found in OBS settings response`);
        return null;
    } catch (e) {
        console.error(`[WARN] Failed to get OBS stream key via websocket:`, e);
        return null;
    }
}

// Check if YouTube broadcast is actually live via YouTube API
// Returns: true if live, false if not live, null if unknown (can't check)
async function checkYouTubeStreamStatus(
    broadcastId: string,
    credentialsPath?: string,
    tokenPath?: string
): Promise<boolean | null> {
    try {
        const keyPath = credentialsPath ?? process.env.YOUTUBE_OAUTH_CREDENTIALS ?? path.resolve(process.cwd(), 'youtube.credentials.json');
        const resolvedTokenPath = tokenPath ?? process.env.YOUTUBE_TOKEN_PATH;
        const auth = await getOAuthClientWithToken({ clientPath: keyPath, tokenPath: resolvedTokenPath });
        const youtube = google.youtube('v3');

        const response = await youtube.liveBroadcasts.list({
            auth,
            part: ['status'],
            id: [broadcastId],
            maxResults: 1
        });

        const broadcast = response.data.items?.[0];
        if (!broadcast) {
            console.error(`[WARN] Broadcast ${broadcastId} not found in YouTube API`);
            return null;
        }

        const lifeCycleStatus = broadcast.status?.lifeCycleStatus;
        const isLive = lifeCycleStatus === 'live';
        console.error(`[DEBUG] YouTube broadcast status: lifeCycleStatus=${lifeCycleStatus}, isLive=${isLive}`);
        return isLive;
    } catch (e) {
        console.error(`[WARN] Failed to check YouTube stream status:`, e);
        return null; // Unknown - can't check
    }
}

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
    // Validate sheet identifier is set
    if (!opts.sheet) {
        console.error(`[ERROR] Sheet identifier not set! Set SHEET_KEY environment variable (A, B, C, or D) or pass --sheet flag.`);
        console.error(`[ERROR] This computer must be configured for a specific sheet to stream correctly.`);
        throw new Error('Sheet identifier (SHEET_KEY) must be set for tick to run');
    }

    console.error(`[INFO] Running tick for Sheet ${opts.sheet}`);
    console.error(`[DEBUG] Tick started - Sheet: ${opts.sheet}, Calendar: ${opts.calendarId}`);

    const privacy = opts.privacy ?? 'public';
    const obsExe =
        opts.obsExe ??
        (fs.existsSync('C:/Program Files/obs-studio/bin/64bit/obs64.exe')
            ? 'C:/Program Files/obs-studio/bin/64bit/obs64.exe'
            : 'C:/Program Files (x86)/obs-studio/bin/64bit/obs64.exe');
    const profile = opts.obsProfile ?? 'Untitled';
    const collection = opts.obsCollection ?? 'Static Game Stream';

    console.error(`[INFO] Sheet ${opts.sheet} - OBS config - Exe: ${obsExe}, Profile: ${profile}, Collection: ${collection}`);

    const calendarId = opts.calendarId ?? 'from config.json';
    console.error(`[INFO] Sheet ${opts.sheet} - Checking calendar: ${calendarId} for current events...`);
    const [current] = await withTimeout(
        listCurrentSingle({ sheetKey: opts.sheet, calendarId: opts.calendarId }),
        10000, // 10 second timeout for calendar check
        'Calendar event lookup'
    );

    if (current) {
        console.error(`[INFO] Sheet ${opts.sheet} - Found live event: ${current.summary} (${current.start} - ${current.end})`);
    } else {
        console.error(`[INFO] Sheet ${opts.sheet} - No live events found`);
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
    type TickState = { eventKey: string; broadcastId: string; obsStartTime?: string; expectedStreamKey?: string };
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    const stateDir = path.resolve(moduleDir, '../../.state');
    const statePath = path.join(stateDir, `current-${opts.sheet ?? 'default'}.json`);
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
        console.error(`[INFO] Sheet ${opts.sheet} - No live event, checking OBS status...`);
        const running = await isObsRunning();
        console.error(`[INFO] Sheet ${opts.sheet} - OBS running: ${running}`);
        if (running) {
            console.error(`[INFO] Sheet ${opts.sheet} - OBS is running but no event, stopping OBS...`);
            await stopObs();
            clearState();
            console.error(`[INFO] Sheet ${opts.sheet} - OBS stopped, returning STOPPED`);
            return 'STOPPED';
        }
        clearState();
        console.error(`[INFO] Sheet ${opts.sheet} - No event and OBS not running, returning IDLE`);
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
    let broadcastId: string;
    let expectedStreamKey: string | undefined;

    if (!st || st.eventKey !== eventKey) {
        console.error(`[INFO] Sheet ${opts.sheet} - Creating new broadcast for event: ${title}`);
        broadcastId = await withTimeout(
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

        // Verify broadcast title includes correct sheet identifier
        const expectedSheetInTitle = `Sheet ${opts.sheet}`;
        if (!title.includes(expectedSheetInTitle)) {
            console.error(`[ERROR] Broadcast title "${title}" does not include expected sheet identifier "${expectedSheetInTitle}"`);
            console.error(`[ERROR] This may indicate a configuration issue. Broadcast should be for Sheet ${opts.sheet}.`);
        } else {
            console.error(`[DEBUG] Broadcast title verified - contains sheet identifier: ${expectedSheetInTitle}`);
        }

        // Look up the stream key from the broadcast
        console.error(`[DEBUG] Looking up stream key for broadcast ${broadcastId}...`);
        const streamInfo = await getBroadcastStreamInfo(
            broadcastId,
            opts.credentialsPath,
            opts.tokenPath
        );
        if (streamInfo?.streamKey) {
            expectedStreamKey = streamInfo.streamKey;
            console.error(`[DEBUG] Broadcast is bound to stream key: ${expectedStreamKey}`);
        } else {
            console.error(`[WARN] Could not determine stream key from broadcast ${broadcastId}`);
        }

        writeState({ eventKey, broadcastId, expectedStreamKey });
    } else {
        broadcastId = st.broadcastId;
        expectedStreamKey = st.expectedStreamKey;
        console.error(`[DEBUG] Using existing broadcast for event: ${broadcastId}`);

        // Verify existing broadcast belongs to this sheet by checking its title
        let broadcastTitleValid = false;
        try {
            const keyPath = opts.credentialsPath ?? process.env.YOUTUBE_OAUTH_CREDENTIALS ?? path.resolve(process.cwd(), 'youtube.credentials.json');
            const resolvedTokenPath = opts.tokenPath ?? process.env.YOUTUBE_TOKEN_PATH;
            const auth = await getOAuthClientWithToken({ clientPath: keyPath, tokenPath: resolvedTokenPath });
            const youtube = google.youtube('v3');

            const broadcastResp = await youtube.liveBroadcasts.list({
                auth,
                part: ['snippet'],
                id: [broadcastId],
                maxResults: 1
            });

            const broadcast = broadcastResp.data.items?.[0];
            if (broadcast) {
                const broadcastTitle = broadcast.snippet?.title ?? '';
                const expectedSheetInTitle = `Sheet ${opts.sheet}`;
                if (!broadcastTitle.includes(expectedSheetInTitle)) {
                    console.error(`[ERROR] Existing broadcast ${broadcastId} title "${broadcastTitle}" does not match expected sheet ${opts.sheet}`);
                    console.error(`[ERROR] Expected title to contain "${expectedSheetInTitle}". This broadcast may belong to a different sheet.`);
                    console.error(`[ERROR] Clearing state and will create a new broadcast for Sheet ${opts.sheet} on next iteration.`);
                    clearState();
                    broadcastTitleValid = false;
                } else {
                    console.error(`[DEBUG] Existing broadcast verified - title contains sheet identifier: ${expectedSheetInTitle}`);
                    broadcastTitleValid = true;
                }
            }
        } catch (e: any) {
            console.error(`[WARN] Could not verify existing broadcast title (non-fatal):`, e);
            // Assume valid if we can't check (don't want to break existing functionality)
            broadcastTitleValid = true;
        }

        // If broadcast doesn't match sheet, we've cleared state - create a new broadcast immediately
        if (!broadcastTitleValid) {
            console.error(`[INFO] State cleared due to broadcast mismatch. Creating new broadcast for Sheet ${opts.sheet}...`);
            // Fall through to create new broadcast (treat as if state was empty)
            // We'll create the broadcast below by treating this as a new event
            const newBroadcastId = await withTimeout(
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
                30000,
                'YouTube broadcast creation (after mismatch)'
            );
            console.error(`[DEBUG] New broadcast created successfully: ${newBroadcastId}`);

            // Look up the stream key from the new broadcast
            console.error(`[DEBUG] Looking up stream key for broadcast ${newBroadcastId}...`);
            const streamInfo = await getBroadcastStreamInfo(
                newBroadcastId,
                opts.credentialsPath,
                opts.tokenPath
            );
            if (streamInfo?.streamKey) {
                expectedStreamKey = streamInfo.streamKey;
                console.error(`[DEBUG] Broadcast is bound to stream key: ${expectedStreamKey}`);
            } else {
                console.error(`[WARN] Could not determine stream key from broadcast ${newBroadcastId}`);
            }

            broadcastId = newBroadcastId;
            writeState({ eventKey, broadcastId, expectedStreamKey });
        }

        // If we don't have the stream key in state, look it up
        if (!expectedStreamKey) {
            console.error(`[DEBUG] Stream key not in state, looking up from broadcast...`);
            const streamInfo = await getBroadcastStreamInfo(
                broadcastId,
                opts.credentialsPath,
                opts.tokenPath
            );
            if (streamInfo?.streamKey) {
                expectedStreamKey = streamInfo.streamKey;
                console.error(`[DEBUG] Found stream key: ${expectedStreamKey}`);
                // Update state with the stream key
                writeState({ ...st, expectedStreamKey });
            }
        }
    }

    // Check if OBS is running (needed for validation)
    console.error(`[INFO] Sheet ${opts.sheet} - Checking if OBS is running...`);
    const running = await isObsRunning();
    console.error(`[INFO] Sheet ${opts.sheet} - OBS running status: ${running}`);

    // Validate that OBS should be configured with the expected stream key
    if (expectedStreamKey) {
        const sheetName = opts.sheet ?? 'unknown';
        console.error(`[INFO] ===== Stream Configuration for Sheet ${sheetName} =====`);
        console.error(`[INFO] Broadcast ID: ${broadcastId}`);
        console.error(`[INFO] Expected stream key: ${expectedStreamKey}`);
        console.error(`[INFO] OBS config location: {OBS_DATA_DIR}/basic/profiles/${profile}/service.json -> settings.key`);

        // Pre-flight check: Verify OBS stream key via websocket if OBS is running
        const wsPass = process.env.OBS_WEBSOCKET_PASSWORD;
        if (wsPass && running) {
            const repoRoot = path.resolve(moduleDir, '../../..');
            const schedulerDir = path.join(repoRoot, 'scheduler');
            const wsHost = '127.0.0.1';
            const wsPort = '4455';

            console.error(`[INFO] Pre-flight check: Verifying OBS stream key matches expected...`);
            const obsStreamKey = await getObsStreamKey(schedulerDir, wsHost, wsPort, wsPass);

            if (obsStreamKey) {
                if (obsStreamKey === expectedStreamKey) {
                    console.error(`[INFO] ✅ OBS stream key matches expected - configuration is correct!`);
                } else {
                    console.error(`[ERROR] ❌ CRITICAL MISMATCH: OBS is configured with stream key "${obsStreamKey.substring(0, 20)}..." but expected "${expectedStreamKey.substring(0, 20)}..."`);
                    console.error(`[ERROR] Sheet ${sheetName} will stream to the WRONG YouTube broadcast!`);
                    console.error(`[ERROR] Fix: Update OBS stream settings to use the expected stream key above.`);
                    console.error(`[ERROR] OBS Settings → Stream → Service: YouTube - RTMPS → Stream Key`);
                }
            } else {
                console.error(`[WARN] Could not retrieve OBS stream key via websocket. Manual verification required.`);
            }
        } else if (!wsPass) {
            console.error(`[WARN] OBS_WEBSOCKET_PASSWORD not set - cannot verify OBS stream key automatically.`);
            console.error(`[WARN] Manual verification required: Check OBS settings match expected stream key above.`);
        } else if (!running) {
            console.error(`[INFO] OBS not running yet - will verify stream key after OBS starts.`);
        }

        // Check if expected stream key matches config.json for this sheet
        try {
            const sheetConfig = getSheetConfig(opts.sheet);
            if (sheetConfig?.streamKey && sheetConfig.streamKey !== expectedStreamKey) {
                console.error(`[ERROR] MISMATCH: Expected stream key "${expectedStreamKey}" does not match config.json streamKey "${sheetConfig.streamKey}" for Sheet ${sheetName}`);
                console.error(`[ERROR] The broadcast is bound to a different stream than configured for this sheet.`);
                console.error(`[ERROR] This may cause Sheet ${sheetName} to stream to the wrong YouTube broadcast.`);
            } else if (sheetConfig?.streamKey && sheetConfig.streamKey === expectedStreamKey) {
                console.error(`[INFO] Stream key matches config.json for Sheet ${sheetName} - configuration is correct.`);
            }
        } catch (e) {
            console.error(`[DEBUG] Could not verify stream key against config.json (non-fatal):`, e);
        }

        console.error(`[INFO] ============================================================`);
    } else {
        console.error(`[WARN] Could not determine expected stream key for broadcast ${broadcastId}. Cannot validate OBS configuration.`);
        console.error(`[WARN] Sheet ${opts.sheet} may not stream to the correct broadcast.`);
    }

    // Start OBS if not already running; the single-instance will reuse

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
        // Launch OBS directly using spawn (avoiding PowerShell due to AccessViolationException crashes)
        try {
            const obsProcess = spawn(obsExe, args, {
                cwd: obsCwd,
                detached: true,
                stdio: 'ignore',
                windowsHide: true
            });
            // Unref the process so Node.js can exit independently
            obsProcess.unref();
            console.error(`[DEBUG] OBS spawn initiated (PID: ${obsProcess.pid ?? 'unknown'})`);
        } catch (spawnError: any) {
            // Fallback: try using cmd.exe to launch OBS if direct spawn fails
            console.error(`[WARN] Direct spawn failed, trying cmd.exe fallback:`, spawnError);
            try {
                const cmdArgs = ['/c', 'start', '/min', obsExe, ...args];
                const cmdProcess = spawn('cmd.exe', cmdArgs, {
                    cwd: obsCwd,
                    detached: true,
                    stdio: 'ignore',
                    windowsHide: true
                });
                cmdProcess.unref();
                console.error(`[DEBUG] OBS launched via cmd.exe fallback`);
            } catch (cmdError: any) {
                console.error(`[ERROR] Failed to launch OBS via both spawn and cmd.exe:`, cmdError);
                throw new Error(`OBS launch failed: ${cmdError.message}`);
            }
        }

        // Fire-and-forget: helper to dismiss crash/safe-mode dialog if it appears
        // Note: This still uses PowerShell, but it's non-critical and will fail gracefully
        try {
            const repoRoot = path.resolve(moduleDir, '../../..');
            const dismissScript = path.join(repoRoot, 'tools', 'dismiss-obs-safemode.ps1');
            if (fs.existsSync(dismissScript)) {
                // Try to launch via cmd.exe instead of PowerShell to avoid crashes
                const cmdArgs = ['/c', 'start', '/min', 'powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', dismissScript];
                const dismissProcess = spawn('cmd.exe', cmdArgs, {
                    detached: true,
                    stdio: 'ignore',
                    windowsHide: true
                });
                dismissProcess.unref();
            }
        } catch (e) {
            console.error('[WARN] Failed to start safe-mode dismissal helper (non-critical):', e);
        }

        // Poll up to ~60 seconds for OBS to appear
        for (let i = 0; i < 20; i++) {
            if (await isObsRunning()) break;
            await sleep(3000);
        }
        console.error(`[DEBUG] OBS started (detached)`);

        // Track when OBS was started for better websocket retry logic
        const obsStartTime = new Date().toISOString();
        const currentState = readState();
        if (currentState) {
            writeState({ ...currentState, obsStartTime });
        }

        // Wait for websocket to be ready and verify stream started (if websocket password is set)
        const wsPass = process.env.OBS_WEBSOCKET_PASSWORD;
        if (wsPass) {
            const repoRoot = path.resolve(moduleDir, '../../..');
            const schedulerDir = path.join(repoRoot, 'scheduler');
            const wsHost = '127.0.0.1';
            const wsPort = '4455';

            console.error(`[DEBUG] Waiting for OBS websocket server to be ready...`);
            // Wait up to 20 seconds for websocket to be ready (40 attempts * 500ms)
            let wsReady = false;
            for (let i = 0; i < 40; i++) {
                try {
                    const status = await checkStreamStatus(schedulerDir, wsHost, wsPort, wsPass, obsStartTime);
                    if (status !== null) {
                        // Got a response (true or false), websocket is ready
                        wsReady = true;
                        console.error(`[DEBUG] OBS websocket server is ready`);

                        // Verify OBS stream key matches expected (if we have expectedStreamKey)
                        if (expectedStreamKey) {
                            console.error(`[INFO] Sheet ${opts.sheet} - Verifying OBS stream key after startup...`);
                            const obsStreamKey = await getObsStreamKey(schedulerDir, wsHost, wsPort, wsPass);
                            if (obsStreamKey) {
                                if (obsStreamKey === expectedStreamKey) {
                                    console.error(`[INFO] ✅ Sheet ${opts.sheet} - OBS stream key verified correctly after startup!`);
                                } else {
                                    console.error(`[ERROR] ❌ Sheet ${opts.sheet} - OBS stream key "${obsStreamKey.substring(0, 20)}..." does NOT match expected "${expectedStreamKey.substring(0, 20)}..."`);
                                    console.error(`[ERROR] Sheet ${opts.sheet} will stream to the WRONG broadcast! Fix OBS settings immediately.`);
                                }
                            } else {
                                console.error(`[WARN] Could not retrieve OBS stream key for verification`);
                            }
                        }

                        // If stream is not active, try to start it
                        if (status === false) {
                            console.error(`[DEBUG] Stream is not active, attempting to start via websocket...`);
                            try {
                                const npxOptions = ['--yes', '--prefix', schedulerDir];
                                const obsCliArgs = ['--host', wsHost, '--port', wsPort, '--password', wsPass, 'StartStream'];
                                const escapeArg = (arg: string): string => `"${arg.replace(/"/g, '""')}"`;
                                const npxOptionsStr = npxOptions.map(escapeArg).join(' ');
                                const obsCliArgsStr = obsCliArgs.map(escapeArg).join(' ');
                                const command = `"${npxCommand}" ${npxOptionsStr} obs-cli -- ${obsCliArgsStr}`;
                                await withTimeout(execAsync(command, { env: npxEnv, timeout: 5000 }), 5000, 'StartStream after OBS launch');
                                console.error(`[DEBUG] StartStream command sent successfully`);
                            } catch (e) {
                                console.error(`[WARN] Failed to send StartStream command after OBS launch:`, e);
                            }
                        } else {
                            console.error(`[DEBUG] Stream is already active`);
                        }
                        break;
                    }
                } catch (e) {
                    // Connection error - websocket not ready yet, continue waiting
                }
                await sleep(500);
            }
            if (!wsReady) {
                console.error(`[WARN] OBS websocket server not ready after 20 seconds. Stream may not have started automatically.`);
            }
        } else {
            console.error(`[WARN] OBS_WEBSOCKET_PASSWORD not set, cannot verify stream started after OBS launch`);
        }

        return 'STARTED';
    } else {
        console.error(`[DEBUG] OBS already running, validating stream status...`);
        // Use obs-websocket to check and start streaming if needed
        const wsPass = process.env.OBS_WEBSOCKET_PASSWORD;
        const currentState = readState();
        const broadcastId = currentState?.broadcastId;

        if (wsPass) {
            try {
                const repoRoot = path.resolve(moduleDir, '../../..');
                const schedulerDir = path.join(repoRoot, 'scheduler');
                const wsHost = '127.0.0.1';
                const wsPort = '4455';

                // Pre-flight test: verify npx and obs-cli command structure works
                await testNpxCommand(schedulerDir);

                // Step 1: Try to check stream status via websocket
                console.error(`[DEBUG] Checking stream status via websocket...`);
                const wsStreamStatus = await checkStreamStatus(
                    schedulerDir,
                    wsHost,
                    wsPort,
                    wsPass,
                    currentState?.obsStartTime
                );

                let shouldStartStream = false;
                let validationMethod = '';

                if (wsStreamStatus === true) {
                    console.error(`[DEBUG] Stream is confirmed active via websocket, skipping StartStream`);
                    validationMethod = 'websocket';
                } else if (wsStreamStatus === false) {
                    console.error(`[DEBUG] Stream is confirmed inactive via websocket, will start stream`);
                    shouldStartStream = true;
                    validationMethod = 'websocket';
                } else {
                    // Websocket status is unknown (null) - try YouTube API as fallback
                    console.error(`[DEBUG] Websocket status unknown, checking YouTube API...`);
                    if (broadcastId) {
                        const ytStreamStatus = await checkYouTubeStreamStatus(
                            broadcastId,
                            opts.credentialsPath,
                            opts.tokenPath
                        );

                        if (ytStreamStatus === true) {
                            console.error(`[DEBUG] Stream is confirmed live via YouTube API, skipping StartStream`);
                            validationMethod = 'youtube-api';
                        } else if (ytStreamStatus === false) {
                            console.error(`[DEBUG] Stream is confirmed not live via YouTube API, will start stream`);
                            shouldStartStream = true;
                            validationMethod = 'youtube-api';
                        } else {
                            // Both methods failed - can't validate
                            console.error(`[WARN] Cannot validate stream status (websocket and YouTube API both unavailable). Will attempt to start stream to be safe.`);
                            shouldStartStream = true; // Default to starting if we can't confirm it's active
                            validationMethod = 'none (cannot validate - starting to be safe)';
                        }
                    } else {
                        console.error(`[WARN] Cannot validate stream status (websocket unavailable and no broadcast ID). Will attempt to start stream to be safe.`);
                        shouldStartStream = true; // Default to starting if we can't confirm it's active
                        validationMethod = 'none (cannot validate - starting to be safe)';
                    }
                }

                if (shouldStartStream) {
                    console.error(`[DEBUG] Stream is not active (validated via ${validationMethod}), starting stream...`);

                    // Separate npx options from obs-cli arguments
                    const npxOptions = ['--yes', '--prefix', schedulerDir];
                    const obsCliArgs = [
                        '--host', wsHost,
                        '--port', wsPort,
                        '--password', wsPass,
                        'StartStream'
                    ];

                    // Combine for logging (redact password)
                    const allArgsForLog = [...npxOptions, 'obs-cli', '--', ...obsCliArgs];
                    await logNpxDiagnostics(allArgsForLog);

                    // Build command string with -- separator
                    const escapeArg = (arg: string): string => `"${arg.replace(/"/g, '""')}"`;
                    const npxOptionsStr = npxOptions.map(escapeArg).join(' ');
                    const obsCliArgsStr = obsCliArgs.map(escapeArg).join(' ');
                    const command = `"${npxCommand}" ${npxOptionsStr} obs-cli -- ${obsCliArgsStr}`;

                    // Retry StartStream command if websocket isn't ready yet
                    // OBS websocket server may take time to start after OBS launches
                    let startStreamSuccess = false;
                    let maxStartAttempts = 15;
                    let startWaitTimeMs = 2000; // 2 seconds between retries

                    // If OBS was recently started, wait longer and retry more
                    if (currentState?.obsStartTime) {
                        const startTime = new Date(currentState.obsStartTime).getTime();
                        const now = Date.now();
                        const secondsSinceStart = (now - startTime) / 1000;

                        if (secondsSinceStart < 60) {
                            maxStartAttempts = 20; // More attempts for recently started OBS
                            startWaitTimeMs = 3000; // 3 seconds between retries
                            console.error(`[DEBUG] OBS was started ${Math.round(secondsSinceStart)}s ago, using extended retry logic for StartStream`);
                        }
                    }

                    for (let attempt = 0; attempt < maxStartAttempts; attempt++) {
                        try {
                            if (attempt > 0) {
                                console.error(`[DEBUG] Retrying StartStream command (attempt ${attempt + 1}/${maxStartAttempts})...`);
                                await sleep(startWaitTimeMs);
                            } else {
                                console.error(`[DEBUG] Executing npx command: ${command.replace(wsPass, '***REDACTED***')}`);
                            }

                            // Primary method: use exec() - simpler and more reliable for .cmd files
                            await withTimeout(
                                execAsync(command, { env: npxEnv, timeout: 5000 }),
                                5000,
                                'OBS websocket StartStream'
                            );
                            console.error(`[DEBUG] OBS startstreaming command sent via websocket`);
                            startStreamSuccess = true;
                            break;
                        } catch (execError: any) {
                            const errorStr = String(execError?.stderr ?? execError?.message ?? execError);
                            const isConnectionError = errorStr.includes('CONNECTION_ERROR') || errorStr.includes('Connection error');

                            if (isConnectionError && attempt < maxStartAttempts - 1) {
                                // Connection error - websocket not ready yet, will retry
                                console.error(`[DEBUG] Websocket not ready yet (attempt ${attempt + 1}/${maxStartAttempts}), will retry...`);
                                continue;
                            }

                            // Try PowerShell fallback for non-connection errors or last attempt
                            if (attempt === 0 || (!isConnectionError && attempt < maxStartAttempts - 1)) {
                                console.error(`[WARN] exec() failed, trying PowerShell fallback:`, execError);
                                try {
                                    const psCommand = `& "${npxCommand}" ${npxOptionsStr} obs-cli -- ${obsCliArgsStr}`;
                                    await withTimeout(
                                        execFileAsync('powershell', ['-NoProfile', '-Command', psCommand], { env: npxEnv }),
                                        5000,
                                        'OBS websocket StartStream (PowerShell fallback)'
                                    );
                                    console.error(`[DEBUG] OBS startstreaming command sent via websocket (PowerShell)`);
                                    startStreamSuccess = true;
                                    break;
                                } catch (psError) {
                                    if (attempt < maxStartAttempts - 1) {
                                        continue; // Retry on next iteration
                                    }
                                    throw psError; // Last attempt failed
                                }
                            } else {
                                // Last attempt failed
                                throw execError;
                            }
                        }
                    }

                    if (!startStreamSuccess) {
                        console.error(`[ERROR] Failed to send StartStream command after ${maxStartAttempts} attempts. Websocket may not be available.`);
                    }

                    // Verify that stream actually started
                    console.error(`[DEBUG] Waiting 3 seconds before verifying stream started...`);
                    await sleep(3000);
                    const verifyStatus = await checkStreamStatus(
                        schedulerDir,
                        wsHost,
                        wsPort,
                        wsPass,
                        currentState?.obsStartTime
                    );
                    if (verifyStatus === true) {
                        console.error(`[DEBUG] Stream verification successful - stream is now active`);
                    } else if (verifyStatus === false) {
                        console.error(`[ERROR] Stream verification failed - stream is still not active after StartStream command`);
                    } else {
                        console.error(`[WARN] Stream verification inconclusive - could not confirm stream status after StartStream command`);
                    }
                } else {
                    console.error(`[DEBUG] Stream validation complete (method: ${validationMethod}), no action needed`);
                }
            } catch (e) {
                // If websocket operations fail, don't launch OBS again - it's already running
                console.error(`[WARN] Failed to validate or start stream via websocket (OBS is already running, not launching again):`, e);
            }
        } else {
            console.error(`[ERROR] OBS_WEBSOCKET_PASSWORD not set, cannot validate or start stream via websocket. OBS is already running.`);
            // Try YouTube API as fallback if we have a broadcast ID
            if (broadcastId) {
                console.error(`[DEBUG] Attempting to check stream status via YouTube API as fallback...`);
                const ytStreamStatus = await checkYouTubeStreamStatus(
                    broadcastId,
                    opts.credentialsPath,
                    opts.tokenPath
                );
                if (ytStreamStatus === false) {
                    console.error(`[ERROR] YouTube API confirms stream is NOT live, but cannot start stream without OBS_WEBSOCKET_PASSWORD. Please set OBS_WEBSOCKET_PASSWORD in environment.`);
                } else if (ytStreamStatus === true) {
                    console.error(`[DEBUG] YouTube API confirms stream IS live, no action needed`);
                } else {
                    console.error(`[WARN] Cannot verify stream status via YouTube API either. Stream may or may not be active.`);
                }
            } else {
                console.error(`[ERROR] No broadcast ID available and no websocket password. Cannot verify or start stream.`);
            }
        }
        return 'ALREADY_LIVE';
    }
}


