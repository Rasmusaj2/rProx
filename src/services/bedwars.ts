import { COLOR_CODES, type McColorName } from "../util/mcColors";


// PRESTIGE STAR COLORING
// Slumber 2.0 lets you pick custom prestige stuff but idk how it works yet
// so for now im just doing the old default colors the way im used to seeing them
const PRESTIGE_CYCLE: McColorName[] = [
    "gray",
    "white",
    "gold",
    "aqua",
    "dark_green",
    "dark_aqua",
    "dark_red",
    "light_purple",
    "blue",
    "dark_purple",
];

const RAINBOW_COLORS: McColorName[] = [
    "red",
    "gold",
    "yellow",
    "green",
    "aqua",
    "light_purple",
];

// might have to update the star symbols idk the new ones
function starSymbol(level: number): string {
  if (level < 1000) return "✫";
  if (level < 2000) return "✪";
  if (level < 3000) return "⚝";
  return "✥";
}

function isGradient(level: number): boolean {
  return (level >= 1000 && level < 1100) || level >= 2000;
}

export function starColor(level: number): McColorName {
    if (isGradient(level)) return "gray"; // placeholder for gradient
    return PRESTIGE_CYCLE[Math.floor((level % 1000) / 100)] ?? "gray";
}

// colorcodeless
export function starText(level: number): string {
    return starSymbol(level) + level.toString();
}

// colorized
export function formatStar(level: number): string {
    const text = starSymbol(level) + level.toString();
    if (isGradient(level)) return [...text].map((char, i) => COLOR_CODES[RAINBOW_COLORS[i % RAINBOW_COLORS.length]] + char).join("");
    return COLOR_CODES[starColor(level)] + text;
}

// randomly selected thresholds for "danger" coloring
// to be changed

const FKDR_TIERS: Array<[limit: number, color: McColorName]> = [
    [0.75, "gray"],
    [1.5, "white"],
    [3, "yellow"],
    [7, "light_purple"],
    [15, "red"],
    [35, "dark_red"],
    [Infinity, "dark_purple"]
]

export function fkdrColor(fkdr: number): McColorName {
    for (const [limit, color] of FKDR_TIERS) {
        if (fkdr < limit) return color; // this should always return a color since the last limit is Infinity but my linter doesnt like it
    }
    return "dark_purple"; // fallback for linter stuff
}

// format properly with colors
export function formatFkdr(fkdr: number): string {
    return COLOR_CODES[fkdrColor(fkdr)] + fkdr;
}
