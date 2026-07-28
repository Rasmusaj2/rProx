import { stripColorCodes } from "../util/mcColors";
import type { Tag } from "./types";

// which hypixel game the client is currently looking at
export type GameMode = "bedwars" | "skywars" | "duels" | "lobby" | "unknown";

// the sidebar title is the giveaway - "§e§lBED WARS", "§e§lSKYWARS", ...
const TITLES: Array<[pattern: RegExp, game: GameMode]> = [
    [/BED\s*WARS/, "bedwars"],
    [/SKY\s*WARS/, "skywars"],
    [/DUELS?/, "duels"],
    [/HYPIXEL/, "lobby"],
];

export function gameFromTitle(title: string): GameMode {
    const clean = stripColorCodes(title).toUpperCase();
    for (const [pattern, game] of TITLES) {
        if (pattern.test(clean)) return game;
    }
    return "unknown";
}

// lobbies and games we dont know fall back to bedwars, thats what most of this
// is built around and its what used to show everywhere
export function statsGame(game: GameMode): GameMode {
    return game === "skywars" || game === "duels" ? game : "bedwars";
}

// tags with no game on them are game agnostic (cheater flags and the like)
export function tagsForGame(tags: Tag[], game: GameMode): Tag[] {
    const wanted = statsGame(game);
    return tags.filter((tag) => !tag.game || tag.game === wanted);
}

interface ObjectivePacket {
    name: string;
    action: number; // 0 create, 1 remove, 2 update
    displayText?: string;
}

interface DisplayObjectivePacket {
    position: number; // 1 is the sidebar
    name: string;
}

const SIDEBAR = 1;

// follows the scoreboard to work out what the client is playing. both apply
// methods return true when the active game actually changed.
export class GameTracker {
    private titles = new Map<string, string>(); // objective name -> its display title
    private sidebar?: string; // objective currently shown in the sidebar
    private current: GameMode = "unknown";

    get game(): GameMode {
        return this.current;
    }

    applyObjective(packet: ObjectivePacket): boolean {
        if (packet.action === 1) this.titles.delete(packet.name);
        else if (typeof packet.displayText === "string") this.titles.set(packet.name, packet.displayText);
        return this.refresh();
    }

    applyDisplayObjective(packet: DisplayObjectivePacket): boolean {
        if (packet.position !== SIDEBAR) return false;
        this.sidebar = packet.name || undefined;
        return this.refresh();
    }

    private refresh(): boolean {
        const title = this.sidebar ? this.titles.get(this.sidebar) : undefined;
        const next = title ? gameFromTitle(title) : "unknown";
        if (next === this.current) return false;
        this.current = next;
        return true;
    }

    clear(): void {
        this.titles.clear();
        this.sidebar = undefined;
        this.current = "unknown";
    }
}
