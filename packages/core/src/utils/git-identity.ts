import { execSync } from 'child_process';
import * as path from 'path';

/**
 * Canonicalize a git remote URL so the same repository maps to one identity
 * regardless of access protocol. All of these converge to the same string:
 *   https://host/group/repo.git
 *   http://host/group/repo
 *   https://oauth2:token@host/group/repo.git   (auth stripped)
 *   git@host:group/repo.git                     (scp form → https)
 *   ssh://git@host:2222/group/repo.git          (port dropped)
 * This lets a server that fetches over SSH and a developer who clones over
 * HTTPS share the same index, which is the whole point of the layered model.
 */
export function normalizeGitUrl(raw: string): string {
    let url = (raw || '').trim();
    if (!url) return url;

    // scp-like syntax: user@host:path (no scheme). Convert to a parseable https URL.
    if (!/:\/\//.test(url)) {
        const scp = url.match(/^[A-Za-z0-9._-]+@([^:/]+):(.+)$/);
        if (scp) url = `https://${scp[1]}/${scp[2]}`;
    }

    try {
        const u = new URL(url);
        const host = u.hostname.toLowerCase(); // hostname drops any :port
        let p = u.pathname.replace(/^\/+/, '').replace(/\/+$/, '').replace(/\.git$/i, '');
        return `https://${host}/${p}.git`;
    } catch {
        return url.replace(/\/+$/, '').replace(/\.git$/i, '') + '.git';
    }
}

export function getRepoIdentity(codebasePath: string): string {
    const resolvedPath = path.resolve(codebasePath);

    try {
        const url = execSync('git remote get-url origin', {
            cwd: resolvedPath,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe']
        }).trim();

        const branch = execSync('git rev-parse --abbrev-ref HEAD', {
            cwd: resolvedPath,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe']
        }).trim();

        if (url && branch) {
            return `${normalizeGitUrl(url)}:${branch}`;
        }
    } catch {
    }

    return resolvedPath;
}
