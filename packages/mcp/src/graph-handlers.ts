/**
 * Graph MCP tool handlers. Extends claude-context with knowledge graph
 * capabilities: search_graph, trace_path, query_graph, get_code_snippet,
 * get_graph_schema, get_architecture, search_code, detect_changes,
 * list_projects, delete_project, index_status, manage_adr.
 */
import * as path from 'path';
import * as os from 'os';
import {
    SqliteGraphStore,
    GraphExtractor,
    CallTracer,
    GraphSearcher,
    ArchitectureAnalyzer,
    GraphNode,
    GraphSearchOptions,
    GraphSearchResponse,
    TraceOptions,
} from '@zilliz/claude-context-graph';
import { getRepoIdentity } from '@zilliz/claude-context-core';
import * as fs from 'fs';

export class GraphToolHandlers {
    private store: SqliteGraphStore;
    private extractor: GraphExtractor;
    private tracer: CallTracer;
    private searcher: GraphSearcher;
    private architecture: ArchitectureAnalyzer;

    constructor(dbPath?: string) {
        this.store = new SqliteGraphStore(dbPath);
        this.store.initialize();
        this.extractor = new GraphExtractor();
        this.tracer = new CallTracer(this.store);
        this.searcher = new GraphSearcher(this.store);
        this.architecture = new ArchitectureAnalyzer(this.store);
    }

    getStore(): SqliteGraphStore {
        return this.store;
    }

    close(): void {
        this.store.close();
    }

    // ── Tool: index_repository (graph-enhanced) ──────────────────

    async handleIndexRepository(args: Record<string, unknown>): Promise<{ content: Array<{ type: string; text: string }> }> {
        const repoPath = args.repo_path as string;
        const mode = (args.mode as string) || 'full';

        if (!repoPath || !fs.existsSync(repoPath)) {
            return { content: [{ type: 'text', text: `Error: Path '${repoPath}' does not exist.` }] };
        }

        const project = getRepoIdentity(repoPath);
        const startTime = Date.now();

        try {
            // Scan files
            const supportedExts = this.extractor.getSupportedLanguages()
                .flatMap((lang: string) => this.langToExts(lang));

            const files = this.scanFiles(repoPath, supportedExts);
            console.log(`[GraphIndex] Found ${files.length} files for project '${project}'`);

            let nodeCount = 0;
            let edgeCount = 0;

            this.store.beginTransaction();

            for (const filePath of files) {
                const ext = path.extname(filePath);
                const lang = GraphExtractor.extToLanguage(ext);
                if (!lang) continue;

                const relPath = path.relative(repoPath, filePath);
                const source = fs.readFileSync(filePath, 'utf-8');

                const result = this.extractor.extract(source, {
                    project,
                    filePath: relPath,
                    language: lang,
                });

                for (const node of result.nodes) {
                    this.store.upsertNode(node);
                    nodeCount++;
                }
                for (const edge of result.edges) {
                    this.store.upsertEdge(edge);
                    edgeCount++;
                }
            }

            this.store.commitTransaction();

            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            const stats = this.store.getProjectStats(project);

            return {
                content: [{
                    type: 'text',
                    text: `Indexed repository '${project}': ${stats.nodes} nodes, ${stats.edges} edges in ${elapsed}s`,
                }],
            };
        } catch (error: any) {
            this.store.rollbackTransaction();
            return {
                content: [{ type: 'text', text: `Error indexing repository: ${error.message}` }],
            };
        }
    }

    // ── Tool: search_graph ───────────────────────────────────────

