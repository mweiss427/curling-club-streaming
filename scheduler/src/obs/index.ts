import path from 'node:path';
import fs from 'node:fs';
import {
    isProcessRunning,
    killProcess,
    spawnProcess,
    dismissOBSDialogs,
    sleep,
    withTimeout,
    readState,
    writeState
} from '../system/index.js';
import * as websocket from './websocket.js';

const OBS_PROCESS_NAME = 'obs64.exe';
const DEFAULT_WS_HOST = '127.0.0.1';
const DEFAULT_WS_PORT = '4455';

// Re-export websocket functions for convenience
export { getStreamStatus as getStreamStatusFromWs, startStream as startStreamFromWs } from './websocket.js';

export interface StartOBSOptions {
    exe?: string;
    profile?: string;
    collection?: string;
    wsPassword?: string;
    wsHost?: string;
    wsPort?: string;
}

export interface StopOBSOptions {
    wsPassword?: string;
    wsHost?: string;
    wsPort?: string;
}

/**
 * Check if OBS process is running
 */
export async function isOBSRunning(): Promise<boolean> {
    return isProcessRunning(OBS_PROCESS_NAME);
}

/**
 * Start OBS with the specified profile and collection
 */
export async function startOBS(options: StartOBSOptions = {}): Promise<void> {
    const obsExe =
        options.exe ??
        process.env.OBS_EXE ??
        (fs.existsSync('C:/Program Files/obs-studio/bin/64bit/obs64.exe')
            ? 'C:/Program Files/obs-studio/bin/64bit/obs64.exe'
            : 'C:/Program Files (x86)/obs-studio/bin/64bit/obs64.exe');

    const profile = options.profile ?? process.env.OBS_PROFILE ?? 'Untitled';
    const collection = options.collection ?? process.env.OBS_COLLECTION ?? 'Static Game Stream';

    // First, ensure any lingering OBS processes are terminated
    console.error(`[DEBUG] Ensuring no lingering OBS processes before starting...`);
    try {
        await killProcess(OBS_PROCESS_NAME, true);
        console.error(`[DEBUG] Terminated any existing OBS processes`);
        await sleep(2000);
    } catch (e: any) {
        // Ignore errors - process may not exist, which is fine
        console.error(`[DEBUG] No existing OBS processes to terminate (or already terminated)`);
    }

    const args = [
        '--profile',
        profile,
        '--collection',
        collection,
        '--startstreaming',
        '--disable-auto-updater',
        '--disable-shutdown-check'
    ];
    const obsCwd = path.dirname(obsExe);

    console.error(`[DEBUG] Starting OBS with args: ${args.join(' ')}`);
    const obsProcess = spawnProcess(obsExe, args, {
        cwd: obsCwd,
        detached: true,
        stdio: 'ignore',
        windowsHide: true
    });
    console.error(`[DEBUG] OBS spawn initiated (PID: ${obsProcess.pid ?? 'unknown'})`);

    // Launch helpers to dismiss any dialogs that might appear
    await dismissOBSDialogs();

    // Poll up to ~60 seconds for OBS to appear
    let obsProcessDetected = false;
    for (let i = 0; i < 20; i++) {
        if (await isOBSRunning()) {
            obsProcessDetected = true;
            break;
        }
        await sleep(3000);
    }

    if (!obsProcessDetected) {
        console.error(`[ERROR] OBS process did not appear after 60 seconds. OBS may have failed to start.`);
        throw new Error('OBS process did not start');
    }

    console.error(`[DEBUG] OBS process detected`);

    // Verify OBS is still running after a short delay (catches immediate crashes)
    await sleep(2000);
    if (!(await isOBSRunning())) {
        console.error(`[ERROR] OBS process disappeared shortly after starting. OBS may have crashed.`);
        throw new Error('OBS process crashed after startup');
    }

    console.error(`[DEBUG] OBS started (detached)`);

    // Track when OBS was started for better websocket retry logic
    const obsStartTime = new Date().toISOString();
    // Note: We'll update state in the orchestrator, but we could do it here too
}

/**
 * Stop OBS gracefully (websocket + process termination)
 */
