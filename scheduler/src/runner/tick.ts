import { listCurrentSingle, SheetKey, SingleEvent } from '../google/list.js';
import { findOrCreateBroadcast, checkBroadcastStatus, getBroadcastTitle, YouTubeOptions } from '../youtube/index.js';
import { startOBS, stopOBS, isOBSRunning, waitForOBSReady, ensureStreamActive } from '../obs/index.js';
import { readState, writeState, clearState, TickState } from '../system/index.js';
import { withTimeout } from '../system/index.js';

export type Privacy = 'public' | 'unlisted' | 'private';

/**
 * Build the expected broadcast title from an event and sheet
 * Format: ${event.summary} - Sheet ${sheet} - ${date} - ${time}
 */
function buildExpectedTitle(event: SingleEvent, sheet: SheetKey): string {
    const start = new Date(event.start);
    const date = start.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit' });
    const time = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const sheetTag = ` - Sheet ${sheet}`;
    return `${event.summary ?? 'Untitled Event'}${sheetTag} - ${date} - ${time}`;
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
        (process.env.OBS_EXE ??
            'C:/Program Files/obs-studio/bin/64bit/obs64.exe');
    const profile = opts.obsProfile ?? process.env.OBS_PROFILE ?? 'Untitled';
    const collection = opts.obsCollection ?? process.env.OBS_COLLECTION ?? 'Static Game Stream';

    console.error(`[INFO] Sheet ${opts.sheet} - OBS config - Exe: ${obsExe}, Profile: ${profile}, Collection: ${collection}`);

    const calendarId = opts.calendarId ?? 'from config.json';
    console.error(`[INFO] Sheet ${opts.sheet} - Checking calendar: ${calendarId} for current events...`);

    // 1. Check calendar for current event
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

    // Build stable key for the current calendar event window
    const eventKey = current ? `${current.start}|${current.end}|${current.summary ?? 'Untitled Event'}` : undefined;
    const state = readState(opts.sheet);

    // 3. If no event: check if streaming and shut off if needed
    if (!current) {
        console.error(`[INFO] Sheet ${opts.sheet} - No live event, checking if we are streaming...`);
        const running = await isOBSRunning();
        console.error(`[INFO] Sheet ${opts.sheet} - OBS running: ${running}`);
        if (running) {
            console.error(`[INFO] Sheet ${opts.sheet} - OBS is running but no event, stopping OBS...`);
            await stopOBS();
            clearState(opts.sheet);
            console.error(`[INFO] Sheet ${opts.sheet} - OBS stopped, returning STOPPED`);
            return 'STOPPED';
        }
        clearState(opts.sheet);
        console.error(`[INFO] Sheet ${opts.sheet} - No event and OBS not running, returning IDLE`);
        return 'IDLE';
    }

    // 2. Event exists - handle streaming state
    const youtubeOptions: YouTubeOptions = {
        credentialsPath: opts.credentialsPath,
        tokenPath: opts.tokenPath,
        streamId: opts.streamId,
        streamKey: opts.streamKey,
        privacy
    };

    const expectedTitle = buildExpectedTitle(current, opts.sheet);
    const wsPass = process.env.OBS_WEBSOCKET_PASSWORD;

    // 2a. Are we streaming? (check OBS running + stream live status)
    console.error(`[INFO] Sheet ${opts.sheet} - Checking if we are streaming...`);
    const obsRunning = await isOBSRunning();
    console.error(`[INFO] Sheet ${opts.sheet} - OBS running: ${obsRunning}`);

    let streamLive = false;
    if (obsRunning && state?.broadcastId) {
        // Check if stream is live
        const streamStatus = await checkBroadcastStatus(state.broadcastId, youtubeOptions);
        streamLive = streamStatus === true;
        console.error(`[INFO] Sheet ${opts.sheet} - Stream live status: ${streamLive}`);
    }

    const isStreaming = obsRunning && streamLive;

    if (!isStreaming) {
        // Not streaming - start the correct stream
        console.error(`[INFO] Sheet ${opts.sheet} - Not streaming, starting the correct stream...`);

        // Find or create broadcast for current event
        const broadcastId = await withTimeout(
            findOrCreateBroadcast(current, opts.sheet, state?.broadcastId, youtubeOptions),
            30000, // 30 second timeout for YouTube operations
            'YouTube broadcast creation'
        );

        // Update state with broadcast ID and event key
        const newState: TickState = {
            eventKey: eventKey!,
            broadcastId,
            obsStartTime: state?.obsStartTime
        };
        writeState(newState, opts.sheet);

        // Start OBS if not running
        if (!obsRunning) {
            console.error(`[INFO] Sheet ${opts.sheet} - Starting OBS...`);
            await startOBS({
                exe: obsExe,
                profile,
                collection,
                wsPassword: wsPass
            });

            // Track when OBS was started
            const obsStartTime = new Date().toISOString();
            writeState({ ...newState, obsStartTime }, opts.sheet);

            // Wait for websocket to be ready and verify stream started (if websocket password is set)
            if (wsPass) {
                try {
                    const wsReady = await waitForOBSReady(wsPass);
                    if (wsReady) {
                        // Check if stream is active, start if needed
                        const checkYouTubeStatus = async (): Promise<boolean | null> => {
                            return checkBroadcastStatus(broadcastId, youtubeOptions);
                        };
                        await ensureStreamActive(wsPass, undefined, undefined, obsStartTime, checkYouTubeStatus);
                    } else {
                        console.error(`[WARN] OBS websocket server not ready after wait period`);
                    }
                } catch (e) {
                    console.error(`[WARN] Failed to wait for OBS websocket or ensure stream active:`, e);
                }
            } else {
                console.error(`[WARN] OBS_WEBSOCKET_PASSWORD not set, cannot verify stream started after OBS launch`);
            }
        } else {
            // OBS is running but stream is not live - ensure stream is active
            if (wsPass) {
                try {
                    const checkYouTubeStatus = async (): Promise<boolean | null> => {
                        return checkBroadcastStatus(broadcastId, youtubeOptions);
                    };
                    await ensureStreamActive(wsPass, undefined, undefined, state?.obsStartTime, checkYouTubeStatus);
                } catch (e) {
                    console.error(`[WARN] Failed to ensure stream active via websocket:`, e);
                }
            } else {
                console.error(`[WARN] OBS_WEBSOCKET_PASSWORD not set, cannot ensure stream active`);
            }
        }

        return 'STARTED';
    }

    // 2b. Are we on the correct stream? (check eventKey matches + broadcast title matches)
    console.error(`[INFO] Sheet ${opts.sheet} - Streaming, checking if we are on the correct stream...`);

    const eventKeyMatches = state?.eventKey === eventKey;
    console.error(`[INFO] Sheet ${opts.sheet} - Event key matches: ${eventKeyMatches}`);

    let titleMatches = false;
    if (state?.broadcastId) {
        const actualTitle = await getBroadcastTitle(state.broadcastId, youtubeOptions);
        titleMatches = actualTitle === expectedTitle;
        console.error(`[INFO] Sheet ${opts.sheet} - Broadcast title matches: ${titleMatches} (expected: "${expectedTitle}", actual: "${actualTitle}")`);
    }

    const isCorrectStream = eventKeyMatches && titleMatches;

    if (!isCorrectStream) {
        // Not on correct stream - stop current stream, then start the correct stream
        console.error(`[INFO] Sheet ${opts.sheet} - Not on correct stream, stopping current stream and starting correct stream...`);

        // Stop OBS
        await stopOBS();
        clearState(opts.sheet);

        // Find or create broadcast for current event
        const broadcastId = await withTimeout(
            findOrCreateBroadcast(current, opts.sheet, undefined, youtubeOptions),
            30000, // 30 second timeout for YouTube operations
            'YouTube broadcast creation'
        );

        // Update state with broadcast ID and event key
        const newState: TickState = {
            eventKey: eventKey!,
            broadcastId,
            obsStartTime: undefined
        };
        writeState(newState, opts.sheet);

        // Start OBS
        console.error(`[INFO] Sheet ${opts.sheet} - Starting OBS with correct stream...`);
        await startOBS({
            exe: obsExe,
            profile,
            collection,
            wsPassword: wsPass
        });

        // Track when OBS was started
        const obsStartTime = new Date().toISOString();
        writeState({ ...newState, obsStartTime }, opts.sheet);

        // Wait for websocket to be ready and verify stream started (if websocket password is set)
        if (wsPass) {
            try {
                const wsReady = await waitForOBSReady(wsPass);
                if (wsReady) {
                    // Check if stream is active, start if needed
                    const checkYouTubeStatus = async (): Promise<boolean | null> => {
                        return checkBroadcastStatus(broadcastId, youtubeOptions);
                    };
                    await ensureStreamActive(wsPass, undefined, undefined, obsStartTime, checkYouTubeStatus);
                } else {
                    console.error(`[WARN] OBS websocket server not ready after wait period`);
                }
            } catch (e) {
                console.error(`[WARN] Failed to wait for OBS websocket or ensure stream active:`, e);
            }
        } else {
            console.error(`[WARN] OBS_WEBSOCKET_PASSWORD not set, cannot verify stream started after OBS launch`);
        }

        return 'STARTED';
    }

    // Already streaming the correct stream
    console.error(`[INFO] Sheet ${opts.sheet} - Already streaming the correct stream`);

    // Ensure state is up to date
    if (state) {
        const updatedState: TickState = {
            eventKey: eventKey!,
            broadcastId: state.broadcastId,
            obsStartTime: state.obsStartTime
        };
        writeState(updatedState, opts.sheet);
    }

    // Validate stream is still active (if websocket password is set)
    if (wsPass && state?.broadcastId) {
        try {
            const checkYouTubeStatus = async (): Promise<boolean | null> => {
                return checkBroadcastStatus(state.broadcastId, youtubeOptions);
            };
            await ensureStreamActive(wsPass, undefined, undefined, state.obsStartTime, checkYouTubeStatus);
        } catch (e) {
            console.error(`[WARN] Failed to validate stream status via websocket:`, e);
        }
    }

    return 'ALREADY_LIVE';
}
