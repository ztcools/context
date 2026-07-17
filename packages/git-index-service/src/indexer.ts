import { Context } from '@seeway/claude-context-core';
import { RepoManager } from './repo-manager.js';
import { RepoProvider } from './repo-provider.js';
import { RepoSpec } from './config.js';

export interface RepoIndexResult {
    repo: string;
    ok: boolean;
    mode?: string;
    indexedFiles?: number;
    added?: number;
    modified?: number;
    removed?: number;
    error?: string;
}

export interface RepoRunStatus extends RepoIndexResult {
    at: number;
    durationMs: number;
}

/**
 * Orchestrates one indexing pass over all main repositories: fetch each to its
 * branch tip (RepoManager), then let the core Context apply only the git delta
 * with embedding-cache dedup (Context.syncIndexByGit). Main stays authoritative
 * and independent of any developer's local environment. Per-repo last-run status
 * is retained in memory for the management UI.
 */
export class GitIndexer {
    private running = false;
    private lastRun: Map<string, RepoRunStatus> = new Map();
    private lastPassAt: number | null = null;

    constructor(
        private context: Context,
        private repoManager: RepoManager,
        private repoProvider: RepoProvider,
    ) {}

    isRunning(): boolean {
        return this.running;
    }

    getLastPassAt(): number | null {
        return this.lastPassAt;
    }

    getStatus(name: string): RepoRunStatus | undefined {
        return this.lastRun.get(name);
    }

    async indexOne(repo: RepoSpec): Promise<RepoIndexResult> {
        const startedAt = this.now();
        try {
            const localPath = this.repoManager.ensureCheckout(repo);
            const stats = await this.context.syncIndexByGit(localPath);
            console.log(`[GitIndexer] ✅ ${repo.name} [${repo.branch}] → ${stats.mode} (+${stats.added}/~${stats.modified}/-${stats.removed}, files=${stats.indexedFiles})`);
            const result: RepoIndexResult = {
                repo: repo.name,
                ok: true,
                mode: stats.mode,
                indexedFiles: stats.indexedFiles,
                added: stats.added,
                modified: stats.modified,
                removed: stats.removed,
            };
            this.record(repo.name, result, startedAt);
            return result;
        } catch (error: any) {
            const msg = error?.message || String(error);
            console.error(`[GitIndexer] ❌ ${repo.name} failed: ${msg}`);
            const result: RepoIndexResult = { repo: repo.name, ok: false, error: msg };
            this.record(repo.name, result, startedAt);
            return result;
        }
    }

    /** Index a single repo by name (management "index now" for one repo). */
    async indexOneByName(name: string): Promise<RepoIndexResult | null> {
        const repos = await this.repoProvider.listRepos();
        const repo = repos.find(r => r.name === name);
        if (!repo) return null;
        if (this.running) return { repo: name, ok: false, error: 'a pass is already running' };
        this.running = true;
        try {
            return await this.indexOne(repo);
        } finally {
            this.running = false;
        }
    }

    async indexAll(): Promise<RepoIndexResult[]> {
        if (this.running) {
            console.warn('[GitIndexer] Pass already in progress; skipping.');
            return [{ repo: '*', ok: false, error: 'already running' }];
        }
        this.running = true;
        const results: RepoIndexResult[] = [];
        try {
            const repos = await this.repoProvider.listRepos();
            console.log(`[GitIndexer] 🔄 Starting pass over ${repos.length} repositories`);
            for (const repo of repos) {
                results.push(await this.indexOne(repo));
            }
            const ok = results.filter(r => r.ok).length;
            console.log(`[GitIndexer] 🏁 Pass complete: ${ok}/${results.length} succeeded`);
        } finally {
            this.running = false;
            this.lastPassAt = this.now();
        }
        return results;
    }

    private now(): number {
        return new Date().getTime();
    }

    private record(name: string, result: RepoIndexResult, startedAt: number): void {
        const at = this.now();
        this.lastRun.set(name, { ...result, at, durationMs: at - startedAt });
    }
}
