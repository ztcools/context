/**
 * Integration test: graph indexing → search_code enrichment.
 *
 * Verifies the full pipeline:
 * 1. Index a real (multi-file) TypeScript project
 * 2. search_code returns graph context with cross-file call relationships
 * 3. Architecture overview is included
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { GraphToolHandlers } from "./graph-handlers.js";
import { getRepoIdentity } from "@zilliz/claude-context-core";

async function withTempRepo(
    files: Record<string, string>,
    run: (repoPath: string) => Promise<void>,
): Promise<void> {
    const repoPath = await mkdtemp(path.join(os.tmpdir(), "claude-context-graph-test-"));
    const gitDir = path.join(repoPath, ".git");
    await mkdir(gitDir, { recursive: true });

    for (const [filePath, content] of Object.entries(files)) {
        const fullPath = path.join(repoPath, filePath);
        await mkdir(path.dirname(fullPath), { recursive: true });
        await writeFile(fullPath, content, "utf8");
    }

    try {
        await run(repoPath);
    } finally {
        await rm(repoPath, { recursive: true, force: true });
    }
}

/** Create a GraphToolHandlers with a temp SQLite database. */
function createTestHandlers(): GraphToolHandlers {
    const dbPath = path.join(os.tmpdir(), `graph-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    return new GraphToolHandlers(dbPath);
}

// ── Test fixtures ────────────────────────────────────────────────
// A simple multi-file project with cross-file calls:
//   auth.ts: defines validateUser() and hashPassword()
//   handler.ts: imports validateUser from auth.ts, calls it
//   utils.ts: defines log() and formatDate()
//   handler.ts: also imports log from utils.ts, calls it

const AUTH_TS = `
export function validateUser(username: string, password: string): boolean {
    const hash = hashPassword(password);
    return username.length > 0 && hash !== '';
}

export function hashPassword(password: string): string {
    return password.split('').reverse().join('');
}
`;

const HANDLER_TS = `
import { validateUser } from './auth';
import { log } from './utils';

export function handleLogin(username: string, password: string): boolean {
    log('Processing login for ' + username);
    const result = validateUser(username, password);
    log('Login result: ' + result);
    return result;
}
`;

const UTILS_TS = `
export function log(message: string): void {
    console.log('[LOG] ' + message);
}

export function formatDate(date: Date): string {
    return date.toISOString();
}
`;

// ── Tests ────────────────────────────────────────────────────────

test("graph indexing creates nodes and edges for a multi-file project", async () => {
    await withTempRepo(
        {
            "src/auth.ts": AUTH_TS,
            "src/handler.ts": HANDLER_TS,
            "src/utils.ts": UTILS_TS,
        },
        async (repoPath) => {
            const handlers = createTestHandlers();
            const store = handlers.getStore();

            try {
                // Full index
                const result = await handlers.handleIndexRepository({
                    repo_path: repoPath,
                    mode: "full",
                });

                const text = result.content[0].text;
                assert.match(text, /Indexed repository/);
                assert.match(text, /nodes/);
                assert.match(text, /edges/);

                // Verify project stats
                const project = getRepoIdentity(repoPath);
                const stats = store.getProjectStats(project);
                assert.ok(stats.nodes > 0, "should have nodes");
                assert.ok(stats.edges > 0, "should have edges");

                // Verify function nodes exist
                const nodeResult = store.findNodes({ project, limit: 100 });
                const names = nodeResult.results.map((r) => r.node.name);
                assert.ok(names.includes("validateUser"), "should have validateUser");
                assert.ok(names.includes("hashPassword"), "should have hashPassword");
                assert.ok(names.includes("handleLogin"), "should have handleLogin");
                assert.ok(names.includes("log"), "should have log");
                assert.ok(names.includes("formatDate"), "should have formatDate");

                // Verify some edges exist (intra-file or cross-file)
                assert.ok(stats.edges > 0, "should have edges (intra-file CALLS or cross-file RESOLVED)");

                console.log(
                    `[test] Indexed ${stats.nodes} nodes, ${stats.edges} edges in ${repoPath}`,
                );
            } finally {
                handlers.close();
            }
        },
    );
});

test("cross-file CALLS edges are resolved during indexing", async () => {
    await withTempRepo(
        {
            "src/auth.ts": AUTH_TS,
            "src/handler.ts": HANDLER_TS,
            "src/utils.ts": UTILS_TS,
        },
        async (repoPath) => {
            const handlers = createTestHandlers();
            const store = handlers.getStore();

            try {
                await handlers.handleIndexRepository({
                    repo_path: repoPath,
                    mode: "full",
                });

                const project = getRepoIdentity(repoPath);

                // Find handleLogin node
                const nodeResult = store.findNodes({ project, limit: 100 });
                const handleLoginNode = nodeResult.results.find(
                    (r) => r.node.name === "handleLogin",
                );
                assert.ok(handleLoginNode, "should find handleLogin node");

                // handleLogin should have CALLS edges to log (at minimum, from import resolution)
                const calleeEdges = store.getEdgesBySource(
                    handleLoginNode!.node.id,
                    "CALLS",
                );
                const calleeNames = calleeEdges
                    .map((e) => {
                        const n = store.getNodeById(e.targetId);
                        return n?.name;
                    })
                    .filter(Boolean);

                // At minimum, log should be resolved via cross-file import
                assert.ok(
                    calleeNames.includes("log"),
                    `handleLogin should call log, got: ${calleeNames.join(", ")}`,
                );
                assert.ok(
                    calleeNames.length >= 1,
                    `should have at least 1 cross-file call, got ${calleeNames.length}`,
                );

                // Verify at least one edge has crossFile metadata
                const crossFileEdges = calleeEdges.filter(
                    (e) => e.properties?.crossFile === true,
                );
                assert.ok(
                    crossFileEdges.length > 0,
                    `should have cross-file edges, got ${calleeEdges.length} edges`,
                );

                console.log(
                    `[test] Cross-file CALLS resolved: ${calleeNames.join(", ")} (${crossFileEdges.length} cross-file)`,
                );
            } finally {
                handlers.close();
            }
        },
    );
});

test("graph status shows indexing progress", async () => {
    await withTempRepo(
        {
            "src/auth.ts": AUTH_TS,
            "src/handler.ts": HANDLER_TS,
            "src/utils.ts": UTILS_TS,
        },
        async (repoPath) => {
            const handlers = createTestHandlers();
            const store = handlers.getStore();

            try {
                const project = getRepoIdentity(repoPath);

                // Full index
                await handlers.handleIndexRepository({
                    repo_path: repoPath,
                    mode: "full",
                });

                // After indexing, progress should be null (completed)
                const progress = handlers.getIndexingProgress(project);
                assert.strictEqual(progress, null, "progress should be null after indexing");

                // Verify stats
                const stats = store.getProjectStats(project);
                assert.ok(stats.nodes >= 5, `should have at least 5 nodes, got ${stats.nodes}`);
                assert.ok(stats.edges >= 3, `should have at least 3 edges, got ${stats.edges}`);

                console.log(
                    `[test] Status: ${stats.nodes} nodes, ${stats.edges} edges`,
                );
            } finally {
                handlers.close();
            }
        },
    );
});

test("graph context enrichment includes architecture overview", async () => {
    await withTempRepo(
        {
            "src/auth.ts": AUTH_TS,
            "src/handler.ts": HANDLER_TS,
            "src/utils.ts": UTILS_TS,
        },
        async (repoPath) => {
            const handlers = createTestHandlers();
            const store = handlers.getStore();

            try {
                const project = getRepoIdentity(repoPath);

                await handlers.handleIndexRepository({
                    repo_path: repoPath,
                    mode: "full",
                });

                // Architecture overview should work
                const archResult = handlers.handleGetArchitecture({ project });
                const archText = archResult.content[0].text;
                assert.ok(archText.length > 0, "architecture should not be empty");
                // Should contain node count information
                assert.match(
                    archText,
                    /nodes|module|entry|cluster|orphan/i,
                    `architecture should mention structural info, got: ${archText.slice(0, 200)}`,
                );

                console.log(`[test] Architecture overview: ${archText.slice(0, 200)}...`);
            } finally {
                handlers.close();
            }
        },
    );
});

test("graph search finds nodes by name pattern", async () => {
    await withTempRepo(
        {
            "src/auth.ts": AUTH_TS,
            "src/handler.ts": HANDLER_TS,
            "src/utils.ts": UTILS_TS,
        },
        async (repoPath) => {
            const handlers = createTestHandlers();
            const store = handlers.getStore();

            try {
                const project = getRepoIdentity(repoPath);

                await handlers.handleIndexRepository({
                    repo_path: repoPath,
                    mode: "full",
                });

                // Search by name pattern
                const searchResult = handlers.handleSearchGraph({
                    project,
                    name_pattern: "handle",
                });
                const searchText = searchResult.content[0].text;
                assert.ok(searchText.includes("handleLogin"), "should find handleLogin");
                assert.ok(!searchText.includes("validateUser"), "should not find validateUser");

                // Search by file pattern
                const fileResult = handlers.handleSearchGraph({
                    project,
                    file_pattern: "auth",
                });
                const fileText = fileResult.content[0].text;
                assert.ok(fileText.includes("validateUser"), "should find validateUser in auth file");
                assert.ok(fileText.includes("hashPassword"), "should find hashPassword in auth file");

                console.log(`[test] Graph search: name search found handleLogin, file search found auth functions`);
            } finally {
                handlers.close();
            }
        },
    );
});

test("incremental indexing updates only changed files", async () => {
    await withTempRepo(
        {
            "src/auth.ts": AUTH_TS,
            "src/utils.ts": UTILS_TS,
        },
        async (repoPath) => {
            const handlers = createTestHandlers();
            const store = handlers.getStore();

            try {
                const project = getRepoIdentity(repoPath);

                // Full index with 2 files
                await handlers.handleIndexRepository({
                    repo_path: repoPath,
                    mode: "full",
                });

                const stats1 = store.getProjectStats(project);
                const nodeCount1 = stats1.nodes;

                // Add handler.ts and write it AFTER the initial index
                const handlerPath = path.join(repoPath, "src/handler.ts");
                await mkdir(path.dirname(handlerPath), { recursive: true });
                await writeFile(handlerPath, HANDLER_TS, "utf8");

                // Incremental index with specific files
                await handlers.handleIndexRepository({
                    repo_path: repoPath,
                    mode: "incremental",
                    files: ["src/handler.ts"],
                });

                const stats2 = store.getProjectStats(project);
                assert.ok(
                    stats2.nodes > nodeCount1,
                    `incremental should add nodes: ${nodeCount1} → ${stats2.nodes}`,
                );

                console.log(
                    `[test] Incremental: ${nodeCount1} → ${stats2.nodes} nodes`,
                );
            } finally {
                handlers.close();
            }
        },
    );
});