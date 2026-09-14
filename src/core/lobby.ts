import { dashUuid } from "../services/microsoft";
import { stripColorCodes } from "../util/mcColors";
import type { PlayerRef } from "./types";


const ACTION_NAMES = [
    "add_player",
    "update_game_mode",
    "update_latency",
    "update_display_name",
    "remove_player",
] as const;

export type PlayerInfoAction = (typeof ACTION_NAMES)[number];

export function actionName(action: string | number): string {
    return typeof action === "number" ? (ACTION_NAMES[action] ?? String(action)) : action;
}

export interface TabEntry {
    name: string;
    uuid: string;
    displayName?: string; // raw component the server last sent
    gamemode?: number;
    ping?: number;
}

export interface PlayerInfoEntry {
    uuid?: string;
    UUID?: string;
    name?: string;
    displayName?: string;
    gamemode?: number;
    gameMode?: number;
    ping?: number;
    latency?: number;
}

export interface PlayerInfoPacket {
    action: string | number;
    data?: PlayerInfoEntry[];
}

export interface NpcDecoyConfig {
    minNameLength: number;
    npcUuidVersions: string[];
    skipSpectators: boolean;
    requireNameInDisplayName: boolean;
    skipZeroPingOnDump: boolean;
}

export const DEFAULT_NPC_DECOYS: NpcDecoyConfig = {
    minNameLength: 3,
    npcUuidVersions: ["2"],
    skipSpectators: true,
    requireNameInDisplayName: true,
    skipZeroPingOnDump: true,
};

const INITIAL_DUMP_MS = 5_000;
const JOIN_BATCH_MAX = 8;


const NPC_RANK = /\[npc\]/i;
function componentText(raw: unknown): string {
    if (raw === null || raw === undefined) return "";
    if (typeof raw === "string") {
        const trimmed = raw.trim();
        if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return raw; // plain legacy text
        try {
            return componentText(JSON.parse(raw));
        } catch {
            return raw;
        }
    }
    if (Array.isArray(raw)) return raw.map(componentText).join("");
    if (typeof raw !== "object") return "";
    const node = raw as { text?: unknown; extra?: unknown };
    return (typeof node.text === "string" ? node.text : "") + componentText(node.extra);
}

export function hasNpcRank(displayName: unknown): boolean {
    return NPC_RANK.test(stripColorCodes(componentText(displayName)));
}

// check if hypixel has given a player a fake uuid, if they have then we can skip the hypixel api lookup and just apply the nick tag
// this also saves lookups on a lot of npcs we miss for reasons i cant figure out yet
export function isFakeUuid(uuid: string): boolean {
    const raw = uuid.replace(/-/g, "");
    if (raw.length !== 32) return false; // fake
    return raw[12] !== "4";
}

export class LobbyTracker {
    private byUuid = new Map<string, TabEntry>();
    private byName = new Map<string, string>(); // lowercase name -> uuid
    private npcs = new Set<string>(); // lowercase names wearing an [NPC] rank
    private serverAt = Date.now(); // when the current servers login landed, see INITIAL_DUMP_MS
    private readonly decoy: NpcDecoyConfig;

    constructor(decoy: Partial<NpcDecoyConfig> = {}) {
        this.decoy = { ...DEFAULT_NPC_DECOYS, ...decoy };
    }

