// handles all hypixel tags (ie. nametags)
// each returns a Tag[] object, containing a [{text, color, tooltip, priority}] for each tag to be rendered (prefix & suffix)
// on top of this, the (usually) prefix contains a "tooltip" field.
// This field is used when hovering over the tag in chat, ie. autodisplayed from either /who or game countdown

// if new tags are made, they should be added to the "hypixelStats" enricher in src/plugins/hypixelStats.ts

import type { Tag } from "../core/types";
import {
    HypixelService,
    bedwarsStats,
    skywarsStats,
    duelsStats,
    uhcStats,
    tntGamesStats,
    murderMysteryStats,
    fishingStats,
    type HypixelPlayer,
} from "../services/hypixel";
import { formatStar, starText, starColor, formatFkdr, fkdrColor } from "../services/bedwars";
import * as sw from "../services/skywars";
import * as duels from "../services/duels";
import * as uhc from "../services/uhc";
import * as tnt from "../services/tntgames";
import * as mm from "../services/murdermystery";
import * as fish from "../services/fishing";
import { COLOR_CODES, type McColorName } from "../util/mcColors";

const c = (color: McColorName, value: string | number) => COLOR_CODES[color] + value;


export const bedwarsTags = (player: HypixelPlayer): Tag[] => {
    const s = bedwarsStats(player);
    if (s.level === 0 && s.finalKills === 0) return []; // never touched bedwars
    const tooltip = [
        `§7Bedwars ${formatStar(s.level)}`,
        `§7FKDR: ${formatFkdr(s.fkdr)}   §7WLR: ${c("white", s.wlr)}`,
        `§7Finals: ${c("white", s.finalKills)}   §7WS: ${c("white", s.winstreak)}`,
        "§8via Hypixel API",
    ].join("\n");
    return [
        { text: starText(s.level), short: starText(s.level), formatted: formatStar(s.level), color: starColor(s.level), prefix: true, tooltip, priority: 20, game: "bedwars" },
        { text: `${s.fkdr}`, short: `${s.fkdr}`, formatted: formatFkdr(s.fkdr), color: fkdrColor(s.fkdr), tooltip, priority: 10, game: "bedwars" },
    ];
};

export const skywarsTags = (player: HypixelPlayer): Tag[] => {
    const s = skywarsStats(player);
    if (s.level === 0 && s.kills === 0) return [];
    const tooltip = [
        `§7SkyWars ${s.levelFormatted}`,
        `§7KDR: ${sw.formatKdr(s.kdr)}   §7WLR: ${c("white", s.wlr)}`,
        `§7Wins: ${c("white", s.wins)}   §7Kills: ${c("white", s.kills)}`,
        "§8via Hypixel API",
    ].join("\n");
    return [
        // a player with kills but no levelFormatted would otherwise render an
        // empty bracket segment, e.g. "[ | 4.2] Name"
        ...(s.levelFormatted
            ? [{ text: s.levelText, short: s.levelText, formatted: s.levelFormatted, color: sw.levelColor(s.levelFormatted), prefix: true, tooltip, priority: 20, game: "skywars" } as Tag]
            : []),
        { text: `${s.kdr}`, short: `${s.kdr}`, formatted: sw.formatKdr(s.kdr), color: sw.kdrColor(s.kdr), tooltip, priority: 10, game: "skywars" },
    ];
};

export const duelsTags = (player: HypixelPlayer): Tag[] => {
    const s = duelsStats(player);
    if (s.wins === 0 && s.losses === 0) return [];
    const tooltip = [
        `§7Duels ${duels.formatWins(s.wins)}`,
        `§7WLR: ${duels.formatWlr(s.wlr)}   §7KDR: ${c("white", s.kdr)}`,
        `§7Winstreak: ${c("white", s.winstreak)}`,
        "§8via Hypixel API",
    ].join("\n");
    return [
        { text: duels.winsText(s.wins), short: duels.winsText(s.wins), formatted: duels.formatWins(s.wins), color: duels.winsColor(s.wins), prefix: true, tooltip, priority: 20, game: "duels" },
        { text: `${s.wlr}`, short: `${s.wlr}`, formatted: duels.formatWlr(s.wlr), color: duels.wlrColor(s.wlr), tooltip, priority: 10, game: "duels" },
    ];
};

