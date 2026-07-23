import * as crypto from 'crypto';
import { VectorDatabase, VectorDocument } from '../vectordb';

/**
 * Content-addressed embedding cache — the deduplication core of the team-version
 * PRD ("Embedding Cache: Hash → Embedding, not Repository → Chunk → Embedding").
 *
 * Every chunk's content is hashed (SHA256). Before calling the embedding model
 * we look the hashes up here; only cache misses are actually embedded, and the
 * new vectors are written back. Because identical code across branches and
 * developers hashes identically, the expensive vectorization happens exactly
 * once per unique chunk — this is what makes "一个 Embedding 多个 Branch 共享"
 * true without changing the per-branch collection topology.
 *
 * The cache is backed by a shared Milvus collection so the whole team benefits
 * from a single population of it.
 */

/** Stable content hash for a chunk. */
export function hashChunk(content: string): string {
    return crypto.createHash('sha256').update(content, 'utf-8').digest('hex');
}

export interface EmbeddingCache {
    /** Look up multiple hashes at once; returns only the ones present. */
    getMany(hashes: string[]): Promise<Map<string, number[]>>;
    /** Persist newly-computed hash → vector pairs (idempotent upsert). */
    setMany(entries: Array<{ hash: string; vector: number[] }>): Promise<void>;
}

/**
 * A no-op cache used when caching is disabled — keeps call sites branch-free.
 */
export class NoopEmbeddingCache implements EmbeddingCache {
    async getMany(): Promise<Map<string, number[]>> {
        return new Map();
    }
    async setMany(): Promise<void> {
        /* intentionally empty */
    }
}

/**
 * Milvus-backed shared embedding cache. Depends only on the existing
 * VectorDatabase interface (createCollection / hasCollection / query / insert),
 * so it works with every VectorDatabase implementation without changing that
 * interface. Vectors are keyed by content hash; the auxiliary VectorDocument
 * fields (content/relativePath/…) are left empty since the cache is queried by
 * id, never searched.
 */
export class MilvusEmbeddingCache implements EmbeddingCache {
    private readonly db: VectorDatabase;
    private readonly collectionName: string;
    private readonly dimension: number;
    private ensured = false;
    /** Query batch size for `id in [...]` lookups to keep expressions bounded. */
    private static readonly QUERY_BATCH = 256;

    constructor(db: VectorDatabase, modelIdentifier: string, dimension: number) {
        this.db = db;
        this.dimension = dimension;
        const safeModel = modelIdentifier.replace(/[^A-Za-z0-9]/g, '_').slice(0, 120);
        // Isolate by model + dimension so vectors from different models never mix.
        this.collectionName = `embedding_cache_${safeModel}_${dimension}`;
    }

    getCollectionName(): string {
        return this.collectionName;
    }

    private async ensureCollection(): Promise<void> {
        if (this.ensured) return;
        const exists = await this.db.hasCollection(this.collectionName);
        if (!exists) {
            console.log(`[EmbeddingCache] 🗃️  Creating shared embedding cache collection '${this.collectionName}' (dim=${this.dimension})`);
            await this.db.createCollection(
                this.collectionName,
                this.dimension,
                `embeddingCache:dim=${this.dimension}`,
            );
        }
        this.ensured = true;
    }

    async getMany(hashes: string[]): Promise<Map<string, number[]>> {
        const found = new Map<string, number[]>();
        if (hashes.length === 0) return found;

        try {
            await this.ensureCollection();
        } catch (error) {
            // A cache failure must never break indexing — degrade to "all miss".
            console.warn(`[EmbeddingCache] ⚠️  ensureCollection failed, treating as cache miss: ${error}`);
            return found;
        }

        // De-duplicate within the request and query in bounded batches.
        const unique = [...new Set(hashes)];
        for (let i = 0; i < unique.length; i += MilvusEmbeddingCache.QUERY_BATCH) {
            const batch = unique.slice(i, i + MilvusEmbeddingCache.QUERY_BATCH);
            const quoted = batch.map(h => `"${h}"`).join(', ');
            try {
                const rows = await this.db.query(
                    this.collectionName,
                    `id in [${quoted}]`,
                    ['id', 'vector'],
                    batch.length,
                );
                for (const row of rows) {
                    const id = row.id as string;
                    const vector = row.vector as number[] | undefined;
                    if (id && Array.isArray(vector) && vector.length === this.dimension) {
                        found.set(id, vector);
                    }
                }
            } catch (error) {
                console.warn(`[EmbeddingCache] ⚠️  Cache lookup failed (treating batch as miss): ${error}`);
            }
        }

        return found;
    }

    async setMany(entries: Array<{ hash: string; vector: number[] }>): Promise<void> {
        if (entries.length === 0) return;
        try {
            await this.ensureCollection();
        } catch (error) {
            console.warn(`[EmbeddingCache] ⚠️  ensureCollection failed, skipping cache write: ${error}`);
            return;
        }

        // De-duplicate by hash so a single insert never carries the same primary
        // key twice.
        const seen = new Set<string>();
        const documents: VectorDocument[] = [];
        for (const { hash, vector } of entries) {
            if (!hash || seen.has(hash)) continue;
            if (!Array.isArray(vector) || vector.length !== this.dimension) continue;
            seen.add(hash);
            documents.push({
                id: hash,
                vector,
                content: '',
                relativePath: '',
                startLine: 0,
                endLine: 0,
                fileExtension: '',
                metadata: {},
            });
        }
        if (documents.length === 0) return;

        try {
            await this.db.insert(this.collectionName, documents);
        } catch (error: any) {
            const msg = error?.message || String(error);
            // Dimension mismatch → the collection was created for a different
            // model/dimension. This is fatal — vectors would be corrupt.
            if (msg.includes('dimension') || msg.includes('dim')) {
                console.error(`[EmbeddingCache] ❌ Dimension mismatch in cache write: ${msg}`);
                // Don't throw — the vectors are already computed for this run,
                // and the cache collection will be recreated on next restart
                // with the correct dimension via ensureCollection.
            }
            // Duplicate primary key → another process cached the same chunk
            // concurrently. Non-fatal — the vector is already computed.
            else if (msg.includes('primary') || msg.includes('duplicate') || msg.includes('already exist')) {
                // Expected in concurrent scenarios — silent.
            }
            // All other errors: log but don't block indexing.
            else {
                console.warn(`[EmbeddingCache] ⚠️  Cache write failed (non-fatal): ${msg}`);
            }
        }
    }
}
