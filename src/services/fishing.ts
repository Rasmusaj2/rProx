import { COLOR_CODES, type McColorName } from "../util/mcColors";
import { MYTHICAL_ORB_WEIGHTS } from "./hypixel";

// weight stuff blah blah
export function weightColor(orb: string, weight: number): McColorName {
    const range = MYTHICAL_ORB_WEIGHTS[orb];
    if (!range) return "white";
    const [min, max] = range;
    if (weight >= max) return "gold";
    return weight >= (min + max) / 2 ? "white" : "gray";
}

export function formatWeight(orb: string, weight: number): string {
    return COLOR_CODES[weightColor(orb, weight)] + weight + "kg";
}

// mythical catches are the headline number, so the ladder is built around them
const FISHING_TIERS: Array<[limit: number, color: McColorName]> = [
    [100, "gray"],
    [500, "white"],
    [1000, "gold"],
    [2000, "aqua"],
    [5000, "dark_green"],
    [10000, "dark_red"],
    [Infinity, "dark_purple"],
];

export function mythicalColor(mythical: number): McColorName {
    for (const [limit, color] of FISHING_TIERS) {
        if (mythical < limit) return color;
    }
    return "dark_purple";
}

// counts get big enough to blow the 16 char team prefix budget, so shorten them
function compact(value: number, suffix: string): string {
    if (value < 10_000) return value.toString() + suffix;
    return (value / 1000).toFixed(1).replace(/\.0$/, "") + "k" + suffix;
}

export function mythicalText(mythical: number): string {
    return compact(mythical, " M");
}

export function formatMythical(mythical: number): string {
    return COLOR_CODES[mythicalColor(mythical)] + mythicalText(mythical);
}

// everything reeled in, which is mostly a measure of hours spent rather than luck
const CATCH_TIERS: Array<[limit: number, color: McColorName]> = [
    [500, "gray"],
    [2500, "white"],
    [10000, "gold"],
    [25000, "aqua"],
    [60000, "dark_green"],
    [150000, "dark_red"],
    [Infinity, "dark_purple"],
];

export function catchesColor(catches: number): McColorName {
    for (const [limit, color] of CATCH_TIERS) {
        if (catches < limit) return color;
    }
    return "dark_purple";
}

export function catchesText(catches: number): string {
    return compact(catches, " C");
}

export function formatCatches(catches: number): string {
    return COLOR_CODES[catchesColor(catches)] + catchesText(catches);
}