export async function stopOBS(options: StopOBSOptions = {}): Promise<void> {
    const wsHost = options.wsHost ?? DEFAULT_WS_HOST;
    const wsPort = options.wsPort ?? DEFAULT_WS_PORT;
    const wsPass = options.wsPassword ?? process.env.OBS_WEBSOCKET_PASSWORD;

    // Step 1: Stop outputs via websocket if password is set
    if (wsPass) {
        console.error(`[DEBUG] Stopping OBS outputs via websocket...`);
        try {
            await websocket.stopStream(wsHost, wsPort, wsPass);
        } catch (e) {
            console.error(`[DEBUG] StopStream failed (non-fatal):`, e);
        }

        try {
            await websocket.stopRecord(wsHost, wsPort, wsPass);
        } catch (e) {
            console.error(`[DEBUG] StopRecord failed (non-fatal):`, e);
        }

        try {
            await websocket.stopVirtualCam(wsHost, wsPort, wsPass);
        } catch (e) {
            console.error(`[DEBUG] StopVirtualCam failed (non-fatal):`, e);
        }

        try {
            await websocket.stopReplayBuffer(wsHost, wsPort, wsPass);
        } catch (e) {
            console.error(`[DEBUG] StopReplayBuffer failed (non-fatal):`, e);
        }

        // Wait a moment for outputs to stop
        await sleep(1000);

        // Step 2: Request OBS Quit via websocket
        try {
            await websocket.quitObs(wsHost, wsPort, wsPass);
            console.error(`[DEBUG] OBS Quit command sent via websocket`);
            await sleep(2000);
        } catch (e) {
            console.error(`[WARN] Failed to send Quit command via websocket:`, e);
        }
    } else {
        console.error(`[WARN] OBS_WEBSOCKET_PASSWORD not set - cannot stop via websocket`);
    }

    // Step 3: Fallback - kill process using taskkill
    // Check if OBS is still running
    let obsStillRunning = true;
    for (let i = 0; i < 10; i++) {
        if (!(await isOBSRunning())) {
            obsStillRunning = false;
            break;
        }
        await sleep(1000);
    }

    if (obsStillRunning) {
        console.error(`[DEBUG] OBS still running, attempting to terminate process...`);
        try {
            await killProcess(OBS_PROCESS_NAME, true);
            console.error(`[DEBUG] OBS process terminated via taskkill`);
        } catch (e) {
            console.error(`[WARN] Failed to terminate OBS process:`, e);
            // Process may have already exited
        }
    } else {
        console.error(`[DEBUG] OBS exited successfully`);
    }
}

/**
 * Wait for OBS websocket to be ready
 */
export async function waitForOBSReady(
    wsPassword: string,
    wsHost: string = DEFAULT_WS_HOST,
    wsPort: string = DEFAULT_WS_PORT,
    obsStartTime?: string
): Promise<boolean> {
    // Give OBS websocket server time to start up (5 seconds initial wait)
    console.error(`[DEBUG] Waiting 5 seconds for OBS websocket server to initialize...`);
    await sleep(5000);

    console.error(`[DEBUG] Checking if OBS websocket server is ready...`);
    // Wait up to 30 seconds for websocket to be ready (15 attempts * 2 seconds)
    let wsReady = false;
    for (let i = 0; i < 15; i++) {
        // Check if OBS is still running before attempting connection
        if (!(await isOBSRunning())) {
            console.error(`[ERROR] OBS process is no longer running. OBS may have crashed.`);
            throw new Error('OBS process crashed during websocket initialization');
        }

        try {
            const isActive = await withTimeout(
                websocket.getStreamStatus(wsHost, wsPort, wsPassword),
                3000,
                'GetStreamStatus (websocket readiness check)'
            );

            // If we got a response (not null), websocket is ready
            if (isActive !== null) {
                wsReady = true;
                console.error(`[DEBUG] OBS websocket server is ready`);
                break;
            }
        } catch (e: any) {
            // Connection error or timeout - websocket not ready yet
            const errorMsg = e.message || String(e);
            if (errorMsg.includes('ECONNREFUSED')) {
                if (i < 14) {
                    console.error(`[DEBUG] Websocket not ready yet (attempt ${i + 1}/15) - connection refused, waiting 2 seconds...`);
                }
            } else {
                if (i < 14) {
                    console.error(`[DEBUG] Websocket not ready yet (attempt ${i + 1}/15) - ${errorMsg}, waiting 2 seconds...`);
                }
            }
        }
        // Wait 2 seconds between attempts
        if (i < 14) {
            await sleep(2000);
        }
    }

    if (!wsReady) {
        // Final check: is OBS still running?
        const stillRunning = await isOBSRunning();
        if (!stillRunning) {
            console.error(`[ERROR] OBS websocket server not ready and OBS process is no longer running. OBS may have crashed.`);
            throw new Error('OBS process crashed - websocket never became available');
        } else {
            console.error(`[WARN] OBS websocket server not ready after 35 seconds (5s initial + 30s retries). OBS is running but websocket may not be enabled. Check OBS Tools -> WebSocket Server Settings.`);
        }
    }

    return wsReady;
}

