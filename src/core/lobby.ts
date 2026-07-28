import { dashUuid } from "../services/microsoft";
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

export class LobbyTracker {
    private byUuid = new Map<string, TabEntry>();
    private byName = new Map<string, string>(); // lowercase name -> uuid

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
                if (!existed) added.push({ name: entry.name, uuid });
            } else if (action === "remove_player") {
                const known = this.byUuid.get(uuid);
                if (known) {
                    this.byUuid.delete(uuid);
                    this.byName.delete(known.name.toLowerCase());
                }
            } else if (action === "update_display_name") {
                const known = this.byUuid.get(uuid);
                if (known) known.displayName = entry.displayName;
            } // we dont care about anything else as it doesnt change the playerlist
        }
        return added;
    }

    list(): PlayerRef[] { // why
        return [...this.byUuid.values()].map((e) => ({ name: e.name, uuid: e.uuid }));
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
