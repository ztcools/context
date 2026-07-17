import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Manages the service's own SSH deploy key. When a repo has no token the service
 * clones/pulls over SSH using this key — the operator views the public key here
 * and registers it as a GitLab deploy key / SSH key.
 */
export class SshKeyManager {
    private readonly dir: string;
    private readonly privKey: string;
    private readonly pubKey: string;

    constructor(dir: string) {
        this.dir = dir;
        this.privKey = path.join(dir, 'id_ed25519');
        this.pubKey = path.join(dir, 'id_ed25519.pub');
    }

    ensureKeyPair(): void {
        try {
            if (fs.existsSync(this.privKey)) return;
            fs.mkdirSync(this.dir, { recursive: true });
            execSync(
                `ssh-keygen -t ed25519 -N "" -C "phigent-git-index" -f "${this.privKey}"`,
                { stdio: ['pipe', 'pipe', 'pipe'] }
            );
            fs.chmodSync(this.privKey, 0o600);
            console.log(`[SshKeyManager] Generated SSH deploy key at ${this.privKey}`);
        } catch (e: any) {
            console.warn(`[SshKeyManager] Failed to ensure keypair: ${e?.message || e}`);
        }
    }

    getPublicKey(): string | null {
        try {
            return fs.readFileSync(this.pubKey, 'utf-8').trim();
        } catch {
            return null;
        }
    }

    sshCommand(): string {
        return `ssh -i "${this.privKey}" -o IdentitiesOnly=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null`;
    }
}