export const uhcTags = (player: HypixelPlayer): Tag[] => {
    const s = uhcStats(player);
    if (s.wins === 0 && s.kills === 0) return [];
    const tooltip = [
        `§7UHC ${uhc.formatWins(s.wins)} §8(score ${s.score})`,
        `§7KDR: ${uhc.formatKdr(s.kdr)}   §7Kills: ${c("white", s.kills)}   §7Deaths: ${c("white", s.deaths)}`,
        `§7Heads eaten: ${c("white", s.headsEaten)}`,
        "§8via Hypixel API",
    ].join("\n");
    return [
        { text: uhc.winsText(s.wins), short: uhc.winsText(s.wins), formatted: uhc.formatWins(s.wins), color: uhc.winsColor(s.wins), prefix: true, tooltip, priority: 20, game: "uhc" },
        { text: `${s.kdr}`, short: `${s.kdr}`, formatted: uhc.formatKdr(s.kdr), color: uhc.kdrColor(s.kdr), tooltip, priority: 10, game: "uhc" },
    ];
};

export const tntgamesTags = (player: HypixelPlayer): Tag[] => {
    const s = tntGamesStats(player);
    if (s.wins === 0) return [];
    const tooltip = [
        `§7TNT Games ${tnt.formatWins(s.wins)} §8(streak ${s.winstreak})`,
        `§7TNT Run: ${tnt.formatTntRun(s.tntRun)}   §7PvP Run: ${c("white", s.pvpRun)}`,
        `§7Wizards: ${c("white", s.wizards)}   §7Bow Spleef: ${c("white", s.bowSpleef)}   §7TNT Tag: ${c("white", s.tntTag)}`,
        "§8via Hypixel API",
    ].join("\n");
    return [
        { text: tnt.winsText(s.wins), short: tnt.winsText(s.wins), formatted: tnt.formatWins(s.wins), color: tnt.winsColor(s.wins), prefix: true, tooltip, priority: 20, game: "tntgames" },
        { text: tnt.tntRunText(s.tntRun), short: tnt.tntRunText(s.tntRun), formatted: tnt.formatTntRun(s.tntRun), color: tnt.tntRunColor(s.tntRun), tooltip, priority: 10, game: "tntgames" },
    ];
};

export const murdermysteryTags = (player: HypixelPlayer): Tag[] => {
    const s = murderMysteryStats(player);
    if (s.wins === 0 && s.games === 0) return [];
    const tooltip = [
        `§7Murder Mystery ${mm.formatWins(s.wins)} §8(${s.games} games)`,
        `§7WLR: ${mm.formatWlr(s.wlr)}   §7KDR: ${c("white", s.kdr)}`,
        `§7As murderer: ${c("white", s.murdererWins)}   §7As detective: ${c("white", s.detectiveWins)}`,
        "§8via Hypixel API",
    ].join("\n");
    return [
        { text: mm.winsText(s.wins), short: mm.winsText(s.wins), formatted: mm.formatWins(s.wins), color: mm.winsColor(s.wins), prefix: true, tooltip, priority: 20, game: "murdermystery" },
        { text: `${s.wlr}`, short: `${s.wlr}`, formatted: mm.formatWlr(s.wlr), color: mm.wlrColor(s.wlr), tooltip, priority: 10, game: "murdermystery" },
    ];
};

// handle a custom nick tag. via says which of the two ways we worked it
// out, since one of them never touches the api
export const nickTags = (via: string): Tag[] => [
    {
        text: "NICK",
        short: "NICK",
        formatted: c("red", "NICK"),
        color: "red",
        prefix: true,
        priority: 100,
        tooltip: ["§cNicked", "§7No account behind this name", `§8${via}`].join("\n"),
    },
];

export const fishingTags = (player: HypixelPlayer): Tag[] => {
    const s = fishingStats(player);
    if (!s || s.totalCatches === 0) return [];
    const areas = Object.entries(s.areas)
        .map(([name, a]) => `§7${name[0].toUpperCase()}${name.slice(1)}: ${c("white", a.fishCaught.toLocaleString())}`)
        .join("   ");
    const tooltip = [
        `§7Fishing ${fish.formatMythical(s.mythicalCaught)} §8(${s.totalCatches.toLocaleString()} catches)`,
        `§7Fish: ${c("white", s.fishCaught.toLocaleString())}   §7Treasure: ${c("white", s.treasureCaught.toLocaleString())}   §7Junk: ${c("white", s.junkCaught.toLocaleString())}`,
        areas,
        `§7Special: ${c("white", s.specialCaught)}   §7Plants: ${c("white", s.plantsCaught)}`,
        "§8via Hypixel API",
    ].join("\n");
    return [
        { text: fish.mythicalText(s.mythicalCaught), short: fish.mythicalText(s.mythicalCaught), formatted: fish.formatMythical(s.mythicalCaught), color: fish.mythicalColor(s.mythicalCaught), prefix: true, tooltip, priority: 20, game: "lobby" },
        { text: fish.catchesText(s.totalCatches), short: fish.catchesText(s.totalCatches), formatted: fish.formatCatches(s.totalCatches), color: fish.catchesColor(s.totalCatches), tooltip, priority: 10, game: "lobby" },
    ];
};