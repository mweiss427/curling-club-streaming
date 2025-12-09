import { google } from 'googleapis';
import path from 'node:path';
import { getOAuthClient as getOAuthClientWithToken } from './auth.js';

export type Privacy = 'public' | 'unlisted' | 'private';

export async function createBroadcastAndBind(opts: {
    title: string;
    description?: string;
    privacy?: Privacy;
    streamKey?: string; // YouTube RTMP streamName
    streamId?: string; // YouTube liveStreams id
    credentialsPath?: string; // OAuth client credentials json
    tokenPath?: string; // Stored OAuth refresh/access token json
    scheduledStart?: string; // ISO datetime string
}): Promise<string> {
    console.error(`[DEBUG] Starting YouTube broadcast creation for: ${opts.title}`);

    const privacy: Privacy = opts.privacy ?? 'public';

    console.error(`[DEBUG] Getting OAuth client...`);
    const keyPath = opts.credentialsPath ?? process.env.YOUTUBE_OAUTH_CREDENTIALS ?? path.resolve(process.cwd(), 'youtube.credentials.json');
    const tokenPath = opts.tokenPath ?? process.env.YOUTUBE_TOKEN_PATH;
    const auth = await getOAuthClientWithToken({ clientPath: keyPath, tokenPath });
    console.error(`[DEBUG] OAuth client obtained`);

    const youtube = google.youtube('v3');

    console.error(`[DEBUG] Creating broadcast...`);

    // Build snippet - always include scheduledStartTime (required by YouTube API)
    const snippet: any = {
        title: opts.title,
        description: opts.description
    };

    // YouTube API requires scheduledStartTime, but it must be in the future
    const now = new Date();
    let scheduledStartTime: string;

    if (opts.scheduledStart) {
        const scheduledTime = new Date(opts.scheduledStart);
        if (scheduledTime > now) {
            // Event is in the future - use the scheduled time
            scheduledStartTime = opts.scheduledStart;
            console.error(`[DEBUG] Setting scheduledStartTime to: ${scheduledStartTime}`);
        } else {
            // Event is in the past - set to current time + 2 minutes (to ensure it's in the future)
            const futureTime = new Date(now.getTime() + 2 * 60 * 1000); // 2 minutes from now
            scheduledStartTime = futureTime.toISOString();
            console.error(`[WARN] Event start time ${opts.scheduledStart} is in the past, setting scheduledStartTime to ${scheduledStartTime} (2 minutes from now)`);
        }
    } else {
        // No scheduled start provided - use current time + 2 minutes
        const futureTime = new Date(now.getTime() + 2 * 60 * 1000); // 2 minutes from now
        scheduledStartTime = futureTime.toISOString();
        console.error(`[DEBUG] No scheduledStartTime provided, setting to ${scheduledStartTime} (2 minutes from now)`);
    }

    snippet.scheduledStartTime = scheduledStartTime;

    const insertRes = await youtube.liveBroadcasts.insert({
        auth,
        part: ['snippet', 'status', 'contentDetails'],
        requestBody: {
            snippet,
            status: { privacyStatus: privacy },
            contentDetails: {
                enableAutoStart: true,
                enableAutoStop: true
            }
        }
    });
    console.error(`[DEBUG] Broadcast created with ID: ${insertRes.data.id}`);

    const broadcastId = insertRes.data.id;
    if (!broadcastId) throw new Error('YouTube did not return a broadcast id.');

    let resolvedStreamId = opts.streamId;
    if (!resolvedStreamId && opts.streamKey) {
        console.error(`[DEBUG] Looking up stream by key: ${opts.streamKey}`);
        const streams = await youtube.liveStreams.list({
            auth,
            part: ['id', 'cdn', 'snippet', 'contentDetails'],
            mine: true,
            maxResults: 50
        });
        console.error(`[DEBUG] Found ${streams.data.items?.length ?? 0} live streams`);
        const items = streams.data.items ?? [];
        const match = items.find((s) => s.cdn?.ingestionInfo?.streamName === opts.streamKey);
        if (!match) {
            throw new Error(`No liveStream found for stream key '${opts.streamKey}'. Provide --stream-id or ensure the key matches.`);
        }
        resolvedStreamId = match.id ?? undefined;
        console.error(`[DEBUG] Found matching stream ID: ${resolvedStreamId}`);
    }

    if (!resolvedStreamId) {
        throw new Error('Provide --stream-id or --stream-key so I can bind the broadcast.');
    }

    console.error(`[DEBUG] Binding broadcast ${broadcastId} to stream ${resolvedStreamId}...`);
    await youtube.liveBroadcasts.bind({
        auth,
        id: broadcastId,
        part: ['id', 'snippet', 'status', 'contentDetails'],
        streamId: resolvedStreamId
    });
    console.error(`[DEBUG] Broadcast binding complete`);

    return broadcastId;
}

