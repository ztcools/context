import * as fs from 'fs';
import * as path from 'path';
import { RepoSpec } from './config.js';

export interface ScheduleConfig {
    dailyHour: number | null;
    intervalMs: number;
}

export interface StoredConfig {
    repos: RepoSpec[];
    schedule: ScheduleConfig;
    updatedAt: number;
}

export class ConfigStore {
    private readonly file: string;
    private data: StoredConfig;

    constructor(file: string, seed: StoredConfig) {
        this.file = file;
        this.data = this.loadOrSeed(seed);
    }

    private loadOrSeed(seed: StoredConfig): StoredConfig {
        try {
            if (fs.existsSync(this.file)) {
                const raw = JSON.parse(fs.readFileSync(this.file, 'utf-8')) as StoredConfig;
                return {
                    repos: Array.isArray(raw.repos) ? raw.repos : seed.repos,
                    schedule: raw.schedule || seed.schedule,
                    updatedAt: raw.updatedAt || 0,
                };
            }
        } catch (e: any) {
            console.warn(`[ConfigStore] Failed to read ${this.file}, seeding from env: ${e?.message || e}`);
        }
        const initial = { ...seed };
        this.persist(initial);
        return initial;
    }

    private persist(data: StoredConfig): void {
        try {
            fs.mkdirSync(path.dirname(this.file), { recursive: true });
            fs.writeFileSync(this.file, JSON.stringify(data, null, 2), 'utf-8');
        } catch (e: any) {
            console.warn(`[ConfigStore] Failed to write ${this.file}: ${e?.message || e}`);
        }
    }

    getRepos(): RepoSpec[] {
        return this.data.repos.map(r => ({ ...r }));
    }

    getSchedule(): ScheduleConfig {
        return { ...this.data.schedule };
    }

    setSchedule(schedule: ScheduleConfig): void {
        this.data.schedule = schedule;
        this.data.updatedAt = 0;
        this.persist(this.data);
    }

    /** Add or replace a repo (keyed by name). */
    upsertRepo(repo: RepoSpec): void {
        const idx = this.data.repos.findIndex(r => r.name === repo.name);
        if (idx >= 0) this.data.repos[idx] = repo;
        else this.data.repos.push(repo);
        this.persist(this.data);
    }

    /** Persist the branch actually indexed (e.g. after default-branch fallback). */
    setRepoBranch(name: string, branch: string): void {
        const idx = this.data.repos.findIndex(r => r.name === name);
        if (idx >= 0 && this.data.repos[idx].branch !== branch) {
            this.data.repos[idx].branch = branch;
            this.persist(this.data);
        }
    }

    removeRepo(name: string): boolean {
        const before = this.data.repos.length;
        this.data.repos = this.data.repos.filter(r => r.name !== name);
        const changed = this.data.repos.length !== before;
        if (changed) this.persist(this.data);
        return changed;
    }

    getRepo(name: string): RepoSpec | undefined {
        const r = this.data.repos.find(x => x.name === name);
        return r ? { ...r } : undefined;
    }
}
