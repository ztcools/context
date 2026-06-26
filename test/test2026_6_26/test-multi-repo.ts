/**
 * 测试用例 4：多仓库场景 + 跨仓库不干扰
 * 使用 withTempHome 隔离快照文件，绕过 sandbox EROFS
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";

import { getRepoIdentity } from "../../packages/core/src/utils/git-identity.js";
import { SnapshotManager } from "../../packages/mcp/src/snapshot.js";

const ALL_REPOS = {
    LSMKV: "https://github.com/ztcools/LSMKV.git",
    "code-study-record": "https://github.com/ztcools/code-study-record.git",
    TitanBench: "https://github.com/ztcools/TitanBench.git",
    "qt-teaching": "https://github.com/ztcools/qt-teaching-management-system.git",
    "claude-context": "https://github.com/ztcools/-AI-.git",
};

async function withTempHome(run: (tempRoot: string) => Promise<void>): Promise<void> {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cc-test-multi-"));
    const homeDir = path.join(tempRoot, "home");
    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;

    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;

    try {
        fs.mkdirSync(path.join(homeDir, ".context"), { recursive: true });
        await run(tempRoot);
    } finally {
        if (originalHome === undefined) delete process.env.HOME;
        else process.env.HOME = originalHome;
        if (originalUserProfile === undefined) delete process.env.USERPROFILE;
        else process.env.USERPROFILE = originalUserProfile;
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
}

function cloneRepo(tempRoot: string, url: string, suffix: string): string {
    const dir = path.join(tempRoot, `cc-${suffix}`);
    fs.rmSync(dir, { recursive: true, force: true });
    execSync(`git clone ${url} ${dir}`, { stdio: "pipe", timeout: 60000 });
    return dir;
}

// ─── 1. 5个仓库全部索引，identity 各不同 ────────────────────────

test("multi-repo: 5个仓库全部索引，identity 各不同", async (t) => {
    await withTempHome(async (tempRoot) => {
        const sm = new SnapshotManager();
        const identities: string[] = [];

        for (const [name, url] of Object.entries(ALL_REPOS)) {
            const repo = cloneRepo(tempRoot, url, name);
            const id = getRepoIdentity(repo);
            identities.push(id);
            console.log(`  ${name}: ${id}`);

            sm.setCodebaseIndexed(repo, { indexedFiles: 1, totalChunks: 1, status: "completed" });
            sm.saveCodebaseSnapshot();
        }

        const unique = new Set(identities);
        assert.equal(unique.size, Object.keys(ALL_REPOS).length, "所有仓库 identity 应唯一");
        assert.equal(sm.getIndexedCodebases().length, Object.keys(ALL_REPOS).length);

        for (const id of identities) {
            assert.ok(id.includes("://"), `${id} 应为 url 格式`);
            assert.ok(!id.startsWith("/"), `${id} 不应是绝对路径`);
        }
    });
});

// ─── 2. 跨仓库搜索不干扰 ─────────────────────────────────────────

test("multi-repo: 跨仓库索引互不干扰", async (t) => {
    await withTempHome(async (tempRoot) => {
        const sm = new SnapshotManager();
        const lsmkv = cloneRepo(tempRoot, ALL_REPOS["LSMKV"], "lsmkv");
        const titan = cloneRepo(tempRoot, ALL_REPOS["TitanBench"], "titan");

        sm.setCodebaseIndexed(lsmkv, { indexedFiles: 10, totalChunks: 100, status: "completed" });
        sm.setCodebaseIndexed(titan, { indexedFiles: 20, totalChunks: 200, status: "completed" });
        sm.saveCodebaseSnapshot();

        assert.equal(sm.getCodebaseStatus(lsmkv), "indexed");
        assert.equal(sm.getCodebaseStatus(titan), "indexed");

        sm.removeCodebaseCompletely(lsmkv);
        sm.saveCodebaseSnapshot();
        assert.equal(sm.getCodebaseStatus(lsmkv), "not_found");
        assert.equal(sm.getCodebaseStatus(titan), "indexed", "TitanBench 不受影响");
        assert.equal(sm.getIndexedCodebases().length, 1);
    });
});

// ─── 3. 同一仓库 clone 到不同路径，索引后共享 ────────────────────

test("multi-repo: 同一仓库三次 clone，索引一次共享三次", async (t) => {
    await withTempHome(async (tempRoot) => {
        const sm = new SnapshotManager();
        const repoA = cloneRepo(tempRoot, ALL_REPOS["LSMKV"], "share-a");
        const repoB = cloneRepo(tempRoot, ALL_REPOS["LSMKV"], "share-b");
        const repoC = cloneRepo(tempRoot, ALL_REPOS["LSMKV"], "share-c");

        sm.setCodebaseIndexed(repoA, { indexedFiles: 30, totalChunks: 270, status: "completed" });
        sm.saveCodebaseSnapshot();

        const identity = getRepoIdentity(repoA);
        const idB = getRepoIdentity(repoB);
        const idC = getRepoIdentity(repoC);
        assert.equal(identity, idB);
        assert.equal(identity, idC);

        assert.equal(sm.getCodebaseStatus(repoB), "indexed", "B 应显示已索引");
        assert.equal(sm.getCodebaseStatus(repoC), "indexed", "C 应显示已索引");
        assert.equal(sm.getIndexedCodebases().length, 1, "应只有一条索引记录");
        console.log(`  3个路径共享1个索引: ${identity}`);
    });
});

// ─── 4. 路径切换后索引不丢失 ─────────────────────────────────────

test("multi-repo: 用户换路径后索引仍可用", async (t) => {
    await withTempHome(async (tempRoot) => {
        const sm = new SnapshotManager();

        const repoA = cloneRepo(tempRoot, ALL_REPOS["code-study-record"], "path-a");
        sm.setCodebaseIndexed(repoA, { indexedFiles: 5, totalChunks: 50, status: "completed" });
        sm.saveCodebaseSnapshot();

        const repoB = cloneRepo(tempRoot, ALL_REPOS["code-study-record"], "path-b");
        const status = sm.getCodebaseStatus(repoB);
        console.log(`  路径A: ${repoA}`);
        console.log(`  路径B: ${repoB}`);
        console.log(`  路径B 状态: ${status}`);
        assert.equal(status, "indexed", "路径B 应显示已索引");

        const found = sm.findIndexedCodebasePath(repoB);
        assert.ok(found, "应能找到已索引路径");
        console.log(`  findIndexedCodebasePath: ${found}`);
    });
});