import { execSync } from 'child_process';
import * as path from 'path';

export function getRepoIdentity(codebasePath: string): string {
    const resolvedPath = path.resolve(codebasePath);

    try {
        const url = execSync('git remote get-url origin', {
            cwd: resolvedPath,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe']
        }).trim();

        const branch = execSync('git rev-parse --abbrev-ref HEAD', {
            cwd: resolvedPath,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe']
        }).trim();

        if (url && branch) {
            return `${url}#${branch}`;
        }
    } catch {
    }

    return resolvedPath;
}