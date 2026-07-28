import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { createLogger, type Logger } from "../util/log";

// remembers linked minecraft accounts to uuids and caches their tokens for the proxy to use next login
// this is not pretty to do in files, but its the simplest way for this scale of proxy, and a db would be overkill for now

export interface LinkedAccount {
    uuid: string; // uuid of the account joining the proxy
    username: string;
    mcUuid?: string; // uuid of the linked minecraft account, ie. the authed account through https://microsoft.com/link
    mcUsername?: string;
    linkedAt: number;
    lastSeen?: number;
}

export class AccountStore {
    private accounts = new Map<string, LinkedAccount>();
    private readonly dir: string;
    private readonly file: string;
    private readonly log: Logger;

    constructor(dir: string, log?: Logger) {
        this.dir = resolve(process.cwd(), dir);
        this.file = join(this.dir, "accounts.json");
        this.log = log ?? createLogger("accounts");
        this.load();
    }

    private load(): void {
        try {
            if (!existsSync(this.file)) return;
            const raw = JSON.parse(readFileSync(this.file, "utf-8")) as LinkedAccount[];
            for (const account of raw) this.accounts.set(account.uuid.toLowerCase(), account);
            this.log.info(`loaded ${this.accounts.size} linked account(s)`);
        } catch (error) {
            this.log.warn(`could not read accounts.json: ${error}`);
        }
    }

    private save(): void {
        try {
            mkdirSync(this.dir, { recursive: true });
            writeFileSync(this.file, JSON.stringify([...this.accounts.values()], null, 2));
        } catch (error) {
            this.log.error(`could not write accounts.json: ${error}`);
        }
    }

    // per player token cache, seperate .json files
    profileDir(uuid: string): string {
        return join(this.dir, uuid.toLowerCase());
    }

    isLinked(uuid: string): boolean {
        return this.accounts.has(uuid.toLowerCase());
    }

    get(uuid: string): LinkedAccount | undefined {
        return this.accounts.get(uuid.toLowerCase());
    }

    link(account: LinkedAccount): void {
        this.accounts.set(account.uuid.toLowerCase(), account);
        this.save();
    }

    touch(uuid: string): void {
        const account = this.accounts.get(uuid.toLowerCase());
        if (!account) return;
        account.lastSeen = Date.now();
        this.save();
    }

    // forget an account and throw away its cached tokens
    // need to include a way to do this for a player so they can either relink or get their token safely removed (privacy concerns stuff blah blah)
    unlink(uuid: string): void {
        this.accounts.delete(uuid.toLowerCase());
        try {
            rmSync(this.profileDir(uuid), { recursive: true, force: true });
        } catch {
            
        }
        this.save();
    }

    list(): LinkedAccount[] {
        return [...this.accounts.values()];
    }
}
