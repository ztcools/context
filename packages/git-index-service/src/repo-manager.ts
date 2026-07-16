import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { RepoSpec } from './config.js';

/**
 * Owns local mirrors of the main repositories and keeps them at the tip of their
 * main branch. This is the "Git only" half of the PRD's Git Index Service: it
 * fetches from GitLab and produces a clean checkout; it never chunks, embeds, or
 * touches Milvus (that is delegated to the core Context by the Indexer).
 */
export class RepoManager {
    constructor(private workdir: string) {}

    private dirFor(repo: RepoSpec): string {
        const hash = crypto.createHash('md5').update(`${repo.url}#${repo.branch}`).digest('hex').slice(0, 12);
        const safe = repo.name.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 60);
        return path.join(this.workdir, `${safe}_${hash}`);
    }

    /** Fetch URL with the token injected for authenticated https clones/fetches. */
    private fetchUrl(repo: RepoSpec): string {
        if (!repo.token) return repo.url;
        try {
            const u = new URL(repo.url);
            if (u.protocol === 'https:') {
                u.username = 'oauth2';
                u.password = repo.token;
                return u.toString();
            }
        } catch { /* not an http url — use as-is */ }
        return repo.url;
    }

    private git(dir: string, args: string): string {
        return execSync(`git ${args}`, {
            cwd: dir,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: 300_000,
            maxBuffer: 64 * 1024 * 1024,
        }).trim();
    }

    /**
     * Ensure a local checkout of `repo` exists and is hard-reset to the tip of its
     * branch. The stored `origin` is the canonical URL (token-free) so the index
     * identity matches developer checkouts. Returns the local path.
     */
    ensureCheckout(repo: RepoSpec): string {
        const dir = this.dirFor(repo);
        const fetchUrl = this.fetchUrl(repo);

        if (!fs.existsSync(path.join(dir, '.git'))) {
            fs.mkdirSync(dir, { recursive: true });
            this.git(dir, 'init -q');
            this.git(dir, `remote add origin "${repo.url}"`);
        } else {
            // Keep origin canonical in case config changed.
            try { this.git(dir, `remote set-url origin "${repo.url}"`); } catch { /* ignore */ }
        }

        // Fetch full history (needed for commit-to-commit diffs) from the auth URL.
        this.git(dir, `fetch --prune "${fetchUrl}" "${repo.branch}"`);
        // Point a named local branch at the fetched tip so identity resolves to url:branch.
        this.git(dir, `checkout -B "${repo.branch}" FETCH_HEAD`);
        this.git(dir, 'reset --hard FETCH_HEAD');

        return dir;
    }
}
