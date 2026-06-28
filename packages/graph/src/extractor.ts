/**
 * AST-based graph extractor. Uses tree-sitter to extract structured
 * code information: functions, classes, methods, imports, and calls.
 */
import Parser from 'tree-sitter';
import { GraphNode, GraphNodeLabel, GraphEdge, GraphEdgeType } from './types';

// Language parsers (reuse existing tree-sitter grammars from core package)
const JavaScript = require('tree-sitter-javascript');
const TypeScript = require('tree-sitter-typescript').typescript;
const Python = require('tree-sitter-python');
const Java = require('tree-sitter-java');
const Cpp = require('tree-sitter-cpp');
const Go = require('tree-sitter-go');
const Rust = require('tree-sitter-rust');
const CSharp = require('tree-sitter-c-sharp');

// ── Language configuration ─────────────────────────────────────────

interface LanguageConfig {
    parser: any; // tree-sitter Language (v0.21.x doesn't export Language type)
    nodeTypes: Record<string, GraphNodeLabel>;
    importNodeTypes: string[];
    callNodeTypes: string[];
}

const LANGUAGE_CONFIGS: Record<string, LanguageConfig> = {
    javascript: {
        parser: JavaScript,
        nodeTypes: {
            function_declaration: 'Function',
            arrow_function: 'Function',
            class_declaration: 'Class',
            method_definition: 'Method',
            variable_declarator: 'Variable',
        },
        importNodeTypes: ['import_statement', 'require_call_expression'],
        callNodeTypes: ['call_expression', 'new_expression'],
    },
    typescript: {
        parser: TypeScript,
        nodeTypes: {
            function_declaration: 'Function',
            arrow_function: 'Function',
            class_declaration: 'Class',
            method_definition: 'Method',
            interface_declaration: 'Interface',
            type_alias_declaration: 'Interface',
            variable_declarator: 'Variable',
        },
        importNodeTypes: ['import_statement'],
        callNodeTypes: ['call_expression', 'new_expression'],
    },
    python: {
        parser: Python,
        nodeTypes: {
            function_definition: 'Function',
            class_definition: 'Class',
            decorated_definition: 'Function',
            async_function_definition: 'Function',
        },
        importNodeTypes: ['import_statement', 'import_from_statement'],
        callNodeTypes: ['call'],
    },
    java: {
        parser: Java,
        nodeTypes: {
            method_declaration: 'Method',
            class_declaration: 'Class',
            interface_declaration: 'Interface',
            constructor_declaration: 'Method',
            field_declaration: 'Variable',
        },
        importNodeTypes: ['import_declaration'],
        callNodeTypes: ['method_invocation', 'object_creation_expression'],
    },
    cpp: {
        parser: Cpp,
        nodeTypes: {
            function_definition: 'Function',
            class_specifier: 'Class',
            struct_specifier: 'Struct',
            namespace_definition: 'Module',
            declaration: 'Variable',
        },
        importNodeTypes: ['preproc_include'],
        callNodeTypes: ['call_expression'],
    },
    go: {
        parser: Go,
        nodeTypes: {
            function_declaration: 'Function',
            method_declaration: 'Method',
            type_declaration: 'Class',
            var_declaration: 'Variable',
            const_declaration: 'Variable',
        },
        importNodeTypes: ['import_declaration'],
        callNodeTypes: ['call_expression'],
    },
    rust: {
        parser: Rust,
        nodeTypes: {
            function_item: 'Function',
            impl_item: 'Class',
            struct_item: 'Struct',
            enum_item: 'Enum',
            trait_item: 'Interface',
            mod_item: 'Module',
            let_declaration: 'Variable',
        },
        importNodeTypes: ['use_declaration'],
        callNodeTypes: ['call_expression'],
    },
    csharp: {
        parser: CSharp,
        nodeTypes: {
            method_declaration: 'Method',
            class_declaration: 'Class',
            interface_declaration: 'Interface',
            struct_declaration: 'Struct',
            enum_declaration: 'Enum',
            constructor_declaration: 'Method',
        },
        importNodeTypes: ['using_directive'],
        callNodeTypes: ['invocation_expression', 'object_creation_expression'],
    },
};

// ── Extraction result ──────────────────────────────────────────────

export interface ExtractionResult {
    nodes: Omit<GraphNode, 'id'>[];
    edges: Omit<GraphEdge, 'id'>[];
}

export interface ExtractionContext {
    project: string;
    filePath: string;
    language: string;
}

// ── Extractor class ────────────────────────────────────────────────

export class GraphExtractor {
    private parser: Parser;

    constructor() {
        this.parser = new Parser();
    }

    /**
     * Extract graph nodes and edges from source code.
     */
    extract(source: string, ctx: ExtractionContext): ExtractionResult {
        const config = this.getLanguageConfig(ctx.language);
        if (!config) {
            return { nodes: [], edges: [] };
        }

        try {
            this.parser.setLanguage(config.parser);
            const tree = this.parser.parse(source);
            const result = this.extractFromTree(tree.rootNode, source, ctx, config);
            return result;
        } catch (error) {
            console.warn(`[GraphExtractor] Failed to parse ${ctx.filePath}:`, error);
            return { nodes: [], edges: [] };
        }
    }

    /**
     * Check if a language is supported by the graph extractor.
     */
    isLanguageSupported(language: string): boolean {
        return language in LANGUAGE_CONFIGS;
    }

