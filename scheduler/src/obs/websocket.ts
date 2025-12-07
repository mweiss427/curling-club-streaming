import OBSWebSocket from 'obs-websocket-js';

let obsClient: OBSWebSocket | null = null;
let connectionPromise: Promise<OBSWebSocket> | null = null;

async function getObsConnection(host: string, port: string, password: string): Promise<OBSWebSocket> {
    // Reuse existing connection if available and identified
    if (obsClient) {
        try {
            // Check if connection is still valid by checking identified property
            if ((obsClient as any).identified !== false) {
                return obsClient;
            }
        } catch {
            // Connection is invalid, create new one
            obsClient = null;
        }
    }

    // Reuse connection promise if one is in progress
    if (connectionPromise) {
        return connectionPromise;
    }

    // Create new connection
    connectionPromise = (async () => {
        const client = new OBSWebSocket();
        try {
            await client.connect(`ws://${host}:${port}`, password);
            obsClient = client;
            connectionPromise = null;
            return client;
        } catch (error) {
            connectionPromise = null;
            obsClient = null;
            throw error;
        }
    })();

    return connectionPromise;
}

export async function getStreamStatus(
    host: string = '127.0.0.1',
    port: string = '4455',
    password?: string
): Promise<boolean | null> {
    if (!password) return null;
    
    try {
        const client = await getObsConnection(host, port, password);
        const response = await client.call('GetStreamStatus');
        return response.outputActive === true;
    } catch (error: any) {
        // Connection errors return null (unknown status)
        if (error.code === 'CONNECTION_ERROR' || error.message?.includes('Connection')) {
            return null;
        }
        throw error;
    }
}

export async function startStream(
    host: string = '127.0.0.1',
    port: string = '4455',
    password?: string
): Promise<void> {
    if (!password) throw new Error('OBS_WEBSOCKET_PASSWORD not set');
    
    const client = await getObsConnection(host, port, password);
    await client.call('StartStream');
}

export async function stopStream(
    host: string = '127.0.0.1',
    port: string = '4455',
    password?: string
): Promise<void> {
    if (!password) return;
    
    try {
        const client = await getObsConnection(host, port, password);
        await client.call('StopStream');
    } catch (error) {
        // Ignore errors - stream may not be active
    }
}

export async function stopRecord(
    host: string = '127.0.0.1',
    port: string = '4455',
    password?: string
): Promise<void> {
    if (!password) return;
    
    try {
        const client = await getObsConnection(host, port, password);
        await client.call('StopRecord');
    } catch (error) {
        // Ignore errors
    }
}

export async function stopVirtualCam(
    host: string = '127.0.0.1',
    port: string = '4455',
    password?: string
): Promise<void> {
    if (!password) return;
    
    try {
        const client = await getObsConnection(host, port, password);
        await client.call('StopVirtualCam');
    } catch (error) {
        // Ignore errors
    }
}

export async function stopReplayBuffer(
    host: string = '127.0.0.1',
    port: string = '4455',
    password?: string
): Promise<void> {
    if (!password) return;
    
    try {
        const client = await getObsConnection(host, port, password);
        await client.call('StopReplayBuffer');
    } catch (error) {
        // Ignore errors
    }
}

export async function quitObs(
    host: string = '127.0.0.1',
    port: string = '4455',
    password?: string
): Promise<void> {
    if (!password) return;
    
    try {
        const client = await getObsConnection(host, port, password);
        await client.call('Exit');
    } catch (error) {
        // Ignore errors
    } finally {
        // Close connection
        if (obsClient) {
            try {
                await obsClient.disconnect();
            } catch {}
            obsClient = null;
        }
    }
}

export async function closeConnection(): Promise<void> {
    if (obsClient) {
        try {
            await obsClient.disconnect();
        } catch {}
        obsClient = null;
    }
    connectionPromise = null;
}
