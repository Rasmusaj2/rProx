import { COLOR_CODES, type McColorName } from "../util/mcColors";

// duels has no star to lean on, using wins as sudo "levels"
// roughly where the ingame division titles sit.
const WIN_TIERS: Array<[limit: number, color: McColorName]> = [
    [100, "gray"],
    [500, "white"],
    [1000, "gold"],
    [2000, "aqua"],
    [5000, "dark_green"],
    [10000, "dark_red"],
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

const WLR_TIERS: Array<[limit: number, color: McColorName]> = [
    [0.75, "gray"],
    [1.5, "white"],
    [2.5, "yellow"],
    [4, "light_purple"],
    [6, "red"],
    [10, "dark_red"],
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
