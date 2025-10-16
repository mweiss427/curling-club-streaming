import { google } from 'googleapis';
import path from 'node:path';
import { authenticate } from '@google-cloud/local-auth';

const SCOPES = [
    'https://www.googleapis.com/auth/youtube',
    'https://www.googleapis.com/auth/youtube.force-ssl'
];

export type Privacy = 'public' | 'unlisted' | 'private';

async function getOAuthClient(keyfilePath?: string) {
    const keyPath = keyfilePath ?? process.env.YOUTUBE_OAUTH_CREDENTIALS ?? path.resolve(process.cwd(), 'youtube.credentials.json');
    return authenticate({ scopes: SCOPES, keyfilePath: keyPath });
}

export async function createBroadcastAndBind(opts: {
    title: string;
    description?: string;
    privacy?: Privacy;
    streamKey?: string; // YouTube RTMP streamName
    streamId?: string; // YouTube liveStreams id
    credentialsPath?: string; // OAuth client credentials json
}): Promise<string> {
    const privacy: Privacy = opts.privacy ?? 'public';
    const auth = await getOAuthClient(opts.credentialsPath);
    const youtube = google.youtube('v3');

    const insertRes = await youtube.liveBroadcasts.insert({
        auth,
        part: ['snippet', 'status', 'contentDetails'],
        requestBody: {
            snippet: {
                title: opts.title,
                description: opts.description,
                scheduledStartTime: new Date().toISOString()
            },
            status: { privacyStatus: privacy },
            contentDetails: {
                enableAutoStart: true,
                enableAutoStop: true
            }
        }
    });

    const broadcastId = insertRes.data.id;
    if (!broadcastId) throw new Error('YouTube did not return a broadcast id.');

    let resolvedStreamId = opts.streamId;
    if (!resolvedStreamId && opts.streamKey) {
        const streams = await youtube.liveStreams.list({
            auth,
            part: ['id', 'cdn', 'snippet', 'contentDetails'],
            mine: true,
            maxResults: 50
        });
        const items = streams.data.items ?? [];
        const match = items.find((s) => s.cdn?.ingestionInfo?.streamName === opts.streamKey);
        if (!match) {
            throw new Error(`No liveStream found for stream key '${opts.streamKey}'. Provide --stream-id or ensure the key matches.`);
        }
        resolvedStreamId = match.id ?? undefined;
    }

    if (!resolvedStreamId) {
        throw new Error('Provide --stream-id or --stream-key so I can bind the broadcast.');
    }

    await youtube.liveBroadcasts.bind({
        auth,
        id: broadcastId,
        part: ['id', 'snippet', 'status', 'contentDetails'],
        streamId: resolvedStreamId
    });

    return broadcastId;
}


