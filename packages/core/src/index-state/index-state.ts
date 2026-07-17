import * as crypto from 'crypto';
import { VectorDatabase, VectorDocument } from '../vectordb';

/**
 * Commit-level index state — the "Commit as the basic unit of indexing" record
 * from the team-version PRD. For each repository identity (url:branch) it stores
 * the commit the shared vector index is currently up-to-date at, so any team
 * member can compute `git diff <storedCommit> HEAD` and index only the delta
 * instead of rescanning the whole repository.
 *
 * Backed by a single shared Milvus collection so the state is team-wide, using
 * only the existing VectorDatabase primitives (no interface changes). The
 * collection carries a throwaway 1-dim vector purely to satisfy Milvus' schema
 * requirement; the real payload is a JSON blob in the `content` field.
 */

export interface CommitState {
    identity: string;
    headCommit: string;
    dimension: number;
    updatedAt: number;
    // Git-DAG layering: the parent branch identity this branch's index is a delta
    // against (null/absent → this branch is a root and stores a full index), plus
    // the files this branch changed relative to that base (used to mask the base
    // layer at query time).
    repoUrl?: string;
    // Search base = the repository ROOT branch (main). Every branch composes its
    // index as `root ⊕ own-diff`, so search only ever touches these two layers.
    baseIdentity?: string | null;
    // Tree lineage = the immediate ancestor branch this one was cut from (e.g. C's
    // parent is B even though its search base is main). Display/tracking only.
    parentIdentity?: string | null;
    // Files this branch changed relative to the root (main), used to mask the root
    // layer at query time.
    overridePaths?: string[];
    // The Milvus collection holding this branch's chunks. Stored so the index-tree UI
    // can map a branch to its collection (row counts) without recomputing the hash.
    collectionName?: string;
}

export interface SetStateOptions {
    repoUrl?: string;
    baseIdentity?: string | null;
    parentIdentity?: string | null;
    overridePaths?: string[];
    collectionName?: string;
}

export class CommitIndexState {
    private readonly db: VectorDatabase;
    private static readonly COLLECTION = 'code_index_state';
    // Milvus requires a vector dimension in [2, 32768]; the state collection only
    // needs a throwaway vector to satisfy the schema, so use the minimum valid dim.
    private static readonly DUMMY_DIM = 2;
    private ensured = false;

    constructor(db: VectorDatabase) {
        this.db = db;
    }

    /** Render an unknown error (Milvus SDK often throws plain objects) as text. */
    private fmt(error: unknown): string {
        if (error instanceof Error) return error.message;
        try { return JSON.stringify(error); } catch { return String(error); }
    }

    /** Fixed-length primary key derived from the (variable-length) identity. */
    private idFor(identity: string): string {
        return crypto.createHash('md5').update(identity).digest('hex');
    }

    private async ensureCollection(): Promise<void> {
        if (this.ensured) return;
        const exists = await this.db.hasCollection(CommitIndexState.COLLECTION);
        if (!exists) {
            console.log(`[IndexState] 🗃️  Creating shared commit-state collection '${CommitIndexState.COLLECTION}'`);
            await this.db.createCollection(
                CommitIndexState.COLLECTION,
                CommitIndexState.DUMMY_DIM,
                'commitIndexState',
            );
        }
        this.ensured = true;
    }

    /** Read the recorded index state for an identity, or null if none. */
    async get(identity: string): Promise<CommitState | null> {
        try {
            await this.ensureCollection();
            const rows = await this.db.query(
                CommitIndexState.COLLECTION,
                `id in ["${this.idFor(identity)}"]`,
                ['id', 'content'],
                1,
            );
            if (rows.length === 0) return null;
            const raw = rows[0].content as string | undefined;
            if (!raw) return null;
            const parsed = JSON.parse(raw) as CommitState;
            if (!parsed.headCommit) return null;
            return parsed;
        } catch (error) {
            console.warn(`[IndexState] ⚠️  Failed to read commit state for '${identity}' (treating as absent): ${this.fmt(error)}`);
            return null;
        }
    }

