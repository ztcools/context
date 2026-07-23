import * as crypto from 'crypto';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { getRepoIdentity } from './git-identity';

/**
 * Developer fingerprint — a stable, persistent identifier that distinguishes
 * one developer's index from another's on the same branch.
 *
 * **零配置自动生效**：git 团队开发必须配置 `user.email`（git 自身要求），
 * 该 email 自动作为开发者标识，无需任何额外配置。
 *
 * Resolution order（按优先级自动选择第一个可用值）:
 *   1. CLAUDE_CONTEXT_DEV_ID env var         （可选，团队强制统一标识）
 *   2. git config user.email                  （默认，自动获取，推荐）
 *   3. hostname                               （兜底，git 不可用时）
 *   4. /etc/machine-id                        （终极兜底）
 *
 * The fingerprint is cached to ~/.claude-context/dev-id so it survives
 * reboots and MCP restarts. 缓存后的值不会因环境变化而改变，保证稳定。
 */

const DEV_ID_CACHE_DIR = path.join(os.homedir(), '.claude-context');
const DEV_ID_CACHE_FILE = path.join(DEV_ID_CACHE_DIR, 'dev-id');

let _cached: string | null = null;

/** Normalize an arbitrary string into a short, safe identifier segment. */
function slugify(raw: string, maxLen: number = 12): string {
    const slug = raw
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, maxLen);
    // Append a 4-char hash to prevent collisions (e.g. alice.johnson@c.com
    // and alice.johnson-smith@c.com both slugify to "alice_johnso").
    const hash = crypto.createHash('md5').update(raw).digest('hex').substring(0, 4);
    return `${slug}_${hash}`;
}

/** Compute a fresh fingerprint from the resolution priority chain. */
function computeFingerprint(): string {
    // 1. Explicit env var (highest priority)
    const envId = (process.env['CLAUDE_CONTEXT_DEV_ID'] || '').trim();
    if (envId) {
        return slugify(envId, 16);
    }

    // 2. git user.email from the nearest repo
    try {
        const email = execSync('git config user.email', {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: 3_000,
        }).trim();
        if (email && email.includes('@')) {
            return slugify(email, 12);
        }
    } catch {
        // git not available or no config — fall through
    }

    // 3. hostname
    try {
        const host = os.hostname().trim();
        if (host) {
            return slugify(host, 12);
        }
    } catch {
        // fall through
    }

    // 4. Ultimate fallback — machine-id based, stable
    try {
        const machineId = fs.readFileSync('/etc/machine-id', 'utf-8').trim();
        return 'dev_' + crypto.createHash('md5').update(machineId).digest('hex').substring(0, 8);
    } catch {
        return 'dev_' + crypto.randomBytes(4).toString('hex');
    }
}

/** Load cached fingerprint from disk, or compute + cache a new one. */
export function getDevFingerprint(): string {
    if (_cached) return _cached;

    try {
        if (fs.existsSync(DEV_ID_CACHE_FILE)) {
            const cached = fs.readFileSync(DEV_ID_CACHE_FILE, 'utf-8').trim();
            if (cached.length > 0) {
                _cached = cached;
                return _cached;
            }
        }
    } catch {
        // cache file unreadable — recompute
    }

    const fp = computeFingerprint();
    try {
        fs.mkdirSync(DEV_ID_CACHE_DIR, { recursive: true });
        fs.writeFileSync(DEV_ID_CACHE_FILE, fp + '\n', 'utf-8');
    } catch {
        // can't persist — still usable for this session
    }
    _cached = fp;
    return fp;
}

/** Invalidate the in-memory cache (for testing or explicit refresh). */
export function clearDevFingerprintCache(): void {
    _cached = null;
}

/**
 * Get the dev-aware repo identity: `<remoteUrl>:<branch>:<devFingerprint>`.
 * This distinguishes one developer's index from another's on the same branch.
 */
export function getDevRepoIdentity(codebasePath: string): string {
    const base = getRepoIdentity(codebasePath);
    const dev = getDevFingerprint();
    return `${base}:${dev}`;
}

/**
 * Get the branch identity WITHOUT the dev fingerprint.
 * Used for looking up the shared root (main) collection.
 */
export function getBranchIdentity(codebasePath: string): string {
    return getRepoIdentity(codebasePath);
}
