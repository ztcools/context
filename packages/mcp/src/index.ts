#!/usr/bin/env node

// CRITICAL: Redirect console outputs to stderr IMMEDIATELY to avoid interfering with MCP JSON protocol
// Only MCP protocol messages should go to stdout
const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;

console.log = (...args: any[]) => {
    process.stderr.write('[LOG] ' + args.join(' ') + '\n');
};

console.warn = (...args: any[]) => {
    process.stderr.write('[WARN] ' + args.join(' ') + '\n');
};

// console.error already goes to stderr by default

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    ListToolsRequestSchema,
    CallToolRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import { Context } from "@zilliz/claude-context-core";
import { MilvusVectorDatabase } from "@zilliz/claude-context-core";

// Import our modular components
import { createMcpConfig, logConfigurationSummary, showHelpMessage, ContextMcpConfig } from "./config.js";
import { createEmbeddingInstance, logEmbeddingProviderInfo } from "./embedding.js";
import { SnapshotManager } from "./snapshot.js";
import { SyncManager } from "./sync.js";
import { ToolHandlers } from "./handlers.js";
import { GraphToolHandlers } from "./graph-handlers.js";

class ContextMcpServer {
    private server: Server;
    private context: Context;
    private snapshotManager: SnapshotManager;
    private syncManager: SyncManager;
    private toolHandlers: ToolHandlers;
    private graphToolHandlers: GraphToolHandlers;

    constructor(config: ContextMcpConfig) {
        // Initialize MCP server
        this.server = new Server(
            {
                name: config.name,
                version: config.version
            },
            {
                capabilities: {
                    tools: {}
                }
            }
        );

        // Initialize embedding provider
        console.log(`[EMBEDDING] Initializing embedding provider: ${config.embeddingProvider}`);
        console.log(`[EMBEDDING] Using model: ${config.embeddingModel}`);

        const embedding = createEmbeddingInstance(config);
        logEmbeddingProviderInfo(config, embedding);

        // Initialize vector database
        const vectorDatabase = new MilvusVectorDatabase({
            address: config.milvusAddress,
            ...(config.milvusToken && { token: config.milvusToken })
        });

        // Initialize Claude Context
        this.context = new Context({
            embedding,
            vectorDatabase,
            collectionNameOverride: config.collectionNameOverride
        });

        // Initialize managers
        this.snapshotManager = new SnapshotManager();
        this.syncManager = new SyncManager(this.context, this.snapshotManager);
        this.graphToolHandlers = new GraphToolHandlers();
        this.toolHandlers = new ToolHandlers(this.context, this.snapshotManager, this.graphToolHandlers);

        // Load existing codebase snapshot on startup
        this.snapshotManager.loadCodebaseSnapshot();

        this.setupTools();
    }