    /**
     * Get supported languages.
     */
    getSupportedLanguages(): string[] {
        return Object.keys(LANGUAGE_CONFIGS);
    }

    /**
     * Map file extension to language for the extractor.
     */
    static extToLanguage(ext: string): string {
        const map: Record<string, string> = {
            '.js': 'javascript', '.jsx': 'javascript',
            '.ts': 'typescript', '.tsx': 'typescript',
            '.py': 'python',
            '.java': 'java',
            '.cpp': 'cpp', '.c': 'cpp', '.h': 'cpp', '.hpp': 'cpp', '.cc': 'cpp',
            '.go': 'go',
            '.rs': 'rust',
            '.cs': 'csharp',
        };
        return map[ext] || '';
    }

    // ── Private methods ──────────────────────────────────────────

    private getLanguageConfig(language: string): LanguageConfig | null {
        return LANGUAGE_CONFIGS[language] || null;
    }

    private extractFromTree(
        node: Parser.SyntaxNode,
        source: string,
        ctx: ExtractionContext,
        config: LanguageConfig,
    ): ExtractionResult {
        const nodes: Omit<GraphNode, 'id'>[] = [];
        const edges: Omit<GraphEdge, 'id'>[] = [];

        // Track definitions for call resolution
        const defNames = new Map<string, number>(); // name → temp index

        // Recursively traverse the AST
        this.traverseNode(node, source, ctx, config, nodes, edges, defNames);

        return { nodes, edges };
    }

    private traverseNode(
        node: Parser.SyntaxNode,
        source: string,
        ctx: ExtractionContext,
        config: LanguageConfig,
        nodes: Omit<GraphNode, 'id'>[],
        edges: Omit<GraphEdge, 'id'>[],
        defNames: Map<string, number>,
    ): void {
        // Check if this node is a definition
        const label = config.nodeTypes[node.type];
        if (label) {
            const name = this.extractName(node, source, node.type);
            if (name) {
                const startLine = node.startPosition.row + 1;
                const endLine = node.endPosition.row + 1;
                const qualifiedName = `${ctx.project}.${ctx.filePath.replace(/\//g, '.').replace(/\.[^.]+$/, '')}.${name}`;

                const nodeIndex = nodes.length;
                defNames.set(name, nodeIndex);

                nodes.push({
                    project: ctx.project,
                    label,
                    name,
                    qualifiedName,
                    filePath: ctx.filePath,
                    startLine,
                    endLine,
                    properties: {
                        language: ctx.language,
                        nodeType: node.type,
                    },
                });
            }
        }

        // Check if this is a call expression
        if (config.callNodeTypes.includes(node.type)) {
            const callName = this.extractCallName(node, source);
            if (callName && defNames.has(callName)) {
                const targetIdx = defNames.get(callName)!;
                // We'll resolve edges after all nodes are collected
            }
        }

        // Check for imports
        if (config.importNodeTypes.includes(node.type)) {
            const importPath = this.extractImportPath(node, source, ctx.language);
            if (importPath) {
                const moduleQN = `${ctx.project}.${this.normalizeImportPath(importPath, ctx.filePath)}`;
                const moduleName = importPath.split('/').pop() || importPath;
                const nodeIndex = nodes.length;
                nodes.push({
                    project: ctx.project,
                    label: 'Module',
                    name: moduleName,
                    qualifiedName: moduleQN,
                    filePath: ctx.filePath,
                    startLine: node.startPosition.row + 1,
                    endLine: node.endPosition.row + 1,
                    properties: { importPath },
                });
            }
        }

        // Recurse into children
        for (let i = 0; i < node.childCount; i++) {
            this.traverseNode(node.child(i)!, source, ctx, config, nodes, edges, defNames);
        }
    }

    private extractName(node: Parser.SyntaxNode, source: string, nodeType: string): string | null {
        // Find the name/identifier child node
        const nameChild = node.childForFieldName?.('name')
            ?? this.findChildByType(node, 'identifier', 'property_identifier', 'type_identifier');
        if (nameChild) {
            return source.slice(nameChild.startIndex, nameChild.endIndex);
        }
        return null;
    }

    private extractCallName(node: Parser.SyntaxNode, source: string): string | null {
        const funcChild = node.childForFieldName?.('function')
            ?? this.findChildByType(node, 'identifier', 'member_expression');
        if (funcChild) {
            return source.slice(funcChild.startIndex, funcChild.endIndex);
        }
        return null;
    }

    private extractImportPath(node: Parser.SyntaxNode, source: string, language: string): string | null {
        // Find the string literal containing the import path
        const stringChild = this.findChildByType(node, 'string', 'string_fragment');
        if (stringChild) {
            const raw = source.slice(stringChild.startIndex, stringChild.endIndex);
            return raw.replace(/^['"]|['"]$/g, '');
        }
        return null;
    }

    private findChildByType(node: Parser.SyntaxNode, ...types: string[]): Parser.SyntaxNode | null {
        for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i)!;
            if (types.includes(child.type)) {
                return child;
            }
            const found = this.findChildByType(child, ...types);
            if (found) return found;
        }
        return null;
    }

    private normalizeImportPath(importPath: string, currentFile: string): string {
        if (importPath.startsWith('.')) {
            const dir = currentFile.substring(0, currentFile.lastIndexOf('/'));
            return (dir ? dir + '/' : '') + importPath.replace(/^\.\//, '');
        }
        return importPath;
    }
}