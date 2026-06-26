/**
 * 测试用例 3：路径解析 + 工作区检测
 * 验证 detectWorkspaceRoot、resolveCodebasePath 等函数
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";

// 动态导入 utils 中的函数
async function getUtils() {
    return await import("../../packages/mcp/src/utils.js");
}

// ─── 1. detectWorkspaceRoot 基础功能 ─────────────────────────────

test("path-resolution: detectWorkspaceRoot 在有 .git 的目录中正确检测", async () => {
    const { detectWorkspaceRoot } = await getUtils();
    const result = detectWorkspaceRoot();
    console.log(`  detected workspace root: ${result}`);
    // 当前目录是 claude-context 项目，应该有 .git
    assert.ok(result, "应检测到工作区根目录");
    assert.ok(fs.existsSync(path.join(result!, ".git")), "检测到的目录应有 .git");
});

// ─── 2. detectWorkspaceRoot monorepo 不误判 ──────────────────────

test("path-resolution: detectWorkspaceRoot 在 monorepo 子目录中不误判", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cc-test-monorepo-"));
    try {
        // 创建模拟 monorepo 结构
        const repoDir = path.join(tempRoot, "monorepo-test");
        const subPkgDir = path.join(repoDir, "packages", "my-package");
        fs.mkdirSync(subPkgDir, { recursive: true });

        // 子包有 package.json（模拟 monorepo 子包）
        fs.writeFileSync(path.join(subPkgDir, "package.json"), '{"name": "my-package"}');
        // 根目录有 .git（模拟真实仓库根）
        fs.mkdirSync(path.join(repoDir, ".git"));

        // 在子包目录下执行
        const originalCwd = process.cwd();
        process.chdir(subPkgDir);

        try {
            const { detectWorkspaceRoot } = await getUtils();
            const result = detectWorkspaceRoot();
            console.log(`  detected from sub-package: ${result}`);

            if (result) {
                // 应该检测到 .git 的目录（repoDir），而不是子包目录
                assert.ok(fs.existsSync(path.join(result, ".git")), "应检测到有 .git 的根目录");
                assert.ok(!result.includes("my-package"), "不应停在子包目录");
            }
        } finally {
            process.chdir(originalCwd);
        }
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

// ─── 3. resolveCodebasePath 各种输入 ─────────────────────────────

test("path-resolution: resolveCodebasePath 处理各种路径格式", async () => {
    const { resolveCodebasePath } = await getUtils();

    // 绝对路径
    const absResult = resolveCodebasePath("/home/zt/claude-context");
    console.log(`  absolute: ${absResult}`);
    assert.ok(path.isAbsolute(absResult), "绝对路径应保持不变");

    // "." 工作区
    const dotResult = resolveCodebasePath(".");
    console.log(`  '.': ${dotResult}`);
    assert.ok(path.isAbsolute(dotResult), "'.' 应解析为绝对路径");

    // "./" 工作区
    const dotSlash = resolveCodebasePath("./");
    console.log(`  './': ${dotSlash}`);
    assert.ok(path.isAbsolute(dotSlash), "'./' 应解析为绝对路径");

    // "workspace" 关键字
    const wsResult = resolveCodebasePath("workspace");
    console.log(`  'workspace': ${wsResult}`);
    assert.ok(path.isAbsolute(wsResult), "'workspace' 应解析为绝对路径");

    // 相对路径
    const relResult = resolveCodebasePath("packages/mcp");
    console.log(`  relative: ${relResult}`);
    assert.ok(path.isAbsolute(relResult), "相对路径应解析为绝对路径");
    assert.ok(relResult.endsWith("packages/mcp"), "应保留相对路径成分");
});

// ─── 4. ensureAbsolutePath ────────────────────────────────────────

test("path-resolution: ensureAbsolutePath 确保绝对路径", async () => {
    const { ensureAbsolutePath } = await getUtils();

    // 绝对路径直接返回
    assert.equal(ensureAbsolutePath("/home/zt"), "/home/zt");

    // 相对路径 resolve
    const resolved = ensureAbsolutePath("test");
    console.log(`  resolved test: ${resolved}`);
    assert.ok(path.isAbsolute(resolved));
});

// ─── 5. 路径带 ~ 展开 ────────────────────────────────────────────

test("path-resolution: resolveCodebasePath 展开 ~ 为 home 目录", async () => {
    const { resolveCodebasePath } = await getUtils();

    const homeResult = resolveCodebasePath("~");
    console.log(`  '~': ${homeResult}`);
    assert.equal(homeResult, os.homedir(), "~ 应展开为 home 目录");

    const homeSubResult = resolveCodebasePath("~/test");
    console.log(`  '~/test': ${homeSubResult}`);
    assert.equal(homeSubResult, path.join(os.homedir(), "test"), "~/test 应正确展开");
});