// check the github repo releases for new version
import { createRequire } from "node:module";

const REPO = "Rasmusaj2/rProx";
const RELEASES_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;

interface GitHubRelease {
    tag_name?: string;
    html_url?: string;
}

export interface UpdateInfo {
    current: string;
    latest: string;
    url: string;
}

export function installedVersion(): string | undefined {
    try {
        const require = createRequire(__filename);
        const pkg = require("../../package.json") as { version?: string }; //require package.json so its included in the built executable
        return typeof pkg.version === "string" && pkg.version.length > 0 ? pkg.version : undefined;
    } catch {
        return undefined;
    }
}

function parts(version: string): number[] {
    const core = version.trim().replace(/^v/i, "").split(/[-+]/, 1)[0];
    return core.split(".").map((piece) => {
        const n = Number.parseInt(piece, 10);
        return Number.isFinite(n) ? n : 0;
    });
}

export function isNewerVersion(candidate: string, current: string): boolean {
    const a = parts(candidate);
    const b = parts(current);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const left = a[i] ?? 0;
        const right = b[i] ?? 0;
        if (left !== right) return left > right;
    }
    return false;
}

// null is no update or no server response
// UpdateInfo is a new version is available
// ignores shared HttpClient
export async function checkForUpdate(): Promise<UpdateInfo | null> {
    const current = installedVersion();
    if (!current) return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    let release: GitHubRelease;
    try {
        const res = await fetch(RELEASES_URL, {
            headers: { "user-agent": `rProx/${current}`, accept: "application/vnd.github+json" },
            signal: controller.signal,
        });
        if (!res.ok) return null;
        release = (await res.json()) as GitHubRelease;
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }

    const tag = release.tag_name;
    if (!tag) return null;
    const latest = tag.replace(/^v/i, "").trim();
    if (!isNewerVersion(latest, current)) return null;

    return { current, latest, url: release.html_url ?? RELEASES_PAGE };
}
