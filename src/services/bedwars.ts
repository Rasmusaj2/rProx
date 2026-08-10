import { COLOR_CODES, type McColorName } from "../util/mcColors";
import { BEDWARS_FKDR, tierColor, tierFormat } from "./thresholds";

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
    // no room for per-char codes inside a single team prefix (16 chars)
    if (isGradient(level)) return RAINBOW_COLORS[0];
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

export function fkdrColor(fkdr: number): McColorName {
    return tierColor(fkdr, BEDWARS_FKDR);
}

// format properly with colors
export function formatFkdr(fkdr: number): string {
    return tierFormat(fkdr, BEDWARS_FKDR);
}
