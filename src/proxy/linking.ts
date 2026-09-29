import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Authflow, Titles } from "prismarine-auth";
import { createLogger, type Logger } from "../util/log";
import type { AccountStore } from "./accounts";

// links a minecraft account through the microsoft device code flow, storing the result in an AccountStore

export const AUTH_OPTIONS = {
    flow: "live" as const,
    authTitle: Titles.MinecraftNintendoSwitch, // fake a nintendo switch
    deviceType: "Nintendo",
};

export interface LinkCode {
    userCode: string;
    verificationUri: string;
    expiresAt: number;
}

export interface LinkResult {
    status: "pending" | "failed";
    code?: LinkCode;
    error?: string;
}

interface PendingLink extends LinkCode {
    promise: Promise<void>;
}

export class LinkManager { // pending links are keyed so people dont get a new code every time they join, and so we can cancel the flow if they leave before completing it
    private pending = new Map<string, PendingLink>();
    private readonly log: Logger;

    constructor(
        private readonly accounts: AccountStore,
        private readonly requireMatchingAccount: boolean,
        log?: Logger,
    ) {
        this.log = log ?? createLogger("linking");
    }

    getPending(uuid: string): LinkCode | undefined {
        const key = uuid.toLowerCase();
        const pending = this.pending.get(key);
        if (!pending) return undefined;
        if (pending.expiresAt < Date.now()) {
            this.pending.delete(key);
            return undefined;
        }
        return { userCode: pending.userCode, verificationUri: pending.verificationUri, expiresAt: pending.expiresAt };
    }

    // resolves as soon as microsoft issues a device code so the caller can kick
    // the player with it, the sign in itself lands later
    async begin(uuid: string, username: string): Promise<LinkResult> {
        const key = uuid.toLowerCase();
        const existing = this.getPending(key);
        if (existing) return { status: "pending", code: existing };

        let resolveCode!: (code: LinkCode) => void;
        let rejectCode!: (error: Error) => void;
        const codePromise = new Promise<LinkCode>((resolve, reject) => {
            resolveCode = resolve;
            rejectCode = reject;
        });

        const flow = new Authflow(
            key, // cache key, must match what nmp later passes as username
            this.accounts.profileDir(key),
            AUTH_OPTIONS,
            (data: { user_code: string; verification_uri: string; expires_in?: number }) => {
                resolveCode({
                    userCode: data.user_code,
                    verificationUri: data.verification_uri,
                    expiresAt: Date.now() + (data.expires_in ?? 900) * 1000,
                });
            },
        );

        const promise = flow
            .getMinecraftJavaToken({ fetchProfile: true })
            .then((result: { profile?: { id?: string; name?: string } }) => {
                const profile = result?.profile;
                if (!profile?.id) throw new Error("no Minecraft profile on that account");

                const sameAccount = profile.id.replace(/-/g, "").toLowerCase() === key.replace(/-/g, "");
                if (this.requireMatchingAccount && !sameAccount) {
                    // signing in as somebody else would let one player drive
                    // anothers account through the proxy
                    this.accounts.unlink(key);
                    throw new Error(`linked account (${profile.name}) does not match the joining player`);
                } 

                this.accounts.link({
                    uuid: key,
                    username,
                    mcUuid: profile.id,
                    mcUsername: profile.name,
                    linkedAt: Date.now(),
                });
                this.log.info(`linked ${username} -> ${profile.name} (${profile.id})`);
            })
            .catch((error: Error) => {
                this.log.warn(`link failed for ${username}: ${error.message}`);
                rejectCode(error);
            })
            .finally(() => {
                this.pending.delete(key);
            });

        try {
            const code = await codePromise;
            this.pending.set(key, { ...code, promise });
            return { status: "pending", code };
        } catch (error) {
            return { status: "failed", error: (error as Error).message };
        }
    }

    // onboarding sign in not tied to a player yet
    async session(onCode: (code: LinkCode) => void): Promise<SessionResult> {
        const tempKey = `onboarding-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        const tempDir = this.accounts.profileDir(tempKey);
        try {
            const flow = new Authflow(
                tempKey,
                tempDir,
                AUTH_OPTIONS,
                (data: { user_code: string; verification_uri: string; expires_in?: number }) => {
                    onCode({
                        userCode: data.user_code,
                        verificationUri: data.verification_uri,
                        expiresAt: Date.now() + (data.expires_in ?? 900) * 1000,
                    });
                },
            );
            const result = await flow.getMinecraftJavaToken({ fetchProfile: true });
            const profile = result?.profile as { id?: string; name?: string } | undefined;
            if (!profile?.id) throw new Error("no Minecraft profile on that account");
            // minecraft-protocol hands dashed form uuids
            const uuid = profile.id.toLowerCase().replace(
                /(\w{8})(\w{4})(\w{4})(\w{4})(\w{12})/,
                "$1-$2-$3-$4-$5",
            );
            this.moveCache(tempDir, tempKey, this.accounts.profileDir(uuid), uuid);
            rmSync(tempDir, { recursive: true, force: true });
            this.accounts.link({
                uuid,
                username: profile.name ?? "",
                mcUuid: uuid,
                mcUsername: profile.name ?? "",
                linkedAt: Date.now(),
            });
            this.log.info(`signed in and linked ${profile.name} (${uuid})`);
            return { status: "ok", uuid, username: profile.name ?? "" };
        } catch (error) {
            try {
                rmSync(tempDir, { recursive: true, force: true });
            } catch {
                // best effort
            }
            return { status: "failed", error: (error as Error).message };
        }
    }

    // prismarine-auth names its cache files some bullshit
    // rehash for real uuid
    private moveCache(fromDir: string, fromKey: string, toDir: string, toKey: string): void {
        if (!existsSync(fromDir)) return;
        mkdirSync(toDir, { recursive: true });
        const fromHash = cacheHash(fromKey);
        const toHash = cacheHash(toKey);
        for (const file of readdirSync(fromDir)) {
            const target = file.startsWith(fromHash) ? `${toHash}${file.slice(fromHash.length)}` : file;
            const destination = join(toDir, target);
            if (existsSync(destination)) rmSync(destination, { force: true }); // re-running setup, replace the old cache
            renameSync(join(fromDir, file), destination);
        }
    }
}

export interface SessionResult {
    status: "ok" | "failed";
    uuid?: string;
    username?: string;
    error?: string;
}

function cacheHash(input: string): string {
    return createHash("sha1").update(input, "binary").digest("hex").slice(0, 6);
}
