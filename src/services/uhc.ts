import { COLOR_CODES, type McColorName } from "../util/mcColors";

// uhc wins are far rarer than duels or bedwars - a few hundred is already top tier,
// so the ladder sits much lower than the other games
const WIN_TIERS: Array<[limit: number, color: McColorName]> = [
    [5, "gray"],
    [15, "white"],
    [40, "gold"],
    [100, "aqua"],
    [250, "dark_green"],
    [500, "dark_red"],
    [Infinity, "dark_purple"],
];

export function winsColor(wins: number): McColorName {
    for (const [limit, color] of WIN_TIERS) {
        if (wins < limit) return color;
    }
    return "dark_purple";
}

export function winsText(wins: number): string {
    return wins.toString() + "W";
}

export function formatWins(wins: number): string {
    return COLOR_CODES[winsColor(wins)] + winsText(wins);
}

const KDR_TIERS: Array<[limit: number, color: McColorName]> = [
    [0.75, "gray"],
    [1.5, "white"],
    [2.5, "yellow"],
    [4, "light_purple"],
    [6, "red"],
    [10, "dark_red"],
    [Infinity, "dark_purple"],
];

export function kdrColor(kdr: number): McColorName {
    for (const [limit, color] of KDR_TIERS) {
        if (kdr < limit) return color;
    }
    return "dark_purple";
}

export function formatKdr(kdr: number): string {
    return COLOR_CODES[kdrColor(kdr)] + kdr;
}