    /** All recorded branch states for a repository (keyed by origin URL). */
    async getByRepo(repoUrl: string): Promise<CommitState[]> {
        if (!repoUrl) return [];
        try {
            await this.ensureCollection();
            const escaped = repoUrl.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
            const rows = await this.db.query(
                CommitIndexState.COLLECTION,
                `relativePath == "${escaped}"`,
                ['id', 'content'],
                16384,
            );
            const states: CommitState[] = [];
            for (const row of rows) {
                const raw = row.content as string | undefined;
                if (!raw) continue;
                try {
                    const parsed = JSON.parse(raw) as CommitState;
                    if (parsed.headCommit) states.push(parsed);
                } catch { /* skip malformed row */ }
            }
            return states;
        } catch (error) {
            console.warn(`[IndexState] ⚠️  Failed to list states for repo '${repoUrl}': ${this.fmt(error)}`);
            return [];
        }
    }

    /** Every recorded branch state across all repositories (for the index-tree UI). */
    async getAll(): Promise<CommitState[]> {
        try {
            await this.ensureCollection();
            const rows = await this.db.query(
                CommitIndexState.COLLECTION,
                'id != ""',
                ['id', 'content'],
                16384,
            );
            const states: CommitState[] = [];
            for (const row of rows) {
                const raw = row.content as string | undefined;
                if (!raw) continue;
                try {
                    const parsed = JSON.parse(raw) as CommitState;
                    if (parsed.headCommit) states.push(parsed);
                } catch { /* skip malformed row */ }
            }
            return states;
        } catch (error) {
            console.warn(`[IndexState] ⚠️  Failed to list all states: ${this.fmt(error)}`);
            return [];
        }
    }

    /** Record (upsert) that `identity` is now indexed up to `headCommit`. */
    async set(identity: string, headCommit: string, dimension: number, options: SetStateOptions = {}): Promise<void> {
        try {
            await this.ensureCollection();
            const state: CommitState = {
                identity,
                headCommit,
                dimension,
                // Timestamp is best-effort provenance only; never used for logic.
                updatedAt: Date.now(),
                repoUrl: options.repoUrl,
                baseIdentity: options.baseIdentity ?? null,
                parentIdentity: options.parentIdentity ?? null,
                overridePaths: options.overridePaths ?? [],
                collectionName: options.collectionName,
            };
            const id = this.idFor(identity);
            const doc: VectorDocument = {
                id,
                vector: [0, 0],
                content: JSON.stringify(state),
                // Store repoUrl in the queryable relativePath field so getByRepo can
                // list all indexed branches of a repository via a scalar filter.
                relativePath: options.repoUrl || '',
                startLine: 0,
                endLine: 0,
                fileExtension: '',
                metadata: { identity },
            };
            // Milvus `insert` appends rather than upserts, so drop any prior row
            // for this identity first to keep exactly one authoritative state row.
            try {
                await this.db.delete(CommitIndexState.COLLECTION, [id]);
            } catch {
                /* first write for this identity — nothing to delete */
            }
            await this.db.insert(CommitIndexState.COLLECTION, [doc]);
            console.log(`[IndexState] ✅ Recorded ${identity} @ ${headCommit.slice(0, 8)}`);
        } catch (error) {
            // Non-fatal: worst case the next index sees no state and does a full run.
            console.warn(`[IndexState] ⚠️  Failed to record commit state for '${identity}' (non-fatal): ${this.fmt(error)}`);
        }
    }

    /** Remove the recorded state for an identity (used on clearIndex). */
    async remove(identity: string): Promise<void> {
        try {
            const exists = await this.db.hasCollection(CommitIndexState.COLLECTION);
            if (!exists) return;
            await this.db.delete(CommitIndexState.COLLECTION, [this.idFor(identity)]);
            console.log(`[IndexState] 🧹 Removed commit state for ${identity}`);
        } catch (error) {
            console.warn(`[IndexState] ⚠️  Failed to remove commit state for '${identity}' (non-fatal): ${this.fmt(error)}`);
        }
    }
}
