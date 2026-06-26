/**
 * 测试用例 2：url+branch 隔离 + 团队共享索引
 * 核心验证：同一仓库不同路径 → 相同 identity，不重复索引
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

const REPOS = {
    LSMKV: {
        url: "https://github.com/ztcools/LSMKV.git",
        expectedIdentity: "https://github.com/ztcools/LSMKV.git:master",
    },
    "code-study-record": {
        url: "https://github.com/ztcools/code-study-record.git",
        expectedIdentity: "https://github.com/ztcools/code-study-record.git:master",
    },
    TitanBench: {
        url: "https://github.com/ztcools/TitanBench.git",
        expectedIdentity: "https://github.com/ztcools/TitanBench.git:master",
    },
    "qt-teaching": {
        url: "https://github.com/ztcools/qt-teaching-management-system.git",
        expectedIdentity: "https://github.com/ztcools/qt-teaching-management-system.git:master",
    },
};

/**
 * 为每个测试创建独立的 HOME 目录，隔离快照文件
 */
async function withTempHome(run: (tempRoot: string) => Promise<void>): Promise<void> {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cc-test-iso-"));
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

// ─── 场景1：同一仓库克隆到不同路径 → 相同 identity ────────────

test("url+branch: 同一仓库不同路径 → 相同 identity", async (t) => {
    await withTempHome(async (tempRoot) => {
        for (const [name, repo] of Object.entries(REPOS)) {
            const dirA = cloneRepo(tempRoot, repo.url, `${name}-a`);
            const dirB = cloneRepo(tempRoot, repo.url, `${name}-b`);
            const idA = getRepoIdentity(dirA);
            const idB = getRepoIdentity(dirB);
            console.log(`  ${name}: A="${idA}" B="${idB}"`);
            assert.equal(idA, idB, `${name}: 相同仓库不同路径应有相同 identity`);
            assert.equal(idA, repo.expectedIdentity);
            assert.ok(idA.includes("://"), "identity 应为 url 格式");
            assert.ok(!idA.startsWith("/"), "identity 不应是绝对路径");
        }
    });
});

// ─── 场景2：路径A索引后，路径B检测为已索引 ─────────────────────

test("url+branch: 路径A索引后路径B显示已索引（团队共享）", async (t) => {
    await withTempHome(async (tempRoot) => {
        const aliceRepo = cloneRepo(tempRoot, REPOS["LSMKV"].url, "alice");
        const bobRepo = cloneRepo(tempRoot, REPOS["LSMKV"].url, "bob");
        const sm = new SnapshotManager();

        sm.setCodebaseIndexed(aliceRepo, { indexedFiles: 42, totalChunks: 270, status: "completed" });
        sm.saveCodebaseSnapshot();
        assert.equal(sm.getCodebaseStatus(aliceRepo), "indexed");

        const identity = getRepoIdentity(bobRepo);
        const alreadyIndexed = sm.getIndexedCodebases().includes(identity);
        console.log(`  Alice identity: ${getRepoIdentity(aliceRepo)}`);
        console.log(`  Bob identity:   ${identity}`);
        console.log(`  Bob 检测已索引: ${alreadyIndexed}`);
        assert.ok(alreadyIndexed, "Bob 应该检测到 Alice 已索引");

        const bobStatus = sm.getCodebaseStatus(bobRepo);
        assert.equal(bobStatus, "indexed", "Bob 的路径应显示 indexed");
    });
});

// ─── 场景3：不同仓库 → 不同 identity ────────────────────────────

test("url+branch: 不同仓库 → 不同 identity", async (t) => {
    await withTempHome(async (tempRoot) => {
        const sm = new SnapshotManager();
        const repos = ["LSMKV", "code-study-record", "TitanBench", "qt-teaching"];
        const repoClones: Record<string, string> = {};

        for (const name of repos) {
            repoClones[name] = cloneRepo(tempRoot, REPOS[name].url, name);
        }

        for (const [name, dir] of Object.entries(repoClones)) {
            sm.setCodebaseIndexed(dir, { indexedFiles: 1, totalChunks: 1, status: "completed" });
            sm.saveCodebaseSnapshot();
        }

        const indexed = sm.getIndexedCodebases();
        console.log(`  indexed identities: ${JSON.stringify(indexed)}`);
        assert.equal(indexed.length, repos.length, "所有仓库应各自独立");

        const uniqueIdentities = new Set(indexed);
        assert.equal(uniqueIdentities.size, repos.length);

        for (const id of indexed) {
            assert.ok(id.includes("://"), `identity ${id} 应为 url 格式`);
        }
    });
});

// ─── 场景4：删除一个仓库不影响其他 ──────────────────────────────

test("url+branch: 删除一个仓库不影响其他", async (t) => {
    await withTempHome(async (tempRoot) => {
        const sm = new SnapshotManager();
        const lsmkv = cloneRepo(tempRoot, REPOS["LSMKV"].url, "lsmkv");
        const titan = cloneRepo(tempRoot, REPOS["TitanBench"].url, "titan");

        sm.setCodebaseIndexed(lsmkv, { indexedFiles: 1, totalChunks: 1, status: "completed" });
        sm.setCodebaseIndexed(titan, { indexedFiles: 1, totalChunks: 1, status: "completed" });
        sm.saveCodebaseSnapshot();
        assert.equal(sm.getIndexedCodebases().length, 2);

        sm.removeCodebaseCompletely(lsmkv);
        sm.saveCodebaseSnapshot();
        assert.equal(sm.getIndexedCodebases().length, 1);
        assert.equal(sm.getCodebaseStatus(lsmkv), "not_found");
        assert.equal(sm.getCodebaseStatus(titan), "indexed", "TitanBench 不应受影响");
        console.log(`  删除 LSMKV 后 TitanBench 仍为 indexed`);
    });
});

// ─── 场景5：快照持久化后 identity 保持不变 ──────────────────────

test("url+branch: 快照 save/load 后 identity 格式不变", async (t) => {
    await withTempHome(async (tempRoot) => {
        const repo = cloneRepo(tempRoot, REPOS["LSMKV"].url, "snapshot");
        const sm1 = new SnapshotManager();
        sm1.setCodebaseIndexed(repo, { indexedFiles: 15, totalChunks: 100, status: "completed" });
        sm1.saveCodebaseSnapshot();

        const sm2 = new SnapshotManager();
        sm2.loadCodebaseSnapshot();
        const indexed = sm2.getIndexedCodebases();
        console.log(`  reloaded: ${JSON.stringify(indexed)}`);
        assert.equal(indexed.length, 1);
        assert.ok(indexed[0].includes("://"));
        assert.ok(!indexed[0].startsWith("/"));
    });
});

// ─── 场景6：getIndexedCodebases 返回 identity 列表 ───────────────

test("url+branch: getIndexedCodebases 返回 identity 而非路径", async (t) => {
    await withTempHome(async (tempRoot) => {
        const repo = cloneRepo(tempRoot, REPOS["LSMKV"].url, "list");
        const sm = new SnapshotManager();
        sm.setCodebaseIndexed(repo, { indexedFiles: 1, totalChunks: 1, status: "completed" });
        sm.saveCodebaseSnapshot();

        const indexed = sm.getIndexedCodebases();
        console.log(`  indexed: ${JSON.stringify(indexed)}`);

        for (const id of indexed) {
            assert.ok(!id.startsWith("/"), `identity 不应是绝对路径: ${id}`);
            assert.ok(id.includes("://"), `identity 应为 url 格式: ${id}`);
        }
    });
});