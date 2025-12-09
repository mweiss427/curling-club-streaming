import { execFile, spawn, ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);

// Utility functions
export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    operation: string
): Promise<T> {
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

// Process management
export async function isProcessRunning(processName: string): Promise<boolean> {
    try {
        // Try tasklist first (Windows built-in, no PowerShell needed)
        const { stdout } = await execFileAsync(
            'tasklist',
            ['/FI', `IMAGENAME eq ${processName}`, '/FO', 'CSV', '/NH'],
            { timeout: 2000 }
        );
        // If tasklist finds the process, stdout will contain the process name
        const found = stdout.toLowerCase().includes(processName.toLowerCase());
        if (found) {
            return true;
        }
        // Fallback: try PowerShell if tasklist doesn't work (but this may crash)
        try {
            const { stdout: psStdout } = await execFileAsync(
                'powershell',
                [
                    '-NoProfile',
                    '-Command',
                    `Get-Process ${processName.replace('.exe', '')} -ErrorAction SilentlyContinue | Select-Object -First 1 | ForEach-Object { $_.Id }`
                ],
                { timeout: 2000 }
            );
            return psStdout.trim().length > 0;
        } catch {
            // PowerShell failed (expected on this machine), but tasklist already returned false
            return false;
        }
    } catch {
        return false;
    }
}

export async function killProcess(processName: string, force: boolean = true): Promise<void> {
    try {
        const args = force ? ['/F', '/IM', processName, '/T'] : ['/IM', processName, '/T'];
        await execFileAsync('taskkill', args, { timeout: 5000 });
    } catch (e) {
        // Process may have already exited
        throw e;
    }
}

export interface SpawnProcessOptions {
    cwd?: string;
    detached?: boolean;
    stdio?: 'ignore' | 'inherit' | 'pipe';
    windowsHide?: boolean;
    env?: NodeJS.ProcessEnv;
}

export function spawnProcess(
    exe: string,
    args: string[],
    options: SpawnProcessOptions = {}
): ChildProcess {
    const {
        cwd = path.dirname(exe),
        detached = true,
        stdio = 'ignore',
        windowsHide = true,
        env = process.env
    } = options;

    try {
        const process = spawn(exe, args, {
            cwd,
            detached,
            stdio,
            windowsHide,
            env
        });
        // Unref the process so Node.js can exit independently
        if (detached) {
            process.unref();
        }
        return process;
    } catch (spawnError: any) {
        // Fallback: try using cmd.exe to launch if direct spawn fails
        console.error(`[WARN] Direct spawn failed, trying cmd.exe fallback:`, spawnError);
        const cmdArgs = ['/c', 'start', '/min', exe, ...args];
        const cmdProcess = spawn('cmd.exe', cmdArgs, {
            cwd,
            detached,
            stdio,
            windowsHide,
            env
        });
        if (detached) {
            cmdProcess.unref();
        }
        return cmdProcess;
    }
}

// Dialog dismissal
export async function dismissOBSDialogs(): Promise<void> {
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    const repoRoot = path.resolve(moduleDir, '../../..');

    // Helper to dismiss "OBS is already running" dialog
    try {
        const alreadyRunningScript = path.join(repoRoot, 'tools', 'dismiss-obs-already-running.ps1');
        if (fs.existsSync(alreadyRunningScript)) {
            const cmdArgs = [
                '/c',
                'start',
                '/min',
                'powershell',
                '-NoProfile',
                '-ExecutionPolicy',
                'Bypass',
                '-File',
                alreadyRunningScript
            ];
            const dismissProcess = spawn('cmd.exe', cmdArgs, {
                detached: true,
                stdio: 'ignore',
                windowsHide: true
            });
            dismissProcess.unref();
            console.error(`[DEBUG] Launched "already running" dialog dismissal helper`);
        }
    } catch (e) {
        console.error('[WARN] Failed to start already-running dismissal helper (non-critical):', e);
    }

    // Helper to dismiss crash/safe-mode dialog if it appears
    try {
        const dismissScript = path.join(repoRoot, 'tools', 'dismiss-obs-safemode.ps1');
        if (fs.existsSync(dismissScript)) {
            const cmdArgs = [
                '/c',
                'start',
                '/min',
                'powershell',
                '-NoProfile',
                '-ExecutionPolicy',
                'Bypass',
                '-File',
                dismissScript
            ];
            const dismissProcess = spawn('cmd.exe', cmdArgs, {
                detached: true,
                stdio: 'ignore',
                windowsHide: true
            });
            dismissProcess.unref();
            console.error(`[DEBUG] Launched safe-mode dismissal helper`);
        }
    } catch (e) {
        console.error('[WARN] Failed to start safe-mode dismissal helper (non-critical):', e);
    }
}

// State file operations
export type TickState = {
    eventKey: string;
    broadcastId: string;
    obsStartTime?: string;
};

function getStatePath(sheet?: string): string {
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    const stateDir = path.resolve(moduleDir, '../../.state');
    return path.join(stateDir, `current-${sheet ?? 'default'}.json`);
}

export function readState(sheet?: string): TickState | undefined {
    const statePath = getStatePath(sheet);
    try {
        return JSON.parse(fs.readFileSync(statePath, 'utf8')) as TickState;
    } catch {
        return undefined;
    }
}

export function writeState(state: TickState, sheet?: string): void {
    const statePath = getStatePath(sheet);
    const stateDir = path.dirname(statePath);
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify(state), 'utf8');
}

export function clearState(sheet?: string): void {
    const statePath = getStatePath(sheet);
    try {
        fs.unlinkSync(statePath);
    } catch {
        // Ignore errors - file may not exist
    }
}

