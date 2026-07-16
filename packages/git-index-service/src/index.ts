import { loadServiceConfig, buildContext } from './config.js';
import { createRepoProvider } from './repo-provider.js';
import { RepoManager } from './repo-manager.js';
import { GitIndexer } from './indexer.js';
import { Scheduler } from './scheduler.js';
import { startHttpServer } from './server.js';

async function main(): Promise<void> {
    const config = loadServiceConfig();
    console.log('[GitIndexService] Starting with config:', {
        source: config.source,
        workdir: config.workdir,
        repos: config.repos.length,
        runOnce: config.runOnce,
        dailyHour: config.dailyHour,
        intervalMs: config.intervalMs,
        httpPort: config.httpPort,
    });

    const context = buildContext();
    const repoManager = new RepoManager(config.workdir);
    const repoProvider = createRepoProvider(config);
    const indexer = new GitIndexer(context, repoManager, repoProvider);

    // One-shot mode: run a single pass and exit (useful for cron/CI drivers).
    if (config.runOnce) {
        const results = await indexer.indexAll();
        const failed = results.filter(r => !r.ok).length;
        process.exit(failed > 0 ? 1 : 0);
    }

    if (config.httpPort) {
        startHttpServer(config.httpPort, indexer);
    }

    if (config.runOnStart) {
        void indexer.indexAll();
    }

    const scheduler = new Scheduler(() => indexer.indexAll(), {
        intervalMs: config.intervalMs,
        dailyHour: config.dailyHour,
    });
    scheduler.start();

    const shutdown = () => {
        console.log('[GitIndexService] Shutting down...');
        scheduler.stop();
        process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    console.log('[GitIndexService] Running. Waiting for scheduled passes.');
}

main().catch(err => {
    console.error('[GitIndexService] Fatal:', err?.message || err);
    process.exit(1);
});
