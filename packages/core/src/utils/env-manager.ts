import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export class EnvManager {
    private envFilePath: string;
    /** In-memory cache of .env file contents to avoid disk I/O on every get(). */
    private envCache: Map<string, string> | null = null;
    private envCacheTime: number = 0;
    private static readonly CACHE_TTL_MS = 30_000; // 30 seconds

    constructor() {
        const homeDir = os.homedir();
        this.envFilePath = path.join(homeDir, '.context', '.env');
    }

    /** Reload .env cache from disk. */
    private ensureCache(): void {
        const now = Date.now();
        if (this.envCache && (now - this.envCacheTime) < EnvManager.CACHE_TTL_MS) return;
        this.envCache = new Map();
        try {
            if (fs.existsSync(this.envFilePath)) {
                const content = fs.readFileSync(this.envFilePath, 'utf-8');
                for (const line of content.split('\n')) {
                    const trimmed = line.trim();
                    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) continue;
                    const eqIdx = trimmed.indexOf('=');
                    if (eqIdx > 0) {
                        const key = trimmed.substring(0, eqIdx).trim();
                        let value = trimmed.substring(eqIdx + 1).trim();
                        // Strip surrounding quotes (single or double)
                        if ((value.startsWith('"') && value.endsWith('"')) ||
                            (value.startsWith("'") && value.endsWith("'"))) {
                            value = value.slice(1, -1);
                        }
                        // Handle export prefix
                        if (key.startsWith('export ')) {
                            this.envCache!.set(key.slice(7).trim(), value);
                        } else {
                            this.envCache!.set(key, value);
                        }
                    }
                }
            }
        } catch {
            // File read errors are non-fatal — cache stays empty.
        }
        this.envCacheTime = now;
    }

    /** Invalidate the env cache — call after external writes to .env. */
    invalidateCache(): void {
        this.envCache = null;
    }

    /**
     * Get environment variable by name
     * Priority: process.env > .env file > undefined
     */
    get(name: string): string | undefined {
        // First try process environment variables
        if (process.env[name]) {
            return process.env[name];
        }

        // Try cached .env file
        this.ensureCache();
        return this.envCache?.get(name);
    }

    /**
     * Set environment variable to the .env file
     */
    set(name: string, value: string): void {
        try {
            // Ensure directory exists
            const envDir = path.dirname(this.envFilePath);
            if (!fs.existsSync(envDir)) {
                fs.mkdirSync(envDir, { recursive: true });
            }

            let content = '';
            let found = false;

            // Read existing content if file exists
            if (fs.existsSync(this.envFilePath)) {
                content = fs.readFileSync(this.envFilePath, 'utf-8');

                // Update existing variable
                const lines = content.split('\n');
                for (let i = 0; i < lines.length; i++) {
                    if (lines[i].trim().startsWith(`${name}=`)) {
                        // Replace the existing value
                        lines[i] = `${name}=${value}`;
                        found = true;
                        console.log(`[EnvManager] ✅ Updated ${name} in ${this.envFilePath}`);
                        break;
                    }
                }
                content = lines.join('\n');
            }

            // If variable not found, append it
            if (!found) {
                if (content && !content.endsWith('\n')) {
                    content += '\n';
                }
                content += `${name}=${value}\n`;
                console.log(`[EnvManager] ✅ Added ${name} to ${this.envFilePath}`);
            }

            fs.writeFileSync(this.envFilePath, content, 'utf-8');

        } catch (error) {
            console.error(`[EnvManager] ❌ Failed to write env file: ${error}`);
            throw error;
        }
    }

    /**
     * Get the path to the .env file
     */
    getEnvFilePath(): string {
        return this.envFilePath;
    }
}

// Export a default instance for convenience
export const envManager = new EnvManager(); 