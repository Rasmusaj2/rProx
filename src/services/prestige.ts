// stars calc + prestige colors for bedwars (and wool games)
import { COLOR_CODES, type McColorName } from "../util/mcColors";
import { ownStat, type Raw, type Stat, num } from "./games";

// PRESTIGE STAR COLORING
// Slumber 2.0 lets you pick custom prestige stuff but idk how it works yet
// so for now im just doing the old default colors the way im used to seeing them
// also this prestiging is used universally (wool wars)
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

// which hundred the level sits in picks the color, same for every game
function cycleColor(level: number): McColorName {
    return PRESTIGE_CYCLE[Math.floor((level % 1000) / 100)] ?? "gray";
}

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
    return cycleColor(level);
}

// bedwars, the only star with rainbow prestiges to worry about
export function bedwarsStar(level: number): Stat {
    const text = starSymbol(level) + level.toString();
    const formatted = isGradient(level)
        ? [...text].map((char, i) => COLOR_CODES[RAINBOW_COLORS[i % RAINBOW_COLORS.length]] + char).join("")
        : COLOR_CODES[starColor(level)] + text;
    return ownStat(text, formatted, starColor(level));
}

// WOOL GAMES
// levels come out of stats.WoolGames.progression.experience rather than being
// handed to us from an AP
const WOOL_EASY_XP = [1000, 2000, 3000, 4000]; // i think these are the numbers
const WOOL_XP_PER_LEVEL = 5000;

export function woolLevel(experience: number): number {
    let left = Math.max(0, experience);
    let level = 1;
    for (const cost of WOOL_EASY_XP) {
        if (left < cost) return level;
        left -= cost;
        level++;
    }
    return level + Math.floor(left / WOOL_XP_PER_LEVEL);
}

// every wool games mode leads with this same star, none of them have a level of
// their own to show
export function woolStar(progression: Raw): Stat {
    const level = woolLevel(num(progression, "experience"));
    const text = `✫${level}`;
    return ownStat(text, COLOR_CODES[cycleColor(level)] + text, cycleColor(level));
}
