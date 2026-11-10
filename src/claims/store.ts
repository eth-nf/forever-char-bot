import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** A character a server member has claimed, or an admin has assigned to them. */
export interface Claim {
    /** The character's API slug, `{name}-{surname}` in lowercase. One claim per slug per server. */
    slug: string;
    name: string;
    surname: string;
    /** Discord user ID of the member the character belongs to. */
    userId: string;
    claimedAt: number;
    /** Discord user ID of the admin who assigned it. Absent when the member claimed it themselves. */
    assignedBy?: string;
}

interface ClaimFile {
    version: 1;
    /** Claims per Discord server ID. */
    servers: Record<string, Claim[]>;
}

/**
 * Which server member plays which character, per Discord server. Kept in memory and written to a JSON file on every
 * change, so claims survive a restart. Without a file path nothing is written (used by the tests).
 */
export class ClaimStore {
    readonly #path?: string;
    readonly #servers = new Map<string, Map<string, Claim>>();
    #writing: Promise<void> = Promise.resolve();

    constructor(path?: string) {
        this.#path = path;
        if (!path || !existsSync(path)) return;
        let file: ClaimFile;
        try {
            file = JSON.parse(readFileSync(path, "utf8")) as ClaimFile;
        } catch (error) {
            // Starting empty here would overwrite everyone's claims on the next change.
            throw new Error(`The claims file ${path} can't be read: ${(error as Error).message}`);
        }
        for (const [serverId, claims] of Object.entries(file.servers ?? {})) {
            this.#servers.set(serverId, new Map(claims.map((claim) => [claim.slug, claim])));
        }
    }

    /** The claim on a character, if any. */
    owner(serverId: string, slug: string): Claim | undefined {
        return this.#servers.get(serverId)?.get(slug);
    }

    /** A member's characters, oldest claim first. */
    forUser(serverId: string, userId: string): Claim[] {
        return this.all(serverId).filter((claim) => claim.userId === userId);
    }

    all(serverId: string): Claim[] {
        return [...(this.#servers.get(serverId)?.values() ?? [])].sort((a, b) => a.claimedAt - b.claimedAt);
    }

    /** Sets who a character belongs to, replacing any earlier claim on it. Returns the claim it replaced. */
    async set(serverId: string, claim: Claim): Promise<Claim | undefined> {
        let server = this.#servers.get(serverId);
        if (!server) this.#servers.set(serverId, (server = new Map()));
        const previous = server.get(claim.slug);
        server.set(claim.slug, claim);
        await this.#save();
        return previous;
    }

    /** Removes the claim on a character. Returns the claim that was removed. */
    async remove(serverId: string, slug: string): Promise<Claim | undefined> {
        const server = this.#servers.get(serverId);
        const previous = server?.get(slug);
        if (!previous) return undefined;
        server?.delete(slug);
        await this.#save();
        return previous;
    }

    /** Writes the file through a temporary one, so a crash mid-write can't leave it half written. */
    #save(): Promise<void> {
        const path = this.#path;
        if (!path) return Promise.resolve();
        const write = async () => {
            const file: ClaimFile = {
                version: 1,
                servers: Object.fromEntries([...this.#servers].map(([serverId, claims]) => [serverId, [...claims.values()]])),
            };
            await mkdir(dirname(path), { recursive: true });
            await writeFile(`${path}.tmp`, JSON.stringify(file, null, 2));
            await rename(`${path}.tmp`, path);
        };
        // Changes are written one after another, each with the state at the time it runs.
        this.#writing = this.#writing.then(write, write);
        return this.#writing;
    }
}
