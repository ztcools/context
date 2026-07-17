import * as http from 'http';
import { GitIndexer } from './indexer.js';
import { ConfigStore } from './config-store.js';
import { Scheduler } from './scheduler.js';
import { RepoSpec } from './config.js';
import { SshKeyManager } from './ssh-key.js';

/**
 * Management HTTP API for the git index service. Framework-free. Enables CORS so
 * the PhiGent web UI can call it directly. Endpoints:
 *   GET  /health
 *   GET  /status                 overall status (schedule, repos, last runs)
 *   GET  /repos                  list repos (tokens masked)
 *   GET  /ssh-key                the service SSH deploy public key
 *   POST /repos                  add/replace a repo {name,url,branch,token?}
 *   PUT  /repos/:name            update a repo
 *   DELETE /repos/:name          remove a repo
 *   PUT  /schedule               {dailyHour|null, intervalMs}
 *   POST /index                  index all now
 *   POST /index/:name            index one repo now
 */
export function startHttpServer(
    port: number,
    indexer: GitIndexer,
    store: ConfigStore,
    scheduler: Scheduler,
    sshKeys: SshKeyManager,
): http.Server {
    const maskRepo = (r: RepoSpec) => ({
        name: r.name,
        url: r.url,
        branch: r.branch,
        hasToken: !!r.token,
        // token → https clone/pull; no token → ssh with the service deploy key
        auth: r.token ? 'https' : 'ssh',
    });

    const send = (res: http.ServerResponse, code: number, body: unknown) => {
        res.writeHead(code, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        });
        res.end(JSON.stringify(body));
    };

    const readBody = (req: http.IncomingMessage): Promise<any> =>
        new Promise(resolve => {
            let raw = '';
            req.on('data', c => (raw += c));
            req.on('end', () => {
                if (!raw) return resolve({});
                try { resolve(JSON.parse(raw)); } catch { resolve(null); }
            });
            req.on('error', () => resolve(null));
        });

    const buildStatus = () => {
        const sched = scheduler.getSchedule();
        return {
            running: indexer.isRunning(),
            current: indexer.getCurrent(),
            lastPassAt: indexer.getLastPassAt(),
            schedule: {
                dailyHour: sched.dailyHour,
                intervalMs: sched.intervalMs,
                nextRunAt: scheduler.getNextRunAt(),
            },
            repos: store.getRepos().map(r => ({
                ...maskRepo(r),
                lastRun: indexer.getStatus(r.name) || null,
            })),
        };
    };

    const server = http.createServer(async (req, res) => {
        const method = req.method || 'GET';
        const url = (req.url || '/').split('?')[0];

        if (method === 'OPTIONS') return send(res, 204, {});

        try {
            if (method === 'GET' && url === '/health') {
                return send(res, 200, { status: 'ok', running: indexer.isRunning() });
            }
            if (method === 'GET' && url === '/status') {
                return send(res, 200, buildStatus());
            }
            if (method === 'GET' && url === '/repos') {
                return send(res, 200, { repos: store.getRepos().map(maskRepo) });
            }
            if (method === 'GET' && url === '/ssh-key') {
                return send(res, 200, { publicKey: sshKeys.getPublicKey() });
            }
            if (method === 'POST' && url === '/repos') {
                const body = await readBody(req);
                if (!body || !body.url || !body.name) {
                    return send(res, 400, { error: 'name and url are required' });
                }
                const repo: RepoSpec = {
                    name: String(body.name),
                    url: String(body.url),
                    branch: body.branch ? String(body.branch) : 'main',
                    token: body.token ? String(body.token) : undefined,
                };
                store.upsertRepo(repo);
                return send(res, 200, { ok: true, repo: maskRepo(repo) });
            }
            const repoMatch = url.match(/^\/repos\/(.+)$/);
            if (repoMatch) {
                const name = decodeURIComponent(repoMatch[1]);
                if (method === 'PUT') {
                    const existing = store.getRepo(name);
                    if (!existing) return send(res, 404, { error: 'repo not found' });
                    const body = await readBody(req);
                    if (!body) return send(res, 400, { error: 'invalid body' });
                    const updated: RepoSpec = {
                        name: existing.name,
                        url: body.url ? String(body.url) : existing.url,
                        branch: body.branch ? String(body.branch) : existing.branch,
                        // Empty string clears the token; omitted keeps the old one.
                        token: body.token === undefined ? existing.token : (body.token ? String(body.token) : undefined),
                    };
                    store.upsertRepo(updated);
                    return send(res, 200, { ok: true, repo: maskRepo(updated) });
                }
                if (method === 'DELETE') {
                    const removed = store.removeRepo(name);
                    return send(res, removed ? 200 : 404, { ok: removed });
                }
            }
            if (method === 'PUT' && url === '/schedule') {
                const body = await readBody(req);
                if (!body) return send(res, 400, { error: 'invalid body' });
                const current = scheduler.getSchedule();
                const dailyHour =
                    body.dailyHour === null ? null
                        : body.dailyHour !== undefined ? Math.max(0, Math.min(23, Number(body.dailyHour))) : current.dailyHour;
                const intervalMs =
                    body.intervalMs !== undefined ? Math.max(60000, Number(body.intervalMs)) : current.intervalMs;
                const next = { dailyHour, intervalMs };
                store.setSchedule(next);
                scheduler.reschedule(next);
                return send(res, 200, { ok: true, schedule: { ...next, nextRunAt: scheduler.getNextRunAt() } });
            }
            if (method === 'POST' && url === '/index') {
                if (indexer.isRunning()) return send(res, 409, { error: 'indexing already in progress' });
                void indexer.indexAll();
                return send(res, 202, { status: 'started' });
            }
            const indexMatch = url.match(/^\/index\/(.+)$/);
            if (method === 'POST' && indexMatch) {
                const name = decodeURIComponent(indexMatch[1]);
                if (indexer.isRunning()) return send(res, 409, { error: 'indexing already in progress' });
                void indexer.indexOneByName(name).then(r => {
                    if (r === null) console.warn(`[Server] index-now: repo '${name}' not found`);
                });
                return send(res, 202, { status: 'started', repo: name });
            }
            return send(res, 404, { error: 'not found' });
        } catch (e: any) {
            return send(res, 500, { error: e?.message || String(e) });
        }
    });
    server.listen(port, () => console.log(`[Server] Management API on :${port}`));
    return server;
}
