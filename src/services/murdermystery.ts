import { COLOR_CODES, type McColorName } from "../util/mcColors";

// murder mystery games are quick and everyone in the lobby that survives wins,
// so win counts climb faster than bedwars but slower than tnt
const WIN_TIERS: Array<[limit: number, color: McColorName]> = [
    [50, "gray"],
    [150, "white"],
    [400, "gold"],
    [1000, "aqua"],
    [2500, "dark_green"],
    [5000, "dark_red"],
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

// only one player is the murderer, so most games are losses - the ladder runs
// much lower than the other games wlr
const WLR_TIERS: Array<[limit: number, color: McColorName]> = [
    [0.2, "gray"],
    [0.4, "white"],
    [0.7, "yellow"],
    [1.2, "light_purple"],
    [2, "red"],
    [3, "dark_red"],
    [Infinity, "dark_purple"],
];

export function wlrColor(wlr: number): McColorName {
    for (const [limit, color] of WLR_TIERS) {
        if (wlr < limit) return color;
    }
    return "dark_purple";
}

export function formatWlr(wlr: number): string {
    return COLOR_CODES[wlrColor(wlr)] + wlr;
}
