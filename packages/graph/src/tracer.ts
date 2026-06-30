/**
 * Call chain tracer. Traces call paths through the knowledge graph
 * using BFS/DFS traversal on CALLS edges.
 */
import { GraphStore, GraphNode, GraphEdge, GraphEdgeType, TraceOptions, TraceResult, TraceNode } from './types';

export class CallTracer {
    private store: GraphStore;

    constructor(store: GraphStore) {
        this.store = store;
    }

    /**
     * Trace call paths from a function node.
     */
    trace(options: TraceOptions): TraceResult {
        const { project, functionName, direction = 'both', depth = 3, mode = 'calls', includeTests = false } = options;

        // Find the root node
        const searchResult = this.store.findNodes({
            project,
            namePattern: functionName,
            limit: 1,
        });

        if (searchResult.results.length === 0) {
            // Try qualified name search
            const qnResult = this.store.findNodes({
                project,
                qnPattern: functionName,
                limit: 1,
            });
            if (qnResult.results.length === 0) {
                throw new Error(`Function not found: ${functionName}`);
            }
            return this.traceFromNode(qnResult.results[0].node, direction, depth, mode, includeTests, options.edgeTypes);
        }

        return this.traceFromNode(searchResult.results[0].node, direction, depth, mode, includeTests, options.edgeTypes);
    }

    private traceFromNode(
        root: GraphNode,
        direction: string,
        maxDepth: number,
        mode: string,
        includeTests: boolean,
        edgeTypes?: GraphEdgeType[],
    ): TraceResult {
        const callers: TraceNode[] = [];
        const callees: TraceNode[] = [];
        const visited = new Set<number>();

        const defaultEdgeTypes: GraphEdgeType[] = edgeTypes || this.getEdgeTypesForMode(mode);

        if (direction === 'inbound' || direction === 'both') {
            this.bfsTrace(root, 'inbound', maxDepth, defaultEdgeTypes, callers, visited, includeTests);
        }

        if (direction === 'outbound' || direction === 'both') {
            this.bfsTrace(root, 'outbound', maxDepth, defaultEdgeTypes, callees, visited, includeTests);
        }

        return {
            root,
            callers,
            callees,
            paths: [], // Full paths can be added later
        };
    }

    private bfsTrace(
        startNode: GraphNode,
        direction: 'inbound' | 'outbound',
        maxDepth: number,
        edgeTypes: GraphEdgeType[],
        results: TraceNode[],
        visited: Set<number>,
        includeTests: boolean,
    ): void {
        interface QueueItem {
            nodeId: number;
            depth: number;
            edgeType: GraphEdgeType;
        }

        const queue: QueueItem[] = [{ nodeId: startNode.id, depth: 0, edgeType: 'CALLS' }];
        let head = 0;
        visited.add(startNode.id);

        while (head < queue.length) {
            const current = queue[head++];
            if (current.depth >= maxDepth) continue;

            const edges = direction === 'outbound'
                ? this.store.getEdgesBySource(current.nodeId)
                : this.store.getEdgesByTarget(current.nodeId);

            for (const edge of edges) {
                if (!edgeTypes.includes(edge.type)) continue;

                const neighborId = direction === 'outbound' ? edge.targetId : edge.sourceId;
                if (visited.has(neighborId)) continue;

                const neighbor = this.store.getNodeById(neighborId);
                if (!neighbor) continue;

                const isTest = neighbor.filePath.includes('test') || neighbor.filePath.includes('spec') || neighbor.filePath.includes('__tests__');
                if (isTest && !includeTests) continue;

                visited.add(neighborId);
                results.push({
                    node: neighbor,
                    depth: current.depth + 1,
                    edgeType: edge.type,
                    isTest,
                });

                queue.push({
                    nodeId: neighborId,
                    depth: current.depth + 1,
                    edgeType: edge.type,
                });
            }
        }
    }

    private getEdgeTypesForMode(mode: string): GraphEdgeType[] {
        switch (mode) {
            case 'calls':
                return ['CALLS'];
            case 'data_flow':
                return ['CALLS', 'DATA_FLOWS'];
            case 'cross_service':
                return ['CALLS', 'HTTP_CALLS', 'ASYNC_CALLS', 'CROSS_HTTP_CALLS', 'CROSS_ASYNC_CALLS', 'CROSS_CHANNEL'];
            default:
                return ['CALLS'];
        }
    }
}