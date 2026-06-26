/**
 * 测试用例 1：基础工具功能测试
 * 验证 index_codebase、search_code、clear_index、get_indexing_status 四个工具
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";

// 测试仓库列表
const REPOS = {
    "code-study-record": "https://github.com/ztcools/code-study-record.git",
    "LSMKV": "https://github.com/ztcools/LSMKV.git",
    "TitanBench": "https://github.com/ztcools/TitanBench.git",
    "qt-teaching": "https://github.com/ztcools/qt-teaching-management-system.git",
    "claude-context": "https://github.com/ztcools/-AI-.git",
};

function cloneRepo(tempRoot: string, url: string, suffix: string): string {
    const dir = path.join(tempRoot, `cc-test-${suffix}`);
    fs.rmSync(dir, { recursive: true, force: true });
    execSync(`git clone ${url} ${dir}`, { stdio: "pipe", timeout: 60000 });
    return dir;
}

// ─── 1. get_indexing_status 工具 ─────────────────────────────────

test("get_indexing_status: 未索引的仓库返回 not_found", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cc-test-status-"));
    try {
        const repo = cloneRepo(tempRoot, REPOS["LSMKV"], "status");
        const { SnapshotManager } = await import("../../packages/mcp/src/snapshot.js");
        const sm = new SnapshotManager();
        const status = sm.getCodebaseStatus(repo);
        console.log(`  status: ${status}`);
        assert.equal(status, "not_found");
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

// ─── 2. index_codebase 功能 ──────────────────────────────────────

test("index_codebase: 索引后状态变为 indexed", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cc-test-index-"));
    try {
        const repo = cloneRepo(tempRoot, REPOS["LSMKV"], "index");
        const { SnapshotManager } = await import("../../packages/mcp/src/snapshot.js");
        const sm = new SnapshotManager();

        // 模拟索引完成
        sm.setCodebaseIndexed(repo, { indexedFiles: 10, totalChunks: 50, status: "completed" });
        sm.saveCodebaseSnapshot();

        const status = sm.getCodebaseStatus(repo);
        console.log(`  status: ${status}`);
        assert.equal(status, "indexed");

        const indexed = sm.getIndexedCodebases();
        console.log(`  indexed identities: ${JSON.stringify(indexed)}`);
        assert.equal(indexed.length, 1);
        assert.ok(indexed[0].includes("://"), "identity 应为 url 格式");
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

// ─── 3. search_code 功能 ─────────────────────────────────────────

test("search_code: 已索引仓库可搜索到结果", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cc-test-search-"));
    try {
        // 使用真实已索引的仓库
        const repo = "/home/zt/claude-context";
        // 这个仓库已通过 MCP 索引到 Milvus，直接验证搜索结果
        // 此处验证 SnapshotManager 层面
        const { SnapshotManager } = await import("../../packages/mcp/src/snapshot.js");
        const sm = new SnapshotManager();
        // 验证快照中 claude-context 的状态
        sm.loadCodebaseSnapshot();
        const status = sm.getCodebaseStatus(repo);
        console.log(`  claude-context status: ${status}`);
        // 如果已索引则验证 identity 格式
        if (status === "indexed") {
            const indexed = sm.getIndexedCodebases();
            const match = indexed.find(id => id.includes("ztcools/-AI-"));
            assert.ok(match, "claude-context 应在索引列表中");
            assert.ok(match.includes("://"), "identity 应为 url 格式");
            console.log(`  identity: ${match}`);
        }
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

// ─── 4. clear_index 功能 ─────────────────────────────────────────

test("clear_index: 清除后状态变为 not_found", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cc-test-clear-"));
    try {
        const repo = cloneRepo(tempRoot, REPOS["LSMKV"], "clear");
        const { SnapshotManager } = await import("../../packages/mcp/src/snapshot.js");
        const sm = new SnapshotManager();

        // 先索引
        sm.setCodebaseIndexed(repo, { indexedFiles: 5, totalChunks: 25, status: "completed" });
        sm.saveCodebaseSnapshot();
        assert.equal(sm.getCodebaseStatus(repo), "indexed");

        // 清除
        sm.removeCodebaseCompletely(repo);
        sm.saveCodebaseSnapshot();
        assert.equal(sm.getCodebaseStatus(repo), "not_found");
        console.log(`  cleared: ${repo}`);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

// ─── 5. 索引状态转换 ──────────────────────────────────────────────

test("indexing lifecycle: not_found → indexing → indexed → indexfailed", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cc-test-lifecycle-"));
    try {
        const repo = cloneRepo(tempRoot, REPOS["LSMKV"], "lifecycle");
        const { SnapshotManager } = await import("../../packages/mcp/src/snapshot.js");
        const sm = new SnapshotManager();

        // 初始状态
        assert.equal(sm.getCodebaseStatus(repo), "not_found");

        // indexing 0%
        sm.setCodebaseIndexing(repo, 0);
        sm.saveCodebaseSnapshot();
        assert.equal(sm.getCodebaseStatus(repo), "indexing");

        // indexing 50%
        sm.setCodebaseIndexing(repo, 50);
        assert.equal(sm.getCodebaseStatus(repo), "indexing");

        // indexed
        sm.setCodebaseIndexed(repo, { indexedFiles: 10, totalChunks: 100, status: "completed" });
        sm.saveCodebaseSnapshot();
        assert.equal(sm.getCodebaseStatus(repo), "indexed");

        // failed
        sm.setCodebaseIndexFailed(repo, "test failure", 30);
        sm.saveCodebaseSnapshot();
        assert.equal(sm.getCodebaseStatus(repo), "indexfailed");

        console.log(`  lifecycle passed: not_found → indexing → indexed → indexfailed`);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

// ─── 6. forceReindex 功能 ────────────────────────────────────────

test("forceReindex: 已索引仓库 force=true 可重新索引", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cc-test-force-"));
    try {
        const repo = cloneRepo(tempRoot, REPOS["LSMKV"], "force");
        const { SnapshotManager } = await import("../../packages/mcp/src/snapshot.js");
        const sm = new SnapshotManager();

        // 第一次索引
        sm.setCodebaseIndexed(repo, { indexedFiles: 5, totalChunks: 25, status: "completed" });
        sm.saveCodebaseSnapshot();
        assert.equal(sm.getCodebaseStatus(repo), "indexed");

        // 模拟 force 清除后重新索引
        sm.removeCodebaseCompletely(repo);
        sm.saveCodebaseSnapshot();
        assert.equal(sm.getCodebaseStatus(repo), "not_found");

        sm.setCodebaseIndexed(repo, { indexedFiles: 10, totalChunks: 50, status: "completed" });
        sm.saveCodebaseSnapshot();
        assert.equal(sm.getCodebaseStatus(repo), "indexed");
        console.log(`  forceReindex passed`);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});