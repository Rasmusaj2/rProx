import { COLOR_CODES, colorFromName, firstColor, type McColorName } from "../util/mcColors";
import type { HypixelPlayer } from "./hypixel";

export interface RankInfo {
    display: string; // formatted rank tag "§b[MVP§c+§b]"
    color: McColorName; // base color (player name color)
}

const DEFAULT_RANK: RankInfo = { display: "", color: "gray" };

const STAFF: Record<string, RankInfo> = {
    STAFF: { display: "§2[STAFF]", color: "red" }, // afaik the new staff rank returns this for all staff members
    // but i havent actually checked yet, so im keeping legacy ranks here just in case (also yt i guess)
    ADMIN: { display: "§c[ADMIN]", color: "red" },
    OWNER: { display: "§c[OWNER]", color: "red" },
    GAME_MASTER: { display: "§2[GM]", color: "dark_green" },
    MODERATOR: { display: "§2[MOD]", color: "dark_green" },
    HELPER: { display: "§9[HELPER]", color: "blue" },
    YOUTUBER: { display: "§c[§fYOUTUBE§c]", color: "red" },
};

// forgot to include this in the HypixelPlayer interface, so we have to do it here
function str(player: HypixelPlayer, key: string): string | undefined {
    const value = (player as Record<string, unknown>)[key];
    return typeof value === "string" ? value : undefined;
}

export function getRank(player: HypixelPlayer): RankInfo {
    const prefix = str(player, "prefix"); // custom/special ranks override everything (pig rank primarily, idk if anything else still exists)
    if (prefix) return { display: prefix, color: firstColor(prefix) ?? "gray" };

    const staff = str(player, "rank");
    if (staff && staff !== "NORMAL" && STAFF[staff]) return STAFF[staff]; // what the fuck

    // the plusses can be recolored on their own, mvp+ & ++ only
    const plus = COLOR_CODES[colorFromName(str(player, "rankPlusColor")) ?? "red"];

    if (str(player, "monthlyPackageRank") === "SUPERSTAR") { // SUPERSTAR == mvp++
        const base = colorFromName(str(player, "monthlyRankColor")) ?? "gold"; // default to gold
        const code = COLOR_CODES[base];
        return { display: `${code}[MVP${plus}++${code}]`, color: base };
    }

    switch (str(player, "newPackageRank") ?? str(player, "packageRank")) {
        case "MVP_PLUS": return { display: `§b[MVP${plus}+§b]`, color: "aqua" };
        case "MVP": return { display: "§b[MVP]", color: "aqua" };
        case "VIP_PLUS": return { display: "§a[VIP§6+§a]", color: "green" };
        case "VIP": return { display: "§a[VIP]", color: "green" };
        default: return DEFAULT_RANK;
    }
}

// player name + rank
export function formatRankedName(player: HypixelPlayer, name: string): string {
    const rank = getRank(player);
    const colored = COLOR_CODES[rank.color] + (player.displayname ?? name); // fallback to the provided name if username is undefined
    return rank.display ? `${rank.display} ${colored}` : colored;
}