/**
 * Check stream status with retries (handles OBS startup delays)
 */
export async function getStreamStatus(
    wsPassword: string,
    wsHost: string = DEFAULT_WS_HOST,
    wsPort: string = DEFAULT_WS_PORT,
    obsStartTime?: string
): Promise<boolean | null> {
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
                console.error(`[DEBUG] Checking stream status via websocket (${wsHost}:${wsPort})...`);
            }

            const isActive = await withTimeout(
                websocket.getStreamStatus(wsHost, wsPort, wsPassword),
                3000,
                'GetStreamStatus'
            );

            if (isActive !== null) {
                console.error(`[DEBUG] Stream status: outputActive=${isActive}`);
                return isActive;
            }
            // If null, websocket connection failed - retry
        } catch (e: any) {
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

/**
 * Ensure stream is active - check status and start if needed
 */
export async function ensureStreamActive(
    wsPassword: string,
    wsHost: string = DEFAULT_WS_HOST,
    wsPort: string = DEFAULT_WS_PORT,
    obsStartTime?: string,
    checkYouTubeStatus?: () => Promise<boolean | null>
): Promise<void> {
    // Step 1: Try to check stream status via websocket
    console.error(`[DEBUG] Checking stream status via websocket...`);
    const wsStreamStatus = await getStreamStatus(wsPassword, wsHost, wsPort, obsStartTime);

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
        // Websocket status is unknown (null) - try YouTube API as fallback if provided
        console.error(`[DEBUG] Websocket status unknown, checking YouTube API...`);
        if (checkYouTubeStatus) {
            const ytStreamStatus = await checkYouTubeStatus();

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
            console.error(`[WARN] Cannot validate stream status (websocket unavailable and no YouTube check). Will attempt to start stream to be safe.`);
            shouldStartStream = true; // Default to starting if we can't confirm it's active
            validationMethod = 'none (cannot validate - starting to be safe)';
        }
    }

    if (shouldStartStream) {
        console.error(`[DEBUG] Stream is not active (validated via ${validationMethod}), starting stream...`);

        // Retry StartStream command if websocket isn't ready yet
        let startStreamSuccess = false;
        let maxStartAttempts = 15;
        let startWaitTimeMs = 2000; // 2 seconds between retries

        // If OBS was recently started, wait longer and retry more
        if (obsStartTime) {
            const startTime = new Date(obsStartTime).getTime();
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
                    console.error(`[DEBUG] Executing StartStream via websocket...`);
                }

                await withTimeout(
                    websocket.startStream(wsHost, wsPort, wsPassword),
                    5000,
                    'OBS websocket StartStream'
                );
                console.error(`[DEBUG] OBS startstreaming command sent via websocket`);
                startStreamSuccess = true;
                break;
            } catch (execError: any) {
                const errorStr = String(execError?.message ?? execError);
                const isConnectionError =
                    errorStr.includes('CONNECTION_ERROR') ||
                    errorStr.includes('Connection') ||
                    errorStr.includes('ECONNREFUSED');

                if (isConnectionError && attempt < maxStartAttempts - 1) {
                    // Connection error - websocket not ready yet, will retry
                    console.error(`[DEBUG] Websocket not ready yet (attempt ${attempt + 1}/${maxStartAttempts}), will retry...`);
                    continue;
                }

                // For non-connection errors, throw immediately
                if (!isConnectionError) {
                    throw execError;
                }

                // Last attempt failed
                if (attempt === maxStartAttempts - 1) {
                    throw execError;
                }
            }
        }

        if (!startStreamSuccess) {
            console.error(`[ERROR] Failed to send StartStream command after ${maxStartAttempts} attempts. Websocket may not be available.`);
        } else {
            // Verify that stream actually started
            console.error(`[DEBUG] Waiting 3 seconds before verifying stream started...`);
            await sleep(3000);
            const verifyStatus = await getStreamStatus(wsPassword, wsHost, wsPort, obsStartTime);
            if (verifyStatus === true) {
                console.error(`[DEBUG] Stream verification successful - stream is now active`);
            } else if (verifyStatus === false) {
                console.error(`[ERROR] Stream verification failed - stream is still not active after StartStream command`);
            } else {
                console.error(`[WARN] Stream verification inconclusive - could not confirm stream status after StartStream command`);
            }
        }
    } else {
        console.error(`[DEBUG] Stream validation complete (method: ${validationMethod}), no action needed`);
    }
}