    private setupTools() {
        const index_description = `
Index a codebase to enable intelligent code search. One call handles both vector indexing (Milvus) and knowledge graph construction (SQLite). The codebase is identified by its git remote URL + branch name, so team members sharing the same repo+branch can reuse each other's indexes.

⚠️ **IMPORTANT**:
- The 'path' parameter accepts paths, relative paths, or "." for the IDE workspace.
- Before indexing, the system checks if the repository is already indexed. If already indexed, indexing is skipped unless force=true.

✨ **Usage**: Just call this once when starting work on a project. The system handles everything internally — vector search, code graph, call tracing — all automatically available.
`;

        const search_description = `
Search the indexed codebase using natural language. Returns code snippets enriched with graph context (related functions, classes, call relationships). The system automatically combines vector search and knowledge graph analysis internally.

✨ **Usage**: Just search with a natural language query. The system automatically chooses the best search strategy and enriches results with structural context.
`;

        this.server.setRequestHandler(ListToolsRequestSchema, async () => {
            return {
                tools: [
                    {
                        name: "index",
                        description: index_description,
                        inputSchema: {
                            type: "object",
                            properties: {
                                path: {
                                    type: "string",
                                    description: "Path to the codebase directory to index. Defaults to current workspace.",
                                },
                                force: {
                                    type: "boolean",
                                    description: "Force re-indexing even if already indexed",
                                    default: false,
                                },
                                splitter: {
                                    type: "string",
                                    description: "Code splitter: 'ast' (syntax-aware) or 'langchain' (character-based)",
                                    enum: ["ast", "langchain"],
                                    default: "ast",
                                },
                                customExtensions: {
                                    type: "array",
                                    items: { type: "string" },
                                    description: "Additional file extensions beyond defaults",
                                    default: [],
                                },
                                ignorePatterns: {
                                    type: "array",
                                    items: { type: "string" },
                                    description: "Additional ignore patterns beyond defaults",
                                    default: [],
                                },
                            },
                        },
                    },
                    {
                        name: "search",
                        description: search_description,
                        inputSchema: {
                            type: "object",
                            properties: {
                                path: {
                                    type: "string",
                                    description: "Codebase path to search in. Defaults to current workspace.",
                                },
                                query: {
                                    type: "string",
                                    description: "Natural language query",
                                },
                                limit: {
                                    type: "number",
                                    description: "Max results (default 10, max 50)",
                                    default: 10,
                                    maximum: 50,
                                },
                                extensionFilter: {
                                    type: "array",
                                    items: { type: "string" },
                                    description: "Filter by file extensions (e.g. ['.ts', '.py'])",
                                    default: [],
                                },
                            },
                            required: ["query"],
                        },
                    },
                    {
                        name: "clear",
                        description: "Clear all indexes (vector + graph) for a codebase.",
                        inputSchema: {
                            type: "object",
                            properties: {
                                path: {
                                    type: "string",
                                    description: "Codebase path to clear. Defaults to current workspace.",
                                },
                            },
                        },
                    },
                    {
                        name: "status",
                        description: "Get indexing status — vector index (Milvus) and graph index (SQLite) combined.",
                        inputSchema: {
                            type: "object",
                            properties: {
                                path: {
                                    type: "string",
                                    description: "Codebase path to check. Defaults to current workspace.",
                                },
                            },
                        },
                    },
                ],
            };
        });

        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const { name, arguments: args } = request.params;
            const safeArgs = args || {};

            switch (name) {
                case "index":
                case "index_codebase":
                    return await this.toolHandlers.handleIndex(args);
                case "search":
                case "search_code":
                    return await this.toolHandlers.handleSearchCode(args);
                case "clear":
                case "clear_index":
                    return await this.toolHandlers.handleClearIndex(args);
                case "status":
                case "get_indexing_status":
                    return await this.toolHandlers.handleStatus(args);

                default:
                    throw new Error(`Unknown tool: ${name}`);
            }
        });
    }

    // ── Fusion Search: Vector + Graph ───────────────────────────

    private async handleFusionSearch(args: Record<string, unknown>): Promise<{ content: Array<{ type: string; text: string }> }> {
        const query = args.query as string;
        const limit = (args.limit as number) || 10;
        const codebasePath = (args.path as string) || '.';
        const project = args.project as string;
        const extensionFilter = args.extension_filter as string[] | undefined;

        if (!query) {
            return { content: [{ type: 'text', text: 'Error: "query" is required.' }] };
        }

        const lines: string[] = [];
        lines.push(`# Fusion Search: "${query}"`);
        lines.push('');

        try {
            // ── Vector Search ─────────────────────────────────────
            let vectorResults: Array<{ content: string; relativePath: string; startLine: number; endLine: number; score: number }> = [];

            try {
                const absolutePath = codebasePath === '.' ? process.cwd() : codebasePath;
                const hasIndex = await this.context.hasIndex(absolutePath);
                if (hasIndex) {
                    vectorResults = await this.context.semanticSearch(absolutePath, query, Math.min(limit * 2, 20), 0.3);
                    console.log(`[Fusion] Vector search: ${vectorResults.length} results`);
                }
            } catch (e: any) {
                console.warn(`[Fusion] Vector search failed: ${e.message}`);
            }

            // ── Graph Search ──────────────────────────────────────
            let graphResults: Array<{ node: { name: string; qualifiedName: string; filePath: string; startLine: number; endLine: number; label: string }; score: number; inDegree: number; outDegree: number }> = [];

            if (project) {
                try {
                    const graphResp = this.graphToolHandlers.handleSearchGraph({
                        project,
                        query,
                        limit: limit * 2,
                    });
                    const text = graphResp.content[0]?.text || '';
                    // Parse graph search results from text output
                    const parsed = this.parseGraphSearchResults(text);
                    graphResults = parsed;
                    console.log(`[Fusion] Graph search: ${graphResults.length} results`);
                } catch (e: any) {
                    console.warn(`[Fusion] Graph search failed: ${e.message}`);
                }
            }

            // ── Merge and Rank ────────────────────────────────────
            type FusionResult = {
                type: 'vector' | 'graph' | 'both';
                filePath: string;
                name?: string;
                qualifiedName?: string;
                label?: string;
                content?: string;
                startLine: number;
                endLine: number;
                vectorScore: number;
                graphScore: number;
                combinedScore: number;
                inDegree?: number;
                outDegree?: number;
            };

            const merged = new Map<string, FusionResult>();

            // Normalize vector scores (0-1 already)
            const maxVecScore = vectorResults.length > 0 ? Math.max(...vectorResults.map(r => r.score)) : 1;
            for (const vr of vectorResults) {
                const key = `${vr.relativePath}:${vr.startLine}`;
                merged.set(key, {
                    type: 'vector',
                    filePath: vr.relativePath,
                    content: vr.content,
                    startLine: vr.startLine,
                    endLine: vr.endLine,
                    vectorScore: vr.score / maxVecScore,
                    graphScore: 0,
                    combinedScore: vr.score / maxVecScore * 0.6, // 60% weight for vector-only
                });
            }

            // Normalize graph scores
            const maxGraphScore = graphResults.length > 0 ? Math.max(...graphResults.map(r => r.score)) : 1;
            for (const gr of graphResults) {
                const key = `${gr.node.filePath}:${gr.node.startLine}`;
                const normScore = maxGraphScore > 0 ? gr.score / maxGraphScore : 0;

                if (merged.has(key)) {
                    // Both vector and graph found this result
                    const existing = merged.get(key)!;
                    existing.type = 'both';
                    existing.name = gr.node.name;
                    existing.qualifiedName = gr.node.qualifiedName;
                    existing.label = gr.node.label;
                    existing.graphScore = normScore;
                    existing.inDegree = gr.inDegree;
                    existing.outDegree = gr.outDegree;
                    // Boost: graph + vector both match
                    existing.combinedScore = existing.vectorScore * 0.4 + normScore * 0.6;
                } else {
                    merged.set(key, {
                        type: 'graph',
                        filePath: gr.node.filePath,
                        name: gr.node.name,
                        qualifiedName: gr.node.qualifiedName,
                        label: gr.node.label,
                        startLine: gr.node.startLine,
                        endLine: gr.node.endLine,
                        vectorScore: 0,
                        graphScore: normScore,
                        combinedScore: normScore * 0.5, // 50% weight for graph-only
                        inDegree: gr.inDegree,
                        outDegree: gr.outDegree,
                    });
                }
            }

            // Sort by combined score
            const sorted = Array.from(merged.values())
                .sort((a, b) => b.combinedScore - a.combinedScore)
                .slice(0, limit);

            // ── Output ─────────────────────────────────────────────
            lines.push(`Results (${sorted.length}):`);
            lines.push('');

            for (let i = 0; i < sorted.length; i++) {
                const r = sorted[i];
                const matchIcon = r.type === 'both' ? '⚡' : r.type === 'vector' ? '🔍' : '📊';
                lines.push(`## ${i + 1}. ${matchIcon} ${r.name || r.filePath} (score: ${r.combinedScore.toFixed(3)})`);

                if (r.name) {
                    lines.push(`   **${r.label || 'Symbol'}**: \`${r.name}\` ${r.qualifiedName ? `(${r.qualifiedName})` : ''}`);
                    lines.push(`   **File**: \`${r.filePath}:${r.startLine}-${r.endLine}\``);
                    if (r.inDegree !== undefined || r.outDegree !== undefined) {
                        lines.push(`   **Degree**: in=${r.inDegree ?? 0}, out=${r.outDegree ?? 0}`);
                    }
                } else {
                    lines.push(`   **File**: \`${r.filePath}:${r.startLine}-${r.endLine}\``);
                }

                if (r.content) {
                    const preview = r.content.length > 200 ? r.content.substring(0, 200) + '...' : r.content;
                    lines.push('   ```');
                    lines.push(`   ${preview.replace(/\n/g, '\n   ')}`);
                    lines.push('   ```');
                }

                lines.push('');
            }

            if (sorted.length === 0) {
                lines.push('No results found from either vector or graph search.');
            }

            lines.push(`---`);
            lines.push(`Vector: ${vectorResults.length} results | Graph: ${graphResults.length} results | Merged: ${sorted.length}`);

            return { content: [{ type: 'text', text: lines.join('\n') }] };
        } catch (error: any) {
            return { content: [{ type: 'text', text: `Fusion search error: ${error.message}` }] };
        }
    }

    private parseGraphSearchResults(text: string): Array<{ node: { name: string; qualifiedName: string; filePath: string; startLine: number; endLine: number; label: string }; score: number; inDegree: number; outDegree: number }> {
        const results: Array<{ node: { name: string; qualifiedName: string; filePath: string; startLine: number; endLine: number; label: string }; score: number; inDegree: number; outDegree: number }> = [];

        // Parse the text output format from handleSearchGraph:
        // - Function: main (project.main)
        //   File: src/main.ts:1-10
        //   Degree: in=0, out=1
        //   Score: 0.85
        const lines = text.split('\n');
        let current: { node: { name: string; qualifiedName: string; filePath: string; startLine: number; endLine: number; label: string }; score: number; inDegree: number; outDegree: number } | null = null;

        for (const line of lines) {
            const defMatch = line.match(/^-\s+(\w+):\s+(\S+)\s+\((\S+)\)/);
            if (defMatch) {
                if (current) results.push(current);
                current = {
                    node: {
                        label: defMatch[1],
                        name: defMatch[2],
                        qualifiedName: defMatch[3],
                        filePath: '',
                        startLine: 0,
                        endLine: 0,
                    },
                    score: 0,
                    inDegree: 0,
                    outDegree: 0,
                };
                continue;
            }

            if (current) {
                const fileMatch = line.match(/^\s+File:\s+(\S+):(\d+)-(\d+)/);
                if (fileMatch) {
                    current.node.filePath = fileMatch[1];
                    current.node.startLine = parseInt(fileMatch[2]);
                    current.node.endLine = parseInt(fileMatch[3]);
                }

                const degreeMatch = line.match(/^\s+Degree:\s+in=(\d+),\s+out=(\d+)/);
                if (degreeMatch) {
                    current.inDegree = parseInt(degreeMatch[1]);
                    current.outDegree = parseInt(degreeMatch[2]);
                }

                const scoreMatch = line.match(/^\s+Score:\s+([\d.]+)/);
                if (scoreMatch) {
                    current.score = parseFloat(scoreMatch[1]);
                }
            }
        }
        if (current) results.push(current);

        return results;
    }

    async start() {
        console.log('[SYNC-DEBUG] MCP server start() method called');
        console.log('Starting Context MCP server...');

        // One-shot startup healing for legacy 0/0+completed snapshot entries
        // left over from pre-fix MCP versions. Runs before the transport accepts
        // requests so clients never observe the poisoning state. See Issue #295.
        await this.toolHandlers.validateLegacyZeroEntries();

        const transport = new StdioServerTransport();
        console.log('[SYNC-DEBUG] StdioServerTransport created, attempting server connection...');

        await this.server.connect(transport);
        console.log("MCP server started and listening on stdio.");
        console.log('[SYNC-DEBUG] Server connection established successfully');

        // Start background sync after server is connected
        console.log('[SYNC-DEBUG] Initializing background sync...');
        this.syncManager.startBackgroundSync();
        console.log('[SYNC-DEBUG] MCP server initialization complete');
    }
}

// Main execution
async function main() {
    // Parse command line arguments
    const args = process.argv.slice(2);

    // Show help if requested
    if (args.includes('--help') || args.includes('-h')) {
        showHelpMessage();
        process.exit(0);
    }

    // Create configuration
    const config = createMcpConfig();
    logConfigurationSummary(config);

    const server = new ContextMcpServer(config);
    await server.start();
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.error("Received SIGINT, shutting down gracefully...");
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.error("Received SIGTERM, shutting down gracefully...");
    process.exit(0);
});

// Always start the server - this is designed to be the main entry point
main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
});
