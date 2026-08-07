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
}

export interface PlayerInfoPacket {
    action: string | number;
    data?: Array<{
        uuid?: string;
        UUID?: string;
        name?: string;
        displayName?: string;
    }>;
}


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

export class LobbyTracker {
    private byUuid = new Map<string, TabEntry>();
    private byName = new Map<string, string>(); // lowercase name -> uuid
    private npcs = new Set<string>(); // lowercase names wearing an [NPC] rank

    // apply a decoded player_info packet, returns whoever is newly in the list
    applyPlayerInfo(packet: PlayerInfoPacket): PlayerRef[] {
        const action = actionName(packet.action);
        const added: PlayerRef[] = [];

        for (const entry of packet.data ?? []) {
            const rawUuid = entry.uuid ?? entry.UUID;
            if (!rawUuid) continue;
            const uuid = dashUuid(rawUuid).toLowerCase();

            if (action === "add_player") { // new player, new check, or a player rejoining after leaving
                if (!entry.name) continue;
                const existed = this.byUuid.has(uuid);
                this.byUuid.set(uuid, { name: entry.name, uuid, displayName: entry.displayName });
                this.byName.set(entry.name.toLowerCase(), uuid);
                if (hasNpcRank(entry.displayName)) this.markNpc(entry.name);
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
            } // we dont care about anything else as it doesnt change the playerlist
        }
        return added;
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
