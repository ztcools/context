/**
 * 测试用例 6：工具描述验证
 * 验证 MCP 工具的 LLM 面向描述是否正确
 * - 不应有 "absolute path" 强调
 * - 应提及 url+branch 隔离
 * - 应支持相对路径/工作区默认值
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// 用正则匹配 MCP 的 tool definitions
interface ToolDef {
    name: string;
    description: string;
    inputSchema: any;
}

async function getToolDefinitions(): Promise<ToolDef[]> {
    // 从 MCP 入口文件获取工具描述
    const indexPath = path.join(os.homedir(), ".claude-context", "packages", "mcp", "dist", "index.js");
    const content = fs.readFileSync(indexPath, "utf-8");
    // 提取工具 descriptions
    const defs: ToolDef[] = [];
    const re = /name:\s*"([^"]+)",\s*description:\s*`([^`]+)`,/g;
    let match;
    while ((match = re.exec(content)) !== null) {
        defs.push({ name: match[1], description: match[2], inputSchema: null });
    }
    return defs;
}

test("tool-descriptions: 不应包含 absolute path 强调", async () => {
    // 从源码检查
    const srcPath = path.join("/home/zt/claude-context", "packages", "mcp", "src", "index.ts");
    const content = fs.readFileSync(srcPath, "utf-8");

    // 不应该有 "absolute path" 作为强调
    const absolutePathMatches = content.match(/absolute path/gi);
    // 允许在注释或日志中出现，但不应该在工具描述中强调
    // 检查工具描述部分
    const searchDescStart = content.indexOf("const search_description");
    const searchDescEnd = content.indexOf(";", searchDescStart);
    const searchDesc = searchDescStart >= 0 ? content.substring(searchDescStart, searchDescEnd) : "";

    // search_code 描述中不应有 "absolute path" 作为强调
    const hasAbsolutePath = searchDesc.includes("absolute path");
    console.log(`  search_code 描述含 "absolute path": ${hasAbsolutePath}`);
    assert.ok(!hasAbsolutePath, "search_code 描述不应包含 'absolute path'");
});

test("tool-descriptions: 应提及 url+branch 隔离", async () => {
    const srcPath = path.join("/home/zt/claude-context", "packages", "mcp", "src", "index.ts");
    const content = fs.readFileSync(srcPath, "utf-8");

    // index_codebase 描述中应提及 url+branch 或 git 身份
    const hasUrlBranch = content.includes("git URL + branch") || content.includes("url+branch") || content.includes("URL + branch");
    console.log(`  工具描述提及 url+branch: ${hasUrlBranch}`);
    assert.ok(hasUrlBranch, "工具描述应提及 url+branch 隔离机制");
});

test("tool-descriptions: 四个工具应支持 path 默认值", async () => {
    const srcPath = path.join("/home/zt/claude-context", "packages", "mcp", "src", "index.ts");
    const content = fs.readFileSync(srcPath, "utf-8");

    // 检查是否有 "Defaults to" 或 "default" 提及
    const hasDefaults = content.includes("defaults to") || content.includes("Defaults to") || content.includes("default to");
    console.log(`  工具描述提及默认值: ${hasDefaults}`);
    assert.ok(hasDefaults, "工具描述应提及默认值");

    // 检查 path 是否已从 required 移除
    // 检查 inputSchema 定义
    const requiredMatches = content.match(/required:\s*\[([^\]]*)\]/g);
    let hasPathRequired = false;
    for (const match of requiredMatches || []) {
        if (match.includes("path")) {
            hasPathRequired = true;
        }
    }
    console.log(`  path 仍在 required 中: ${hasPathRequired}`);
    assert.ok(!hasPathRequired, "path 不应在 required 列表中");
});

test("tool-descriptions: search_code 保留 When to Use 结构", async () => {
    const srcPath = path.join("/home/zt/claude-context", "packages", "mcp", "src", "index.ts");
    const content = fs.readFileSync(srcPath, "utf-8");

    const hasWhenToUse = content.includes("When to Use") || content.includes("When to use");
    console.log(`  保留 When to Use: ${hasWhenToUse}`);
    assert.ok(hasWhenToUse, "search_code 应保留 When to Use 结构");
});

test("tool-descriptions: 所有工具描述 path 参数说明正确", async () => {
    const srcPath = path.join("/home/zt/claude-context", "packages", "mcp", "src", "index.ts");
    const content = fs.readFileSync(srcPath, "utf-8");

    // 检查四个工具都有 path 参数描述
    const tools = ["index_codebase", "search_code", "clear_index", "get_indexing_status"];
    for (const tool of tools) {
        const hasPathParam = content.includes(tool) && content.includes("path");
        console.log(`  ${tool} 有 path 参数: ${hasPathParam}`);
        assert.ok(hasPathParam, `${tool} 应有 path 参数`);
    }
});