    // apply a decoded player_info packet, returns whoever is newly in the list
    applyPlayerInfo(packet: PlayerInfoPacket): PlayerRef[] {
        const action = actionName(packet.action);
        const added: PlayerRef[] = [];
        const entries = packet.data ?? [];
        const dump = entries.length > JOIN_BATCH_MAX || Date.now() - this.serverAt < INITIAL_DUMP_MS;

        for (const entry of entries) {
            const rawUuid = entry.uuid ?? entry.UUID;
            if (!rawUuid) continue;
            const uuid = dashUuid(rawUuid).toLowerCase();

            if (action === "add_player") { // new player, new check, or a player rejoining after leaving
                if (!entry.name) continue;
                const existed = this.byUuid.has(uuid);
                this.byUuid.set(uuid, {
                    name: entry.name,
                    uuid,
                    displayName: entry.displayName,
                    gamemode: entry.gamemode ?? entry.gameMode,
                    ping: entry.ping ?? entry.latency,
                });
                this.byName.set(entry.name.toLowerCase(), uuid);
                if (hasNpcRank(entry.displayName) || this.decoyReason(entry, uuid, dump)) this.markNpc(entry.name);
                if (!existed) added.push({ name: entry.name, uuid });
            } else if (action === "remove_player") {
                const known = this.byUuid.get(uuid);
                if (known) {
                    this.byUuid.delete(uuid);
                    this.byName.delete(known.name.toLowerCase());
                    this.npcs.delete(known.name.toLowerCase());
                }
            } else if (action === "update_display_name") {
                const known = this.byUuid.get(uuid);
                if (known) known.displayName = entry.displayName;
                if (known && hasNpcRank(entry.displayName)) this.markNpc(known.name);
            } else if (action === "update_game_mode") {
                const known = this.byUuid.get(uuid);
                if (known) known.gamemode = entry.gamemode ?? entry.gameMode;
            } else if (action === "update_latency") {
                const known = this.byUuid.get(uuid);
                if (known) known.ping = entry.ping ?? entry.latency;
            } // we dont care about anything else as it doesnt change the playerlist
        }
        return added;
    }

    // layed npc detection
    private decoyReason(entry: PlayerInfoEntry, uuid: string, isDump: boolean): string | null {
        const name = entry.name ?? "";

        if (name.length < this.decoy.minNameLength) return `name shorter than ${this.decoy.minNameLength}`;

        const version = uuid.replace(/-/g, "")[12];
        if (this.decoy.npcUuidVersions.includes(version)) return `uuid version ${version}`;

        const gamemode = entry.gamemode ?? entry.gameMode;
        if (this.decoy.skipSpectators && gamemode === 3) return "spectator gamemode";

        if (this.decoy.requireNameInDisplayName && entry.displayName !== null && entry.displayName !== undefined) {
            const shown = stripColorCodes(componentText(entry.displayName));
            if (shown.trim() && !shown.toLowerCase().includes(name.toLowerCase())) {
                return "display name does not contain username";
            }
        }

        if (this.decoy.skipZeroPingOnDump && isDump) {
            const ping = entry.ping ?? entry.latency;
            if (ping === 0) return "zero ping in lobby dump";
        }

        return null;
    }

    // npcs are left out, nothing downstream of this wants to spend a lookup on one
    list(): PlayerRef[] { // why
        return [...this.byUuid.values()]
            .filter((e) => !this.isNpc(e.name))
            .map((e) => ({ name: e.name, uuid: e.uuid }));
    }

    // the rank usually rides on the team packet rather than the tab entry, so
    // whoever is watching those (nametagStats) marks them here for everyone else
    markNpc(name: string): void {
        this.npcs.add(name.toLowerCase());
    }

    isNpc(name: string): boolean {
        return this.npcs.has(name.toLowerCase());
    }

    get(name: string): PlayerRef | undefined {
        const uuid = this.byName.get(name.toLowerCase());
        if (!uuid) return undefined;
        const entry = this.byUuid.get(uuid);
        return entry ? { name: entry.name, uuid: entry.uuid } : undefined;
    }

    entry(uuid: string): TabEntry | undefined {
        return this.byUuid.get(dashUuid(uuid).toLowerCase());
    }

    get size(): number {
        return this.byUuid.size;
    }

    clear(): void {
        this.byUuid.clear();
        this.byName.clear();
        this.npcs.clear(); // a new server means a new set of npcs
        this.serverAt = Date.now(); // the next player_info batch is this servers dump
    }
}

// get list from /who command, returns null if the text is not a /who response
// should not be run every text message but idc
export function parseWhoResponse(text: string): string[] | null {
    const match = /^ONLINE:\s*(.+)$/.exec(text.trim());
    if (!match) return null;
    return match[1]
        .split(",")
        .map((name) => name.trim())
        .filter((name) => /^[A-Za-z0-9_]{1,16}$/.test(name));
}
