import { dirname, resolve } from "node:path";

// where the proxy keeps the files a user is meant to touch - config.json, ./plugins, ./auth
// wasnt an issue from src before but with compiled to an executable, the cwd is where the user ran it from, not where the exe is, so we need to figure out where the executable is located
export function isPackaged(): boolean {
    // pkg sets both, older builds only set process.pkg
    return Boolean((process as unknown as { pkg?: unknown }).pkg) || Boolean(process.versions?.pkg);
}

export function baseDir(): string {
    return isPackaged() ? dirname(process.execPath) : process.cwd();
}

export function fromBase(...parts: string[]): string {
    return resolve(baseDir(), ...parts);
}
