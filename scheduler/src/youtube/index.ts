import path from 'node:path';
import { google } from 'googleapis';
import { getOAuthClient as getOAuthClientWithToken } from './auth.js';
import { createBroadcastAndBind, deleteBroadcast, Privacy, listLiveStreams } from './createBroadcast.js';
import { withTimeout } from '../system/index.js';
import type { SingleEvent } from '../google/list.js';
import type { SheetKey } from '../google/list.js';

export type { Privacy } from './createBroadcast.js';
// Re-export for CLI and other direct usage
export { createBroadcastAndBind, listLiveStreams } from './createBroadcast.js';

export interface YouTubeOptions {
    credentialsPath?: string;
    tokenPath?: string;
    streamId?: string;
    streamKey?: string;
    privacy?: Privacy;
}

/**
 * Check if a YouTube broadcast is currently live
 */
export async function checkBroadcastStatus(
    broadcastId: string,
    options: YouTubeOptions = {}
): Promise<boolean | null> {
    try {
        const keyPath =
            options.credentialsPath ??
            process.env.YOUTUBE_OAUTH_CREDENTIALS ??
            path.resolve(process.cwd(), 'youtube.credentials.json');
        const resolvedTokenPath = options.tokenPath ?? process.env.YOUTUBE_TOKEN_PATH;
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

/**
 * Get the title of a YouTube broadcast
 */
export async function getBroadcastTitle(
    broadcastId: string,
    options: YouTubeOptions = {}
): Promise<string | null> {
    try {
        const keyPath =
            options.credentialsPath ??
            process.env.YOUTUBE_OAUTH_CREDENTIALS ??
            path.resolve(process.cwd(), 'youtube.credentials.json');
        const resolvedTokenPath = options.tokenPath ?? process.env.YOUTUBE_TOKEN_PATH;
        const auth = await getOAuthClientWithToken({ clientPath: keyPath, tokenPath: resolvedTokenPath });
        const youtube = google.youtube('v3');

        const response = await youtube.liveBroadcasts.list({
            auth,
            part: ['snippet'],
            id: [broadcastId],
            maxResults: 1
        });

        const broadcast = response.data.items?.[0];
        if (!broadcast) {
            console.error(`[WARN] Broadcast ${broadcastId} not found in YouTube API`);
            return null;
        }

        const title = broadcast.snippet?.title ?? null;
        console.error(`[DEBUG] YouTube broadcast title: ${title}`);
        return title;
    } catch (e) {
        console.error(`[WARN] Failed to get YouTube broadcast title:`, e);
        return null;
    }
}

/**
 * Find existing broadcast by exact title match
 */
export async function findExistingBroadcast(
    title: string,
    options: YouTubeOptions = {}
): Promise<{ id: string; title: string; status?: string } | null> {
    try {
        const keyPath =
            options.credentialsPath ??
            process.env.YOUTUBE_OAUTH_CREDENTIALS ??
            path.resolve(process.cwd(), 'youtube.credentials.json');
        const resolvedTokenPath = options.tokenPath ?? process.env.YOUTUBE_TOKEN_PATH;
        const auth = await getOAuthClientWithToken({ clientPath: keyPath, tokenPath: resolvedTokenPath });
        const youtube = google.youtube('v3');

        // Search for broadcasts with matching title to avoid duplicates
        const searchResp = await youtube.liveBroadcasts.list({
            auth,
            part: ['snippet', 'status'],
            mine: true,
            maxResults: 50
        });

        // Find ALL broadcasts with exact title match (not just first one)
        console.error(`[DEBUG] Searching ${searchResp.data.items?.length ?? 0} broadcasts for exact title match: "${title}"`);
        const exactMatches =
            searchResp.data.items?.filter((b) => {
                const broadcastTitle = b.snippet?.title ?? '';
                const status = b.status?.lifeCycleStatus;
                const isExactMatch = broadcastTitle === title;
                const isNotComplete = status !== 'complete';
                return isExactMatch && isNotComplete;
            }) ?? [];

        if (exactMatches.length > 0) {
            // Sort by publishedAt (most recent first)
            exactMatches.sort((a, b) => {
                const aTime = a.snippet?.publishedAt ? new Date(a.snippet.publishedAt).getTime() : 0;
                const bTime = b.snippet?.publishedAt ? new Date(b.snippet.publishedAt).getTime() : 0;
                return bTime - aTime; // Most recent first
            });

            const match = exactMatches[0];
            return {
                id: match.id!,
                title: match.snippet?.title ?? '',
                status: match.status?.lifeCycleStatus ?? undefined
            };
        }

        return null;
    } catch (e) {
        console.error(`[WARN] Failed to search for existing broadcasts:`, e);
        return null;
    }
}

/**
 * Find existing broadcast by event name and sheet (fuzzy match for recent broadcasts)
 */
export async function findRecentBroadcastByEvent(
    eventName: string,
    sheet: SheetKey,
    options: YouTubeOptions = {}
): Promise<{ id: string; title: string; status?: string } | null> {
    try {
        const keyPath =
            options.credentialsPath ??
            process.env.YOUTUBE_OAUTH_CREDENTIALS ??
            path.resolve(process.cwd(), 'youtube.credentials.json');
        const resolvedTokenPath = options.tokenPath ?? process.env.YOUTUBE_TOKEN_PATH;
        const auth = await getOAuthClientWithToken({ clientPath: keyPath, tokenPath: resolvedTokenPath });
        const youtube = google.youtube('v3');

        const searchResp = await youtube.liveBroadcasts.list({
            auth,
            part: ['snippet', 'status'],
            mine: true,
            maxResults: 50
        });

        const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
        const sheetPattern = `Sheet ${sheet}`;

        console.error(`[DEBUG] Searching for recent broadcasts with event "${eventName}" and sheet "${sheetPattern}"`);

        const matchingBroadcast = searchResp.data.items?.find((b) => {
            const broadcastTitle = b.snippet?.title ?? '';
            const created = b.snippet?.publishedAt;
            const status = b.status?.lifeCycleStatus;
            const isRecent = created && created > thirtyMinutesAgo;
            const hasEventName = broadcastTitle.includes(eventName);
            const hasSheet = broadcastTitle.includes(sheetPattern);
            const notComplete = status !== 'complete';

            if (isRecent && hasEventName && hasSheet && notComplete) {
                console.error(`[DEBUG] Found recent similar broadcast: "${broadcastTitle}" (status: ${status}, created: ${created})`);
                return true;
            }
            return false;
        });

        if (matchingBroadcast && matchingBroadcast.id) {
            return {
                id: matchingBroadcast.id,
                title: matchingBroadcast.snippet?.title ?? '',
                status: matchingBroadcast.status?.lifeCycleStatus ?? undefined
            };
        }

        return null;
    } catch (e) {
        console.error(`[WARN] Failed to search for recent broadcasts:`, e);
        return null;
    }
}

/**
 * Clean up duplicate broadcasts (keep most recent, delete others)
 */
export async function cleanupDuplicateBroadcasts(
    title: string,
    options: YouTubeOptions = {}
): Promise<void> {
    try {
        const keyPath =
            options.credentialsPath ??
            process.env.YOUTUBE_OAUTH_CREDENTIALS ??
            path.resolve(process.cwd(), 'youtube.credentials.json');
        const resolvedTokenPath = options.tokenPath ?? process.env.YOUTUBE_TOKEN_PATH;
        const auth = await getOAuthClientWithToken({ clientPath: keyPath, tokenPath: resolvedTokenPath });
        const youtube = google.youtube('v3');

        const searchResp = await youtube.liveBroadcasts.list({
            auth,
            part: ['snippet', 'status'],
            mine: true,
            maxResults: 50
        });

        // Find ALL broadcasts with exact title match
        const exactMatches =
            searchResp.data.items?.filter((b) => {
                const broadcastTitle = b.snippet?.title ?? '';
                const status = b.status?.lifeCycleStatus;
                const isExactMatch = broadcastTitle === title;
                const isNotComplete = status !== 'complete';
                return isExactMatch && isNotComplete;
            }) ?? [];

        if (exactMatches.length > 1) {
            console.error(`[WARN] Found ${exactMatches.length} duplicate broadcasts! Cleaning up duplicates...`);

            // Sort by publishedAt (most recent first)
            exactMatches.sort((a, b) => {
                const aTime = a.snippet?.publishedAt ? new Date(a.snippet.publishedAt).getTime() : 0;
                const bTime = b.snippet?.publishedAt ? new Date(b.snippet.publishedAt).getTime() : 0;
                return bTime - aTime; // Most recent first
            });

            // Keep the first (most recent), delete the rest
            const duplicatesToDelete = exactMatches.slice(1);

            console.error(`[INFO] Keeping most recent broadcast: ${exactMatches[0].id}`);
            console.error(`[INFO] Deleting ${duplicatesToDelete.length} duplicate broadcast(s)...`);

            for (const duplicate of duplicatesToDelete) {
                if (duplicate.id) {
                    try {
                        await deleteBroadcast(duplicate.id, options.credentialsPath, options.tokenPath);
                        console.error(`[INFO] Deleted duplicate broadcast: ${duplicate.id}`);
                    } catch (deleteError: any) {
                        console.error(`[WARN] Failed to delete duplicate broadcast ${duplicate.id}:`, deleteError);
                    }
                }
            }
        }
    } catch (e) {
        console.error(`[WARN] Failed to cleanup duplicate broadcasts:`, e);
    }
}

/**
 * Verify broadcast title matches expected format
 */
async function verifyBroadcastTitle(
    broadcastId: string,
    expectedTitle: string,
    expectedSheetInTitle: string,
    options: YouTubeOptions = {}
): Promise<void> {
    try {
        const keyPath =
            options.credentialsPath ??
            process.env.YOUTUBE_OAUTH_CREDENTIALS ??
            path.resolve(process.cwd(), 'youtube.credentials.json');
        const resolvedTokenPath = options.tokenPath ?? process.env.YOUTUBE_TOKEN_PATH;
        const auth = await getOAuthClientWithToken({ clientPath: keyPath, tokenPath: resolvedTokenPath });
        const youtube = google.youtube('v3');

        const verifyResp = await youtube.liveBroadcasts.list({
            auth,
            part: ['snippet'],
            id: [broadcastId],
            maxResults: 1
        });

        const actualBroadcast = verifyResp.data.items?.[0];
        if (actualBroadcast) {
            const actualTitle = actualBroadcast.snippet?.title ?? '';

            // Verify sheet identifier is present
            if (!actualTitle.includes(expectedSheetInTitle)) {
                console.error(
                    `[ERROR] ACTUAL broadcast title "${actualTitle}" does not include expected sheet identifier "${expectedSheetInTitle}"`
                );
                console.error(`[ERROR] Expected title was "${expectedTitle}" but YouTube has "${actualTitle}"`);
                console.error(`[ERROR] This may indicate a configuration issue. Broadcast should be for Sheet ${expectedSheetInTitle.replace('Sheet ', '')}.`);
            } else if (actualTitle !== expectedTitle) {
                console.error(`[WARN] Broadcast title mismatch: expected "${expectedTitle}" but YouTube has "${actualTitle}"`);
                console.error(`[WARN] Title contains correct sheet identifier but format differs`);
            } else {
                console.error(`[DEBUG] Broadcast title verified - actual YouTube title matches expected: "${actualTitle}"`);
                console.error(`[DEBUG] Sheet identifier verified: ${expectedSheetInTitle}`);
            }
        } else {
            console.error(`[WARN] Could not fetch broadcast ${broadcastId} for title verification (non-fatal)`);
        }
    } catch (verifyError: any) {
        console.error(`[WARN] Failed to verify actual broadcast title (non-fatal):`, verifyError);
        // Fallback: at least verify our local title variable
        if (!expectedTitle.includes(expectedSheetInTitle)) {
            console.error(`[ERROR] Local title "${expectedTitle}" does not include expected sheet identifier "${expectedSheetInTitle}"`);
        }
    }
}

/**
 * Find or create a broadcast for a calendar event
 * Handles duplicate detection and ensures exactly one broadcast per event
 */
export async function findOrCreateBroadcast(
    event: SingleEvent,
    sheet: SheetKey,
    existingBroadcastId?: string,
    options: YouTubeOptions = {}
): Promise<string> {
    // Build stable key for the current calendar event window
    // Include summary in eventKey so that if event name changes, it's treated as a new event
    const eventKey = `${event.start}|${event.end}|${event.summary ?? 'Untitled Event'}`;

    // Construct a friendly title using event time and sheet
    // CRITICAL: Always use sheet (configured sheet for this computer), not event.sheet from calendar
    // This ensures Sheet A's computer always creates broadcasts for Sheet A, regardless of calendar event data
    const start = new Date(event.start);
    const date = start.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit' });
    const time = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const sheetTag = ` - Sheet ${sheet}`;
    const title = `${event.summary ?? 'Untitled Event'}${sheetTag} - ${date} - ${time}`;
    const description = event.description ?? event.summary ?? undefined;
    const privacy = options.privacy ?? 'public';

    // If we have an existing broadcast ID, verify it's still valid
    if (existingBroadcastId) {
        console.error(`[DEBUG] Found existing state for event, checking broadcast: ${existingBroadcastId}`);

        try {
            const keyPath =
                options.credentialsPath ??
                process.env.YOUTUBE_OAUTH_CREDENTIALS ??
                path.resolve(process.cwd(), 'youtube.credentials.json');
            const resolvedTokenPath = options.tokenPath ?? process.env.YOUTUBE_TOKEN_PATH;
            const auth = await getOAuthClientWithToken({ clientPath: keyPath, tokenPath: resolvedTokenPath });
            const youtube = google.youtube('v3');

            const broadcastResp = await youtube.liveBroadcasts.list({
                auth,
                part: ['snippet', 'status'],
                id: [existingBroadcastId],
                maxResults: 1
            });

            const broadcast = broadcastResp.data.items?.[0];
            if (!broadcast) {
                console.error(`[WARN] Broadcast ${existingBroadcastId} not found, will create new one`);
            } else {
                const broadcastTitle = broadcast.snippet?.title ?? '';
                const expectedSheetInTitle = `Sheet ${sheet}`;
                const isLive = broadcast.status?.lifeCycleStatus === 'live';

                // Check if broadcast belongs to correct sheet
                if (!broadcastTitle.includes(expectedSheetInTitle)) {
                    console.error(`[ERROR] Existing broadcast ${existingBroadcastId} title "${broadcastTitle}" does not match expected sheet ${sheet}`);
                    console.error(`[ERROR] This broadcast may belong to a different sheet. Will create a new one.`);
                } else if (broadcastTitle !== title) {
                    // Title doesn't match - but if it's already live, don't interrupt it
                    if (isLive) {
                        console.error(`[WARN] Broadcast title "${broadcastTitle}" doesn't match expected "${title}", but broadcast is LIVE`);
                        console.error(`[WARN] Reusing existing live broadcast to avoid interrupting stream`);
                        return existingBroadcastId;
                    } else {
                        console.error(`[INFO] Broadcast title "${broadcastTitle}" doesn't match expected "${title}" and is not live`);
                        console.error(`[INFO] Will create new broadcast (to avoid conflicts with multiple simultaneous streams)`);
                    }
                } else {
                    console.error(`[DEBUG] Broadcast title matches expected title: ${title}`);
                    return existingBroadcastId;
                }
            }
        } catch (e: any) {
            console.error(`[WARN] Could not verify existing broadcast (non-fatal):`, e);
            // If we can't verify, assume it's valid to avoid breaking functionality
            return existingBroadcastId;
        }
    }

    // Check for existing broadcast with exact title
    console.error(`[INFO] Sheet ${sheet} - Checking for existing broadcast with title "${title}"...`);
    let foundExistingBroadcast = false;
    let broadcastId: string | undefined;

    try {
        // First, try exact title match
        const exactMatch = await findExistingBroadcast(title, options);
        if (exactMatch) {
            console.error(`[INFO] Found existing broadcast with exact title: ${exactMatch.id}`);
            broadcastId = exactMatch.id;
            foundExistingBroadcast = true;

            // Clean up any duplicates
            await cleanupDuplicateBroadcasts(title, options);
        } else {
            // Try fuzzy match for recent broadcasts
            const recentMatch = await findRecentBroadcastByEvent(event.summary ?? 'Untitled Event', sheet, options);
            if (recentMatch) {
                console.error(`[INFO] Found recent broadcast with similar title (not exact match): "${recentMatch.title}"`);
                broadcastId = recentMatch.id;
                foundExistingBroadcast = true;
            } else {
                console.error(`[DEBUG] No matching broadcast found`);
            }
        }
    } catch (searchError: any) {
        console.error(`[WARN] Failed to search for existing broadcasts (non-fatal):`, searchError);
    }

    // Only create new broadcast if we didn't find an existing one
    if (!foundExistingBroadcast) {
        console.error(`[INFO] Sheet ${sheet} - Creating new broadcast for event: ${title}`);

        // Check if event start time is in the past - if so, don't set scheduledStartTime
        // YouTube requires scheduled start time to be in the future
        const eventStartTime = new Date(event.start);
        const now = new Date();
        const scheduledStart = eventStartTime > now ? event.start : undefined;

        if (scheduledStart) {
            console.error(`[DEBUG] Event starts in the future, setting scheduledStartTime: ${scheduledStart}`);
        } else {
            console.error(`[DEBUG] Event start time is in the past (${event.start}), not setting scheduledStartTime (will start immediately)`);
        }

        broadcastId = await withTimeout(
            createBroadcastAndBind({
                title,
                description,
                privacy,
                streamId: options.streamId,
                streamKey: options.streamKey,
                credentialsPath: options.credentialsPath,
                tokenPath: options.tokenPath,
                scheduledStart
            }),
            30000, // 30 second timeout for YouTube operations
            'YouTube broadcast creation'
        );
        console.error(`[DEBUG] Broadcast created successfully: ${broadcastId}`);

        // Verify the actual broadcast title from YouTube API
        const expectedSheetInTitle = `Sheet ${sheet}`;
        await verifyBroadcastTitle(broadcastId, title, expectedSheetInTitle, options);
    }

    if (!broadcastId) {
        throw new Error('Failed to find or create broadcast');
    }

    return broadcastId;
}