    handleSearchGraph(args: Record<string, unknown>): { content: Array<{ type: string; text: string }> } {
        const project = args.project as string;
        const query = args.query as string | undefined;
        const label = args.label as string | undefined;
        const namePattern = args.name_pattern as string | undefined;
        const qnPattern = args.qn_pattern as string | undefined;
        const filePattern = args.file_pattern as string | undefined;
        const minDegree = args.min_degree as number | undefined;
        const maxDegree = args.max_degree as number | undefined;
        const limit = (args.limit as number) || 200;
        const offset = (args.offset as number) || 0;

        if (!project) {
            return { content: [{ type: 'text', text: 'Error: "project" is required.' }] };
        }

        const options: GraphSearchOptions = {
            project,
            query,
            label: label as any,
            namePattern,
            qnPattern,
            filePattern,
            minDegree,
            maxDegree,
            limit,
            offset,
        };

        const result = this.searcher.searchGraph(options);

        const lines: string[] = [];
        lines.push(`Found ${result.total} results${result.hasMore ? ' (more available)' : ''}:`);
        lines.push('');

        for (const r of result.results) {
            lines.push(`- ${r.node.label}: ${r.node.name} (${r.node.qualifiedName})`);
            lines.push(`  File: ${r.node.filePath}:${r.node.startLine}-${r.node.endLine}`);
            lines.push(`  Degree: in=${r.inDegree}, out=${r.outDegree}`);
            if (r.score > 0) lines.push(`  Score: ${r.score.toFixed(2)}`);
            lines.push('');
        }

        return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    // ── Tool: trace_path ─────────────────────────────────────────

    handleTracePath(args: Record<string, unknown>): { content: Array<{ type: string; text: string }> } {
        const project = args.project as string;
        const functionName = args.function_name as string;
        const direction = (args.direction as string) || 'both';
        const depth = (args.depth as number) || 3;
        const mode = (args.mode as string) || 'calls';
        const includeTests = (args.include_tests as boolean) || false;

        if (!project || !functionName) {
            return { content: [{ type: 'text', text: 'Error: "project" and "function_name" are required.' }] };
        }

        try {
            const result = this.tracer.trace({
                project,
                functionName,
                direction: direction as TraceOptions['direction'],
                depth,
                mode: mode as TraceOptions['mode'],
                includeTests,
            });

            const lines: string[] = [];
            lines.push(`Trace for: ${result.root.name} (${result.root.qualifiedName})`);
            lines.push(`File: ${result.root.filePath}:${result.root.startLine}-${result.root.endLine}`);
            lines.push('');

            if (result.callers.length > 0) {
                lines.push(`Callers (${result.callers.length}):`);
                for (const c of result.callers) {
                    lines.push(`  [depth=${c.depth}] ${c.node.name} (${c.node.qualifiedName})`);
                    lines.push(`    ${c.node.filePath}:${c.node.startLine} (${c.edgeType})`);
                }
                lines.push('');
            }

            if (result.callees.length > 0) {
                lines.push(`Callees (${result.callees.length}):`);
                for (const c of result.callees) {
                    lines.push(`  [depth=${c.depth}] ${c.node.name} (${c.node.qualifiedName})`);
                    lines.push(`    ${c.node.filePath}:${c.node.startLine} (${c.edgeType})`);
                }
                lines.push('');
            }

            return { content: [{ type: 'text', text: lines.join('\n') }] };
        } catch (error: any) {
            return { content: [{ type: 'text', text: `Error tracing path: ${error.message}` }] };
        }
    }

    // ── Tool: get_code_snippet ───────────────────────────────────

    handleGetCodeSnippet(args: Record<string, unknown>): { content: Array<{ type: string; text: string }> } {
        const project = args.project as string;
        const qualifiedName = args.qualified_name as string;
        const includeNeighbors = (args.include_neighbors as boolean) || false;

        if (!project || !qualifiedName) {
            return { content: [{ type: 'text', text: 'Error: "project" and "qualified_name" are required.' }] };
        }

        const result = this.searcher.getCodeSnippet(project, qualifiedName, includeNeighbors);
        if (!result) {
            return { content: [{ type: 'text', text: `Node not found: ${qualifiedName}` }] };
        }

        const lines: string[] = [];
        lines.push(`${result.node.label}: ${result.node.name}`);
        lines.push(`File: ${result.node.filePath}:${result.node.startLine}-${result.node.endLine}`);
        lines.push('```');
        lines.push(result.source);
        lines.push('```');

        if (result.callers && result.callers.length > 0) {
            lines.push(`\nCallers (${result.callers.length}):`);
            for (const c of result.callers) lines.push(`  - ${c}`);
        }
        if (result.callees && result.callees.length > 0) {
            lines.push(`\nCallees (${result.callees.length}):`);
            for (const c of result.callees) lines.push(`  - ${c}`);
        }

        return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    // ── Tool: get_graph_schema ───────────────────────────────────

    handleGetGraphSchema(args: Record<string, unknown>): { content: Array<{ type: string; text: string }> } {
        const project = args.project as string;
        if (!project) {
            return { content: [{ type: 'text', text: 'Error: "project" is required.' }] };
        }

        const schema = this.store.getSchema();
        const stats = this.store.getProjectStats(project);

        const lines: string[] = [];
        lines.push(`Graph Schema for project '${project}':`);
        lines.push(`Total nodes: ${stats.nodes}, Total edges: ${stats.edges}`);
        lines.push('');
        lines.push(`Node labels (${schema.nodeLabels.length}):`);
        for (const l of schema.nodeLabels) lines.push(`  - ${l}`);
        lines.push('');
        lines.push(`Edge types (${schema.edgeTypes.length}):`);
        for (const t of schema.edgeTypes) lines.push(`  - ${t}`);

        return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    // ── Tool: get_architecture ───────────────────────────────────

    handleGetArchitecture(args: Record<string, unknown>): { content: Array<{ type: string; text: string }> } {
        const project = args.project as string;
        const pathFilter = args.path as string | undefined;

        if (!project) {
            return { content: [{ type: 'text', text: 'Error: "project" is required.' }] };
        }

        const arch = this.architecture.getArchitecture(project, pathFilter);

        const lines: string[] = [];
        lines.push(`Architecture: ${arch.project}`);
        lines.push(`Nodes: ${arch.totalNodes}, Edges: ${arch.totalEdges}`);
        lines.push('');

        lines.push('Node types:');
        for (const [type, count] of Object.entries(arch.nodeTypes)) {
            lines.push(`  ${type}: ${count}`);
        }
        lines.push('');

        if (arch.entryPoints.length > 0) {
            lines.push(`Entry points (${arch.entryPoints.length}):`);
            for (const ep of arch.entryPoints) {
                lines.push(`  - ${ep.name} (${ep.qualifiedName})`);
            }
            lines.push('');
        }

        if (arch.clusters.length > 0) {
            lines.push(`Clusters (${arch.clusters.length}):`);
            for (const c of arch.clusters.slice(0, 10)) {
                lines.push(`  ${c.label}: ${c.memberCount} nodes, cohesion=${c.cohesionScore.toFixed(2)}`);
            }
        }

        return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    // ── Tool: search_code (graph-enhanced) ───────────────────────

    handleSearchCode(args: Record<string, unknown>): { content: Array<{ type: string; text: string }> } {
        const project = args.project as string;
        const pattern = args.pattern as string;
        const filePattern = args.file_pattern as string | undefined;
        const pathFilter = args.path_filter as string | undefined;
        const mode = (args.mode as string) || 'compact';
        const context = args.context as number | undefined;
        const regex = (args.regex as boolean) || false;
        const limit = (args.limit as number) || 10;

        if (!project || !pattern) {
            return { content: [{ type: 'text', text: 'Error: "project" and "pattern" are required.' }] };
        }

        const result = this.searcher.searchCode({
            project,
            pattern,
            filePattern,
            pathFilter,
            mode: mode as any,
            context,
            regex,
            limit,
        });

        const lines: string[] = [];
        lines.push(`Graph-enhanced search: "${pattern}"`);
        lines.push(`Total grep matches: ${result.totalGrepMatches}, Enriched results: ${result.totalResults}`);
        lines.push('');

        for (const r of result.results) {
            lines.push(`- ${r.node.label}: ${r.node.name}`);
            lines.push(`  File: ${r.node.filePath}:${r.matchLine}`);
            lines.push(`  ${r.snippet}`);
            lines.push('');
        }

        return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    // ── Tool: detect_changes ─────────────────────────────────────

    handleDetectChanges(args: Record<string, unknown>): { content: Array<{ type: string; text: string }> } {
        const project = args.project as string;
        if (!project) {
            return { content: [{ type: 'text', text: 'Error: "project" is required.' }] };
        }

        const lines: string[] = [];
        lines.push(`Change detection for project '${project}':`);
        lines.push('Note: Full git diff analysis requires the repository to be available locally.');
        lines.push('Currently showing graph statistics as baseline.');
        lines.push('');

        const stats = this.store.getProjectStats(project);
        lines.push(`Current state: ${stats.nodes} nodes, ${stats.edges} edges`);
        lines.push('Use index_repository to update the graph after changes.');

        return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    // ── Tool: list_projects ──────────────────────────────────────

    handleListProjects(): { content: Array<{ type: string; text: string }> } {
        const projects = this.store.listProjects();
        const lines: string[] = [];

        if (projects.length === 0) {
            lines.push('No indexed projects found.');
        } else {
            lines.push(`Indexed projects (${projects.length}):`);
            for (const p of projects) {
                const stats = this.store.getProjectStats(p);
                lines.push(`  - ${p}: ${stats.nodes} nodes, ${stats.edges} edges`);
            }
        }

        return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    // ── Tool: delete_project ─────────────────────────────────────

    handleDeleteProject(args: Record<string, unknown>): { content: Array<{ type: string; text: string }> } {
        const project = args.project as string;
        if (!project) {
            return { content: [{ type: 'text', text: 'Error: "project" is required.' }] };
        }

        this.store.deleteProject(project);
        return { content: [{ type: 'text', text: `Project '${project}' deleted.` }] };
    }

    // ── Tool: index_status ───────────────────────────────────────

    handleIndexStatus(args: Record<string, unknown>): { content: Array<{ type: string; text: string }> } {
        const project = args.project as string;
        if (!project) {
            return { content: [{ type: 'text', text: 'Error: "project" is required.' }] };
        }

        const stats = this.store.getProjectStats(project);
        const schema = this.store.getSchema();

        const lines: string[] = [];
        lines.push(`Index status for '${project}':`);
        lines.push(`  Nodes: ${stats.nodes}`);
        lines.push(`  Edges: ${stats.edges}`);
        lines.push(`  Node labels: ${schema.nodeLabels.join(', ') || 'none'}`);
        lines.push(`  Edge types: ${schema.edgeTypes.join(', ') || 'none'}`);

        return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    // ── Helpers ──────────────────────────────────────────────────

    private langToExts(lang: string): string[] {
        const map: Record<string, string[]> = {
            javascript: ['.js', '.jsx', '.mjs'],
            typescript: ['.ts', '.tsx'],
            python: ['.py'],
            java: ['.java'],
            cpp: ['.cpp', '.c', '.h', '.hpp', '.cc'],
            go: ['.go'],
            rust: ['.rs'],
            csharp: ['.cs'],
        };
        return map[lang] || [];
    }

    private scanFiles(dir: string, extensions: string[]): string[] {
        const results: string[] = [];
        const extSet = new Set(extensions);
        const ignoreSet = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__']);

        function walk(current: string) {
            const entries = fs.readdirSync(current, { withFileTypes: true });
            for (const entry of entries) {
                if (ignoreSet.has(entry.name)) continue;
                const fullPath = path.join(current, entry.name);
                if (entry.isDirectory()) {
                    walk(fullPath);
                } else if (entry.isFile() && extSet.has(path.extname(entry.name))) {
                    results.push(fullPath);
                }
            }
        }

        walk(dir);
        return results;
    }
}