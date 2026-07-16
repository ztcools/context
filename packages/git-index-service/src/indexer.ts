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

/**
 * Orchestrates one indexing pass over all main repositories: fetch each to its
 * branch tip (RepoManager), then let the core Context apply only the git delta
 * with embedding-cache dedup (Context.syncIndexByGit). Main stays authoritative
 * and independent of any developer's local environment.
 */
export class GitIndexer {
    private running = false;

    constructor(
        private context: Context,
        private repoManager: RepoManager,
        private repoProvider: RepoProvider,
    ) {}

    isRunning(): boolean {
        return this.running;
    }

    async indexOne(repo: RepoSpec): Promise<RepoIndexResult> {
        try {
            const localPath = this.repoManager.ensureCheckout(repo);
            const stats = await this.context.syncIndexByGit(localPath);
            console.log(`[GitIndexer] ✅ ${repo.name} [${repo.branch}] → ${stats.mode} (+${stats.added}/~${stats.modified}/-${stats.removed}, files=${stats.indexedFiles})`);
            return {
                repo: repo.name,
                ok: true,
                mode: stats.mode,
                indexedFiles: stats.indexedFiles,
                added: stats.added,
                modified: stats.modified,
                removed: stats.removed,
            };
        } catch (error: any) {
            const msg = error?.message || String(error);
            console.error(`[GitIndexer] ❌ ${repo.name} failed: ${msg}`);
            return { repo: repo.name, ok: false, error: msg };
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
        }
        return results;
    }
}
