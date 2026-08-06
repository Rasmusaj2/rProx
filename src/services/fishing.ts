import { COLOR_CODES, type McColorName } from "../util/mcColors";
import { MYTHICAL_FANCY_NAMES, MYTHICAL_ORB_WEIGHTS } from "./hypixel";

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


// fishing session handling stuff
// counted off chat messages, so the session can be updated without api calls (also cause paused api, etc.)

export type CatchKind = "fish" | "treasure" | "junk" | "plant" | "creature" | "mythical";

export const CATCH_KINDS: readonly CatchKind[] = ["fish", "treasure", "junk", "plant", "creature", "mythical"];

export const CATCH_LABELS: Record<CatchKind, string> = {
    fish: "Fish",
    treasure: "Treasure",
    junk: "Junk",
    plant: "Plants",
    creature: "Creatures",
    mythical: "Mythical",
};

export type CatchTotals = Record<CatchKind, number>;

export interface MythicalTally {
    count: number;
    heaviest: number;
}
export type MythicalTotals = Record<string, MythicalTally>;

export function emptyTotals(): CatchTotals {
    return { fish: 0, treasure: 0, junk: 0, plant: 0, creature: 0, mythical: 0 };
}

export function totalCatches(totals: CatchTotals): number {
    return CATCH_KINDS.reduce((sum, kind) => sum + totals[kind], 0);
}


const CODE = String.raw`(?:§[0-9a-fk-or])*`; // color codes regex for plant detection (well every kind of but plant)

// regex builder for the plant/creature/fish catches, which are all color coded and don't have a weight
const caught = (color: string, item = String.raw`[^\d].+?`) =>
    new RegExp(String.raw`^${CODE}You caught(?: an?)? ${CODE}§${color}(${item})${CODE}§7!`, "i");

const MYTHICAL_ITEM = new RegExp(
    String.raw`(?:([\d.,]+)\s*kg\s*${CODE}\s*)?${CODE}(${Object.values(MYTHICAL_FANCY_NAMES).join("|")})\b`,
    "i",
);

// first match wins, no longer needed that much since we do color codes for most of the matching now instead of using item names for plants as before
// anyways these new regex patterns are stolen from sharkeys fishing utils (kind of). idk how to give proper credit
const CATCH_PATTERNS = new Map<RegExp, CatchKind>([
    [new RegExp(String.raw`^${CODE}Oh no, you caught(?: an?)? ${CODE}§c(.+?)${CODE}§7!`, "i"), "junk"],
    [new RegExp(String.raw`^${CODE}You caught(?: an?)? ${CODE}§a(.+?)${CODE}§7, that'?s a treasure!`, "i"), "treasure"],
    [new RegExp(String.raw`^${CODE}You caught a ${CODE}§f(\d+)kg ${CODE}§\w(.*?)${CODE}§7!`, "i"), "mythical"],
    [new RegExp(String.raw`^${CODE}You caught ${CODE}§\w(\d{1,3} .+?)${CODE}§7!`, "i"), "treasure"],
    // the color is the whole rule, so this holds for every plant and creature
    // there is without anybody having to know the names of them
    [caught("2"), "plant"],
    [caught("b"), "creature"],
    [caught("e"), "fish"],
]);

const ORB_BY_NAME = new Map(
    Object.entries(MYTHICAL_FANCY_NAMES).map(([orb, name]) => [name.toLowerCase(), orb]) 
);

export interface Catch {
    kind: CatchKind;
    orb?: string; // mythicals only, the key MYTHICAL_FANCY_NAMES is written in
    weight?: number; // kg, mythicals are the only catch that rolls one
}

// null for any line that is not a catch. colors no longer stripped
export function parseCatch(formatted: string): Catch | null {
    const line = formatted.trim();
    for (const [pattern, kind] of CATCH_PATTERNS) {
        if (!pattern.test(line)) continue;
        if (kind !== "mythical") return { kind };

        // worth knowing which orb it was and how heavy, //session shows both
        const item = MYTHICAL_ITEM.exec(line);
        if (!item) return { kind };
        const weight = Number(item[1]?.replace(/,/g, ""));
        return {
            kind,
            orb: ORB_BY_NAME.get(item[2].toLowerCase()),
            weight: Number.isFinite(weight) ? weight : undefined,
        };
    }
    return null;
    }

// keep highest weight orb
export function recordMythical(totals: MythicalTotals, orb: string, weight?: number): void {
    const tally = (totals[orb] ??= { count: 0, heaviest: 0 });
    tally.count++;
    if (weight && weight > tally.heaviest) tally.heaviest = weight;
}

export function mythicalName(orb: string): string {
    return MYTHICAL_FANCY_NAMES[orb] ?? orb;
}

// render tooltop for hover over
export function mythicalTooltip(totals: MythicalTotals): string {
    const lines = Object.entries(totals)
        .sort((a, b) => b[1].count - a[1].count)
        .map(([orb, tally]) => {
            // gold on the weight means they topped that orbs range this session
            const best = tally.heaviest ? ` §8(best ${formatWeight(orb, tally.heaviest)}§8)` : "";
            return `§7${mythicalName(orb)}: §f${tally.count}${best}`;
        });
    return lines.join("\n");
}

// hold spacing to allow a couple catches before showing catch/hour
const RATE_WARMUP_MS = 30_000;

export function formatCount(value: number): string {
    return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function formatRate(count: number, elapsedMs: number): string {
    if (elapsedMs < RATE_WARMUP_MS) return "-";
    const perHour = (count * 3_600_000) / elapsedMs;
    return perHour >= 100 ? formatCount(Math.round(perHour)) : perHour.toFixed(1);
}

export function formatElapsed(elapsedMs: number): string {
    const seconds = Math.floor(elapsedMs / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours) return `${hours}h ${minutes}m`;
    return minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}
