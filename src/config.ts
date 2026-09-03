import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createLogger } from "./util/log";
import { fromBase } from "./util/paths";

const log = createLogger("config");

export interface Config {
    proxy: {
        listenHost: string, // 127.0.0.1 - "localhost" binds ipv6 and minecraft doesnt like that
        listenPort: number, // 25565
        targetHost: string, // mc.hypixel.net
        targetPort: number, // 25565
        version: string, // 1.8.9
        motd: string, // Proxy | Aesthetic
        onlineMode: boolean, // true recommended - if false should only be run locally
        allowIngameEditing: boolean, // true - allows editing config.json in a chest gui while in-game
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
        motd: "§brProx §2| §6Hypixel Stats Proxy.",
        onlineMode: true,
        allowIngameEditing: true,
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

const CONFIG_FILE = "config.json";
const FALLBACK_FILE = "config.default.json";


function baseConfig(): Config {
    return structuredClone(DEFAULTS); // copy by value so the plugin cannot mutate the default object
}

function isBlock(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
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

export function configPath(): string {
    return fromBase(CONFIG_FILE);
}

function readJson(path: string): unknown {
    try {
        return JSON.parse(readFileSync(path, "utf-8"));
    } catch (error) {
        throw new Error(`${path} could not be read: ${error instanceof Error ? error.message : error}`);
    }
}

export function saveConfig(config: Config): boolean {
    const path = configPath();
    try {
        writeFileSync(path, `${JSON.stringify(config, null, 4)}\n`, "utf-8");
        return true;
    } catch (error) {
        log.warn(`could not write ${path}: ${error}`);
        return false;
    }
}

export function loadConfig(): Config {
    const path = configPath();
    if (existsSync(path)) return deepMerge(baseConfig(), readJson(path));

    // write if doesnt exist
    const fallback = fromBase(FALLBACK_FILE); // a shipped default, if there is one
    const config = existsSync(fallback) ? deepMerge(baseConfig(), readJson(fallback)) : baseConfig();
    if (saveConfig(config)) {
        log.info(`no ${CONFIG_FILE} found, generated one${existsSync(fallback) ? ` from ${FALLBACK_FILE}` : ""}`);
    }
    return config;
}

// copy over keys from defaults that are missing in target, recursively
function fillDefaults(target: Record<string, unknown>, defaults: Record<string, unknown>): boolean {
    let changed = false;
    for (const [key, value] of Object.entries(defaults)) {
        if (!(key in target)) {
            target[key] = structuredClone(value); // copy by value so the plugin cannot mutate the default object
            changed = true;
        } else if (isBlock(target[key]) && isBlock(value)) {
            if (fillDefaults(target[key] as Record<string, unknown>, value)) changed = true;
        }
    }
    return changed;
}


export function applyPluginDefaults(config: Config, name: string, defaults: Record<string, unknown>): boolean {
    const existing = config.builtInPlugins[name];
    const block = isBlock(existing) ? existing : {};
    let changed = !isBlock(existing);
    if (fillDefaults(block, defaults)) changed = true;
    config.builtInPlugins[name] = block;
    return changed;
}