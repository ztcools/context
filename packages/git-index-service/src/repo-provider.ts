import { RepoSpec, ServiceConfig } from './config.js';

/**
 * Source of the main repositories to keep indexed. Implementations decide where
 * the repo list comes from (static config, GitLab API, …). This is the pluggable
 * GitLab integration seam.
 */
export interface RepoProvider {
    listRepos(): Promise<RepoSpec[]>;
}

/** Repos supplied directly via GIT_INDEX_REPOS / a config file. */
export class ConfigRepoProvider implements RepoProvider {
    constructor(private repos: RepoSpec[]) {}
    async listRepos(): Promise<RepoSpec[]> {
        return this.repos;
    }
}

/**
 * Discovers repos from a GitLab instance via its REST API. Enabled with
 * GIT_INDEX_SOURCE=gitlab plus GITLAB_BASE_URL + GITLAB_TOKEN and either
 * GITLAB_GROUP (all projects under a group) or GITLAB_PROJECT_IDS (explicit list).
 *
 * The clone URL stored on each RepoSpec is the canonical http_url_to_repo so the
 * resulting index identity (url:branch) matches what developers use; the token is
 * carried separately for authenticated fetch.
 */
export class GitLabRepoProvider implements RepoProvider {
    constructor(private cfg: ServiceConfig['gitlab']) {}

    private api(path: string): string {
        const base = (this.cfg.baseUrl || '').replace(/\/+$/, '');
        return `${base}/api/v4${path}`;
    }

    private async get(path: string): Promise<any> {
        const res = await fetch(this.api(path), {
            headers: { 'PRIVATE-TOKEN': this.cfg.token || '' },
        });
        if (!res.ok) {
            throw new Error(`GitLab API ${path} → ${res.status} ${res.statusText}`);
        }
        return res.json();
    }

    private toSpec(project: any): RepoSpec {
        return {
            name: project.path_with_namespace || project.name || String(project.id),
            url: project.http_url_to_repo || project.web_url,
            branch: project.default_branch || this.cfg.defaultBranch,
            token: this.cfg.token,
        };
    }

    async listRepos(): Promise<RepoSpec[]> {
        if (!this.cfg.baseUrl || !this.cfg.token) {
            throw new Error('GitLab source requires GITLAB_BASE_URL and GITLAB_TOKEN');
        }
        const specs: RepoSpec[] = [];

        if (this.cfg.projectIds.length > 0) {
            for (const id of this.cfg.projectIds) {
                const project = await this.get(`/projects/${encodeURIComponent(id)}`);
                specs.push(this.toSpec(project));
            }
            return specs;
        }

        if (this.cfg.group) {
            let page = 1;
            for (;;) {
                const projects = await this.get(
                    `/groups/${encodeURIComponent(this.cfg.group)}/projects?include_subgroups=true&per_page=100&page=${page}`,
                );
                if (!Array.isArray(projects) || projects.length === 0) break;
                for (const p of projects) specs.push(this.toSpec(p));
                if (projects.length < 100) break;
                page++;
            }
            return specs;
        }

        throw new Error('GitLab source requires GITLAB_GROUP or GITLAB_PROJECT_IDS');
    }
}

export function createRepoProvider(config: ServiceConfig): RepoProvider {
    if (config.source === 'gitlab') {
        return new GitLabRepoProvider(config.gitlab);
    }
    return new ConfigRepoProvider(config.repos);
}
