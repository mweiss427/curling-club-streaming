import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import fs from 'node:fs';
import path from 'node:path';
import { authenticate } from '@google-cloud/local-auth';

export const SCOPES = [
    'https://www.googleapis.com/auth/youtube',
    'https://www.googleapis.com/auth/youtube.force-ssl'
];

type OAuthClientInfo = {
    client_id: string;
    client_secret: string;
    redirect_uris?: string[];
};

function resolveClientInfo(clientJson: any): OAuthClientInfo {
    const src = clientJson.installed ?? clientJson.web ?? clientJson;
    if (!src?.client_id || !src?.client_secret) {
        throw new Error('Invalid OAuth client JSON: missing client_id/client_secret');
    }
    return {
        client_id: String(src.client_id),
        client_secret: String(src.client_secret),
        redirect_uris: Array.isArray(src.redirect_uris) ? src.redirect_uris.map(String) : undefined
    };
}

function defaultClientPath(): string {
    return process.env.YOUTUBE_OAUTH_CREDENTIALS ?? path.resolve(process.cwd(), 'youtube.credentials.json');
}

function defaultTokenPath(): string {
    // Store under project-local secrets dir by default
    const p = process.env.YOUTUBE_TOKEN_PATH ?? path.resolve(process.cwd(), '.secrets/youtube.token.json');
    return p;
}

function readJson(filePath: string): any {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath: string, data: any): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

export async function initAuth(opts: { clientPath?: string; tokenPath?: string } = {}): Promise<string> {
    const clientPath = opts.clientPath ?? defaultClientPath();
    const tokenPath = opts.tokenPath ?? defaultTokenPath();

    const auth = await authenticate({ scopes: SCOPES, keyfilePath: clientPath });
    // Persist the credentials for headless use
    const tokens = (auth as OAuth2Client).credentials;
    if (!tokens.refresh_token) {
        // Some flows do not return refresh_token on subsequent consents; instruct the user
        // to remove existing token and retry with "consent". But still persist what we have.
        // The presence of refresh_token is required for long-lived automation.
        console.warn('[WARN] OAuth did not return a refresh_token. If you had previously granted consent, remove the old token and try again.');
    }
    writeJson(tokenPath, tokens);
    return tokenPath;
}

export async function getOAuthClient(opts: { clientPath?: string; tokenPath?: string; interactive?: boolean } = {}): Promise<OAuth2Client> {
    const clientPath = opts.clientPath ?? defaultClientPath();
    const tokenPath = opts.tokenPath ?? defaultTokenPath();
    const clientInfo = resolveClientInfo(readJson(clientPath));

    const redirectUri = clientInfo.redirect_uris?.[0];
    const oauth2 = new google.auth.OAuth2(clientInfo.client_id, clientInfo.client_secret, redirectUri);

    if (fs.existsSync(tokenPath)) {
        const tokens = readJson(tokenPath);
        oauth2.setCredentials(tokens);
        // Trigger refresh if needed and persist any updates
        try {
            await oauth2.getAccessToken();
            const updated = oauth2.credentials;
            if (updated && (updated.access_token || updated.expiry_date)) {
                writeJson(tokenPath, { ...tokens, ...updated });
            }
        } catch (err) {
            console.error('[ERROR] Failed to refresh access token:', err);
        }
        return oauth2;
    }

    if (opts.interactive) {
        // Fall back to interactive flow if allowed
        const auth = await authenticate({ scopes: SCOPES, keyfilePath: clientPath });
        const tokens = (auth as OAuth2Client).credentials;
        writeJson(tokenPath, tokens);
        return auth as OAuth2Client;
    }

    throw new Error(`No YouTube OAuth token found at ${tokenPath}. Run the interactive init first.`);
}

export async function getAuthStatus(opts: { clientPath?: string; tokenPath?: string }): Promise<{
    hasToken: boolean;
    tokenPath: string;
    expiry?: string;
    scopes?: string[];
    channelTitle?: string;
    channelId?: string;
}> {
    const clientPath = opts.clientPath ?? defaultClientPath();
    const tokenPath = opts.tokenPath ?? defaultTokenPath();

    if (!fs.existsSync(tokenPath)) {
        return { hasToken: false, tokenPath };
    }

    try {
        const auth = await getOAuthClient({ clientPath, tokenPath });
        const creds = (auth as OAuth2Client).credentials;
        const expiry = creds.expiry_date ? new Date(creds.expiry_date).toISOString() : undefined;
        const scopes = typeof creds.scope === 'string' ? creds.scope.split(' ') : Array.isArray(creds.scope) ? creds.scope : undefined;

        const youtube = google.youtube('v3');
        const ch = await youtube.channels.list({ auth, part: ['id', 'snippet'], mine: true });
        const item = ch.data.items?.[0];
        const channelTitle = item?.snippet?.title ?? undefined;
        const channelId = item?.id ?? undefined;
        return { hasToken: true, tokenPath, expiry, scopes, channelTitle, channelId };
    } catch (err) {
        console.error('[ERROR] Auth status check failed:', err);
        return { hasToken: false, tokenPath };
    }
}


