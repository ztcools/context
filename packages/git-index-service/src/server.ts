import * as http from 'http';
import { GitIndexer } from './indexer.js';

/**
 * Tiny control surface (no framework): GET /health for liveness and
 * POST /index to trigger an out-of-band indexing pass. Optional — only started
 * when GIT_INDEX_HTTP_PORT is set.
 */
export function startHttpServer(port: number, indexer: GitIndexer): http.Server {
    const server = http.createServer((req, res) => {
        const url = req.url || '/';
        if (req.method === 'GET' && url === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok', running: indexer.isRunning() }));
            return;
        }
        if (req.method === 'POST' && url === '/index') {
            if (indexer.isRunning()) {
                res.writeHead(409, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'indexing already in progress' }));
                return;
            }
            void indexer.indexAll();
            res.writeHead(202, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'started' }));
            return;
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not found' }));
    });
    server.listen(port, () => console.log(`[Server] HTTP control surface on :${port}`));
    return server;
}
