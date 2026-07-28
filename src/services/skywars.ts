import { COLOR_CODES, firstColor, type McColorName } from "../util/mcColors";

export function levelColor(levelFormatted: string): McColorName {
    return firstColor(levelFormatted) ?? "gray";
}

// same idea as the fkdr tiers, thresholds picked by feel
const KDR_TIERS: Array<[limit: number, color: McColorName]> = [
    [0.75, "gray"],
    [1.5, "white"],
    [3, "yellow"],
    [5, "light_purple"],
    [8, "red"],
    [12, "dark_red"],
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
