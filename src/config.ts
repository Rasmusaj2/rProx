import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export interface Config {
    proxy: {
        listenHost: string, // 127.0.0.1 - "localhost" binds ipv6 and minecraft doesnt like that
        listenPort: number, // 25565
        targetHost: string, // mc.hypixel.net
        targetPort: number, // 25565
        version: string, // 1.8.9
        motd: string, // Proxy | Aesthetic
        onlineMode: boolean, // true recommended - if false should only be run locally
        maxPlayers: number // 10
    },
    auth: {
        dir: string, // ./auth
        requireMatchingAccount: boolean, // true - can allow linking to another account if false
    },
    commandPrefix: string, // // - what marks a message as a proxy command instead of chat
    detection: {
        autoWhoOnStart: boolean, // true - automatically send /who on server join
        ignoreSelf: boolean, // false - ignore self in /who detection
    }
    builtInPlugins: Record<string, unknown>, // custom config for builtInPlugins straight in config.json
    pluginDirectory: string, // ./plugins
}

const DEFAULTS: Config = {
    proxy: {
        listenHost: "127.0.0.1",
        listenPort: 25565,
        targetHost: "mc.hypixel.net",
        targetPort: 25565,
        version: "1.8.9",
        motd: "\u00a7brProx \u00a72| \u00a76Hypixel Stats Proxy.",
        onlineMode: true,
        maxPlayers: 10
    },
    auth: {
        dir: "./auth",
        requireMatchingAccount: true,
    },
    commandPrefix: "//",
    detection: {
        autoWhoOnStart: true,
        ignoreSelf: false,
    },
    builtInPlugins: {},
    pluginDirectory: "./plugins",
}

// Merge two objects recursively, with the second object overriding the first. Arrays are not merged, but replaced.
function deepMerge<T>(base: T, override: unknown): T {
  if (override === null || override === undefined) return base;
  if (typeof base !== "object" || Array.isArray(base) || base === null) {
    return override as T;
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(override as Record<string, unknown>)) {
    out[k] = deepMerge((base as Record<string, unknown>)[k], v);
  }
  return out as T;
}

export function loadConfig(): Config {
    const candidates = [
        resolve(process.cwd(), "config.json"),
        resolve(process.cwd(), "config.default.json"), // fallback to default config if no config.json is found
    ].filter(Boolean) as string[];
    for (const candidate of candidates) {
        if (existsSync(candidate)) {
            const rawData = readFileSync(candidate, "utf-8");
            const parsedData = JSON.parse(rawData);
            return deepMerge(DEFAULTS, parsedData);
        }
    }
    return DEFAULTS;
}