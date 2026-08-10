import { COLOR_CODES, type McColorName } from "../util/mcColors";
import type { HypixelPlayer } from "./hypixel";
import { tierColor, type Thresholds } from "./thresholds";

export type Raw = Record<string, any>;

export function block(player: HypixelPlayer, game: string): Raw {
    const raw = player.stats?.[game];
    return raw && typeof raw === "object" ? raw : {};
}

export function inner(raw: Raw, ...path: string[]): Raw {
    let at: unknown = raw;
    for (const key of path) {
        at = (at as Raw | undefined)?.[key];
        if (!at || typeof at !== "object") return {};
    }
    return at as Raw;
}

export function num(raw: Raw, ...keys: string[]): number {
    for (const key of keys) {
        const value = raw[key];
        if (typeof value === "number" && Number.isFinite(value)) return value;
    }
    return 0;
}

export function total(raw: Raw, ...keys: string[]): number {
    return keys.reduce((sum, key) => sum + num(raw, ...key.split("|")), 0);
}


export function allWins(raw: Raw): number {
    let total = 0;
    for (const [key, value] of Object.entries(raw)) {
        if (typeof value === "number" && /^wins(_|$)/.test(key)) total += value;
        // the newer modes keep their own object instead of a wins_ counter, and
        // some of them (disasters) put another "stats" in between, so the wins
        // sit one level further down again
        else if (value && typeof value === "object") {
            total += num(value as Raw, "wins") + num(inner(value as Raw, "stats"), "wins");
        }
    }
    return total;
}

// avoid wasting a space on the end of a string if there is no label to append
const labeled = (text: string, label: string) => (label ? `${text} ${label}` : text);

// 12400 to "12.4k". ratios and small counts are left alone
export function compact(value: number, suffix = ""): string {
    const trim = (n: number) => n.toFixed(1).replace(/\.0$/, "");
    if (Math.abs(value) >= 1_000_000) return labeled(`${trim(value / 1_000_000)}m`, suffix);
    if (Math.abs(value) >= 1_000) return labeled(`${trim(value / 1_000)}k`, suffix);
    return labeled(`${value}`, suffix);
}

// a stat in the forms a tag renders from
export interface Stat {
    text: string; // label (ie. "W" for wins)
    short: string; // compacted form, ie. 12400 to "12.4k"
    formatted: string; // pre-colored legacy string
    color: McColorName;
}

export interface StatSpec {
    label?: string; // trailing letter (ie. "W" for wins, "L" for losses)
    short?: boolean; // should shorten be used for the text, ie. 12400 to "12.4k"
    text?: string; // override the whole thing, e.g. a star
    formatted?: string;
    color?: McColorName; // when the value doesnt drive its own color
}

// the one constructor every stat goes through
export function stat(value: number, tiers: Thresholds, spec: StatSpec = {}): Stat {
    const color = spec.color ?? tierColor(value, tiers);
    const label = spec.label ?? "";
    const text = spec.text ?? (spec.short ? compact(value, label) : labeled(`${value}`, label));
    return {
        text,
        short: spec.text ?? compact(value, label),
        formatted: spec.formatted ?? COLOR_CODES[color] + text,
        color,
    };
}

// a value hypixel renders itself (stars, skywars levels), so it brings its own
// color along and there is no ladder to read
export function ownStat(text: string, formatted: string, color: McColorName): Stat {
    return { text, short: text, formatted, color };
}