export async function updateBroadcastTitle(
    broadcastId: string,
    title: string,
    description?: string,
    credentialsPath?: string,
    tokenPath?: string
): Promise<void> {
    console.error(`[DEBUG] Updating broadcast ${broadcastId} title to: ${title}`);
    const keyPath = credentialsPath ?? process.env.YOUTUBE_OAUTH_CREDENTIALS ?? path.resolve(process.cwd(), 'youtube.credentials.json');
    const resolvedTokenPath = tokenPath ?? process.env.YOUTUBE_TOKEN_PATH;
    const auth = await getOAuthClientWithToken({ clientPath: keyPath, tokenPath: resolvedTokenPath });
    const youtube = google.youtube('v3');

    // First, get the current broadcast to preserve other fields
    const currentResp = await youtube.liveBroadcasts.list({
        auth,
        part: ['snippet', 'status', 'contentDetails'],
        id: [broadcastId],
        maxResults: 1
    });

    const currentBroadcast = currentResp.data.items?.[0];
    if (!currentBroadcast) {
        throw new Error(`Broadcast ${broadcastId} not found`);
    }

    // Update the broadcast with new title/description
    await youtube.liveBroadcasts.update({
        auth,
        part: ['snippet', 'status', 'contentDetails'],
        requestBody: {
            id: broadcastId,
            snippet: {
                ...currentBroadcast.snippet,
                title,
                description: description ?? currentBroadcast.snippet?.description
            },
            status: currentBroadcast.status,
            contentDetails: currentBroadcast.contentDetails
        }
    });
    console.error(`[DEBUG] Broadcast title updated successfully`);
}

export async function deleteBroadcast(
    broadcastId: string,
    credentialsPath?: string,
    tokenPath?: string
): Promise<void> {
    console.error(`[DEBUG] Deleting broadcast ${broadcastId}...`);
    const keyPath = credentialsPath ?? process.env.YOUTUBE_OAUTH_CREDENTIALS ?? path.resolve(process.cwd(), 'youtube.credentials.json');
    const resolvedTokenPath = tokenPath ?? process.env.YOUTUBE_TOKEN_PATH;
    const auth = await getOAuthClientWithToken({ clientPath: keyPath, tokenPath: resolvedTokenPath });
    const youtube = google.youtube('v3');

    try {
        await youtube.liveBroadcasts.delete({
            auth,
            id: broadcastId
        });
        console.error(`[DEBUG] Broadcast ${broadcastId} deleted successfully`);
    } catch (error: any) {
        console.error(`[WARN] Failed to delete broadcast ${broadcastId}:`, error);
        throw error;
    }
}

export async function listLiveStreams(opts: { credentialsPath?: string; tokenPath?: string; maxResults?: number; streamKey?: string } = {}): Promise<Array<{ id: string; streamName?: string; title?: string }>> {
    const keyPath = opts.credentialsPath ?? process.env.YOUTUBE_OAUTH_CREDENTIALS ?? path.resolve(process.cwd(), 'youtube.credentials.json');
    const tokenPath = opts.tokenPath ?? process.env.YOUTUBE_TOKEN_PATH;
    const auth = await getOAuthClientWithToken({ clientPath: keyPath, tokenPath });
    const youtube = google.youtube('v3');
    const resp = await youtube.liveStreams.list({
        auth,
        part: ['id', 'cdn', 'snippet'],
        mine: true,
        maxResults: opts.maxResults ?? 50
    });
    const items = resp.data.items ?? [];
    let filtered = items
        .filter((s) => Boolean(s.id))
        .map((s) => ({ id: String(s.id), streamName: s.cdn?.ingestionInfo?.streamName ?? undefined, title: s.snippet?.title ?? undefined }));

    // Filter by streamKey if provided
    if (opts.streamKey) {
        filtered = filtered.filter((s) => s.streamName === opts.streamKey);
    }

    return filtered;
}


