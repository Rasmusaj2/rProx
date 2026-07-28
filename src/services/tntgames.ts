import { COLOR_CODES, type McColorName } from "../util/mcColors";

// tnt games racks up wins fast since rounds are short
const WIN_TIERS: Array<[limit: number, color: McColorName]> = [
    [50, "gray"],
    [200, "white"],
    [500, "gold"],
    [1500, "aqua"],
    [3000, "dark_green"],
    [6000, "dark_red"],
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

// there is no ratio to show here - tnt games reports no losses and keeps kills
// and deaths per mode only - so the trailing slot gets tnt run wins, the mode
// most of the playerbase actually sits in
const TNT_RUN_TIERS: Array<[limit: number, color: McColorName]> = [
    [25, "gray"],
    [100, "white"],
    [250, "gold"],
    [750, "aqua"],
    [1500, "dark_green"],
    [3000, "dark_red"],
    [Infinity, "dark_purple"],
];

export function tntRunColor(wins: number): McColorName {
    for (const [limit, color] of TNT_RUN_TIERS) {
        if (wins < limit) return color;
    }
    return "dark_purple";
}

export function tntRunText(wins: number): string {
    return wins.toString() + "R";
}

export function formatTntRun(wins: number): string {
    return COLOR_CODES[tntRunColor(wins)] + tntRunText(wins);
}
