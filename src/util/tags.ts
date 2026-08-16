// handles all hypixel tags (ie. nametags)
// each returns a Tag[] object, containing a [{text, color, tooltip, priority}] for each tag to be rendered (prefix & suffix)
// on top of this, the (usually) prefix contains a "tooltip" field.
// This field is used when hovering over the tag in chat, ie. autodisplayed from either /who or game countdown
//
// allTags() is what the enricher calls, so a new game only has to be reachable
// from there - nothing else needs touching

import type { Tag } from "../core/types";
import type { GameMode } from "../core/game";
import {
    bedwarsStats,
    skywarsStats,
    duelsStats,
    uhcStats,
    tntGamesStats,
    murderMysteryStats,
    fishingStats,
    ratio,
    type HypixelPlayer,
} from "../services/hypixel";
import { allWins, block, compact, inner, num, ownStat, stat, total, type Raw, type Stat } from "../services/games";
import { bedwarsStar, woolStar } from "../services/prestige";
import * as tiers from "../services/thresholds";
import type { Thresholds } from "../services/thresholds";
import { COLOR_CODES, firstColor } from "../util/mcColors";

const w = (value: string | number) => COLOR_CODES.white + value; // §7Label: §fvalue
const VIA = "§8via Hypixel API";

// the pair of prefix and suffix tags for a game, with the tooltip and priority set
// tooltip for the prefix will be shown when hovered over in chat
function gameTags(game: GameMode, tooltip: string[], head?: Stat, trail?: Stat): Tag[] {
    const hover = [...tooltip, VIA].join("\n");
    const one = (s: Stat, prefix: boolean): Tag => ({
        text: s.text,
        short: s.short,
        formatted: s.formatted,
        color: s.color,
        prefix,
        tooltip: hover,
        priority: prefix ? 20 : 10,
        game,
    });
    return [...(head ? [one(head, true)] : []), ...(trail ? [one(trail, false)] : [])];
}

export const nickTags = (via: string): Tag[] => [
    {
        text: "NICK",
        short: "NICK",
        formatted: COLOR_CODES.red + "NICK",
        color: "red",
        prefix: true,
        priority: 100,
        tooltip: ["§cNicked", "§7No account behind this name", `§8${via}`].join("\n"),
    },
];


// GAMES WITH A COMMAND BEHIND THEM
export const bedwarsTags = (player: HypixelPlayer): Tag[] => {
    const s = bedwarsStats(player);
    if (s.level === 0 && s.finalKills === 0) return []; // never touched the game, no tags to show
    const star = bedwarsStar(s.level);
    const fkdr = stat(s.fkdr, tiers.BEDWARS_FKDR);
    return gameTags(
        "bedwars",
        [
            `§7Bedwars ${star.formatted}`,
            `§7FKDR: ${fkdr.formatted}   §7WLR: ${w(s.wlr)}`,
            `§7Finals: ${w(s.finalKills)}   §7WS: ${w(s.winstreak)}`,
        ],
        star,
        fkdr,
    );
};

export const skywarsTags = (player: HypixelPlayer): Tag[] => {
    const s = skywarsStats(player);
    if (s.level === 0 && s.kills === 0) return [];
    const level = s.levelFormatted
        ? ownStat(s.levelText, s.levelFormatted, firstColor(s.levelFormatted) ?? "gray")
        : undefined;
    const kdr = stat(s.kdr, tiers.SKYWARS_KDR);
    return gameTags(
        "skywars",
        [
            `§7SkyWars ${s.levelFormatted || w("no level")}`,
            `§7KDR: ${kdr.formatted}   §7WLR: ${w(s.wlr)}`,
            `§7Wins: ${w(s.wins)}   §7Kills: ${w(s.kills)}`,
        ],
        level,
        kdr,
    );
};

export const duelsTags = (player: HypixelPlayer): Tag[] => {
    const s = duelsStats(player);
    if (s.wins === 0 && s.losses === 0) return [];
    const wins = stat(s.wins, tiers.DUELS_WINS, { label: "W" });
    const wlr = stat(s.wlr, tiers.DUELS_WLR);
    return gameTags(
        "duels",
        [
            `§7Duels ${wins.formatted}${s.division ? ` §8(${s.division.label})` : ""}`,
            `§7WLR: ${wlr.formatted}   §7KDR: ${w(s.kdr)}`,
            s.winstreaksHidden
                ? `§7Winstreak: §8hidden`
                : `§7Winstreak: ${w(s.currentWinstreak)}   §7Best: ${w(s.bestWinstreak)}`,
        ],
        wins,
        wlr,
    );
};

export const uhcTags = (player: HypixelPlayer): Tag[] => {
    const s = uhcStats(player);
    if (s.wins === 0 && s.kills === 0) return [];
    const wins = stat(s.wins, tiers.UHC_WINS, { label: "W" });
    const kdr = stat(s.kdr, tiers.UHC_KDR);
    return gameTags(
        "uhc",
        [
            `§7UHC ${wins.formatted} §8(score ${s.score})`,
            `§7KDR: ${kdr.formatted}   §7Kills: ${w(s.kills)}   §7Deaths: ${w(s.deaths)}`,
            `§7Heads eaten: ${w(s.headsEaten)}`,
        ],
        wins,
        kdr,
    );
};

export const tntgamesTags = (player: HypixelPlayer): Tag[] => {
    const s = tntGamesStats(player);
    if (s.wins === 0) return [];
    const wins = stat(s.wins, tiers.TNT_TOTAL_WINS, { label: "W" });
    const tntRun = stat(s.tntRun, tiers.TNT_RUN_WINS, { label: "R" });
    return gameTags(
        "tntgames",
        [
            `§7TNT Games ${wins.formatted} §8(streak ${s.winstreak})`,
            `§7TNT Run: ${tntRun.formatted}   §7PvP Run: ${w(s.pvpRun)}`,
            `§7Wizards: ${w(s.wizards)}   §7Bow Spleef: ${w(s.bowSpleef)}   §7TNT Tag: ${w(s.tntTag)}`,
        ],
        wins,
    );
};

export const murdermysteryTags = (player: HypixelPlayer): Tag[] => {
    const s = murderMysteryStats(player);
    if (s.wins === 0 && s.games === 0) return [];
    const wins = stat(s.wins, tiers.MM_WINS, { label: "W" });
    const wlr = stat(s.wlr, tiers.MM_WLR);
    return gameTags(
        "murdermystery",
        [
            `§7Murder Mystery ${wins.formatted} §8(${s.games} games)`,
            `§7WLR: ${wlr.formatted}   §7KDR: ${w(s.kdr)}`,
            `§7As murderer: ${w(s.murdererWins)}   §7As detective: ${w(s.detectiveWins)}`,
        ],
        wins,
        wlr,
    );
};

export const fishingTags = (player: HypixelPlayer): Tag[] => {
    const s = fishingStats(player);
    if (!s || s.totalCatches === 0) return [];
    const areas = Object.entries(s.areas)
        .map(([name, a]) => `§7${name[0].toUpperCase()}${name.slice(1)}: ${w(a.fishCaught.toLocaleString())}`)
        .join("   ");
    // both counters run into the tens of thousands, so needs to be shortened constantly
    const mythical = stat(s.mythicalCaught, tiers.FISHING_MYTHICAL, { label: "M", short: true });
    const catches = stat(s.totalCatches, tiers.FISHING_CATCHES, { label: "C", short: true });
    return gameTags(
        "lobby",
        [
            `§7Fishing ${mythical.formatted} §8(${s.totalCatches.toLocaleString()} catches)`,
            `§7Fish: ${w(s.fishCaught.toLocaleString())}   §7Treasure: ${w(s.treasureCaught.toLocaleString())}   §7Junk: ${w(s.junkCaught.toLocaleString())}`,
            areas,
            `§7Special: ${w(s.specialCaught)}   §7Plants: ${w(s.plantsCaught)}`,
        ],
        mythical,
        catches,
    );
};


// WOOL GAMES
// every mode leads with the wool games star
const woolModeTags = (
    player: HypixelPlayer,
    game: GameMode,
    title: string,
    mode: string, // the sub object inside stats.WoolGames
    build: (s: Raw) => { trail: Stat; lines: string[] },
): Tag[] => {
    const wool = block(player, "WoolGames");
    const s = inner(wool, mode, "stats");
    if (Object.keys(s).length === 0) return []; // never played this mode
    const star = woolStar(inner(wool, "progression"));
    const { trail, lines } = build(s);
    return gameTags(game, [`§7${title} ${star.formatted}`, ...lines], star, trail);
};

export const woolwarsTags = (player: HypixelPlayer): Tag[] =>
    woolModeTags(player, "woolwars", "Wool Wars", "wool_wars", (s) => {
        const kdr = stat(ratio(num(s, "kills"), num(s, "deaths")), tiers.WOOL_WARS_KDR);
        return {
            trail: kdr,
            lines: [
                `§7KDR: ${kdr.formatted}   §7Wins: ${w(num(s, "wins"))}   §7Losses: ${w(num(s, "losses"))}`,
                `§7Blocks broken: ${w(compact(num(s, "blocks_broken")))}   §7Wool placed: ${w(compact(num(s, "wool_placed")))}`,
            ],
        };
    });

export const sheepwarsTags = (player: HypixelPlayer): Tag[] =>
    woolModeTags(player, "sheepwars", "Sheep Wars", "sheep_wars", (s) => {
        const kdr = stat(ratio(num(s, "kills"), num(s, "deaths")), tiers.SHEEPWARS_KDR);
        return {
            trail: kdr,
            lines: [
                `§7KDR: ${kdr.formatted}   §7Wins: ${w(num(s, "wins"))}   §7Losses: ${w(num(s, "losses"))}`,
                `§7Sheep thrown: ${w(compact(num(s, "sheep_thrown")))}`,
            ],
        };
    });

export const ctwTags = (player: HypixelPlayer): Tag[] =>
    woolModeTags(player, "ctw", "Capture the Wool", "capture_the_wool", (s) => {
        const kdr = stat(ratio(num(s, "kills"), num(s, "deaths")), tiers.CTW_KDR);
        return {
            trail: kdr,
            lines: [
                `§7KDR: ${kdr.formatted}   §7Wins: ${w(num(s, "participated_wins"))}   §7Losses: ${w(num(s, "participated_losses"))}`,
                `§7Wools captured: ${w(num(s, "wools_captured"))}   §7Gold: ${w(compact(num(s, "gold_earned")))}`,
            ],
        };
    });

// wool games lobby 
export const woolgamesTags = (player: HypixelPlayer): Tag[] => {
    const wool = block(player, "WoolGames");
    const progression = inner(wool, "progression");
    if (Object.keys(progression).length === 0) return [];
    const star = woolStar(progression);
    const ww = inner(wool, "wool_wars", "stats");
    const wins = stat(num(ww, "wins"), tiers.WOOL_WARS_WINS, { label: "W" });
    return gameTags(
        "woolgames",
        [
            `§7Wool Games ${star.formatted}`,
            `§7Wool Wars wins: ${wins.formatted}   §7Losses: ${w(num(ww, "losses"))}`,
            `§7Sheep Wars wins: ${w(num(inner(wool, "sheep_wars", "stats"), "wins"))}   §7CTW wins: ${w(num(inner(wool, "capture_the_wool", "stats"), "participated_wins"))}`,
            `§7Coins: ${w(compact(num(wool, "coins")))}`,
        ],
        star,
        wins,
    );
};

// arcade games hub, rest in SPECS
export const arcadeTags = (player: HypixelPlayer): Tag[] => {
    const raw = block(player, "Arcade");
    const wins = allWins(raw);
    const coins = num(raw, "coins");
    if (wins === 0 && coins === 0) return [];
    const head = stat(wins, tiers.ARCADE_WINS, { label: "W" });
    const purse = stat(coins, tiers.ARCADE_COINS, { label: "C", short: true });
    return gameTags(
        "arcade",
        [
            `§7Arcade ${head.formatted} §8(every mode added up)`,
            `§7Coins: ${purse.formatted}`,
            `§7Zombies: ${w(num(raw, "wins_zombies"))}   §7Party Games: ${w(total(raw, "wins_party", "wins_party_2", "wins_party_3"))}   §7Dropper: ${w(num(inner(raw, "dropper"), "wins"))}`,
        ],
        head,
        purse,
    );
};

// the six classics are separate stat blocks, there is no combined counter
const CLASSICS: Array<[block: string, wins: string[], kills: string[]]> = [
    ["Quake", ["wins", "wins_teams"], ["kills", "kills_teams"]],
    ["Arena", ["wins_1v1", "wins_2v2", "wins_4v4"], ["kills_1v1", "kills_2v2", "kills_4v4"]],
    ["Walls", ["wins"], ["kills"]],
    ["VampireZ", ["human_wins", "vampire_wins"], ["human_kills", "vampire_kills", "zombie_kills"]],
    ["GingerBread", ["wins"], []],
    ["Paintball", ["wins"], ["kills"]],
];

export const classicTags = (player: HypixelPlayer): Tag[] => {
    let wins = 0;
    let kills = 0;
    for (const [name, winKeys, killKeys] of CLASSICS) {
        const raw = block(player, name);
        wins += total(raw, ...winKeys)
    }
    if (wins === 0 && kills === 0) return [];
    const head = stat(wins, tiers.CLASSIC_WINS, { label: "W" });
    const kill = stat(kills, tiers.CLASSIC_KILLS, { label: "K", short: true });
    return gameTags(
        "classic",
        [
            `§7Classic Games ${head.formatted}`,
            `§7Kills: ${kill.formatted}`,
            `§7Quake: ${w(total(block(player, "Quake"), "wins", "wins_teams"))}   §7Paintball: ${w(num(block(player, "Paintball"), "wins"))}   §7Walls: ${w(num(block(player, "Walls"), "wins"))}`,
        ],
        head,
    );
};


// EVERYTHING ELSE, AS DATA

// hypixel renamed between updates
interface Count {
    label: string; // tooltip label
    keys: string[];
    tiers?: Thresholds; // needed on the two that become tags
    mark?: string; // letter worn after the number, e.g. "W" for wins
    big?: boolean; // shorten the long form too, for counters that run huge
}

// a ratio worked out from two other counters, e.g. kills over deaths
interface Ratio {
    label: string;
    over: string[];
    under: string[];
    less?: boolean; // under is a total the numerator is part of (games played)
    tiers?: Thresholds;
}

type Value = Count | Ratio;
type Tagged = Value & { tiers: Thresholds };

interface GameSpec {
    title: string; // heads the tooltip
    block: string; // stats.<block>
    path?: string[]; // deeper in, e.g. ["dropper"] for the nested arcade modes
    head: Tagged; // bracketed in front of the name
    trail?: Tagged; // trailing the name
    lines?: Value[]; // extra tooltip numbers, drawn white, three to a row
}

function read(raw: Raw, value: Value): number {
    if ("keys" in value) return total(raw, ...value.keys);
    const over = total(raw, ...value.over);
    const under = total(raw, ...value.under);
    return ratio(over, value.less ? Math.max(0, under - over) : under);
}

const asStat = (raw: Raw, value: Tagged): Stat =>
    stat(read(raw, value), value.tiers, "keys" in value ? { label: value.mark, short: value.big } : {});

// auto-generates the tooltip and prefix/suffix tags for a game, given the spec defined in SPECS
function specTags(player: HypixelPlayer, game: GameMode, spec: GameSpec): Tag[] {
    const raw = spec.path ? inner(block(player, spec.block), ...spec.path) : block(player, spec.block);
    const headValue = read(raw, spec.head);
    const trailValue = spec.trail ? read(raw, spec.trail) : 0;
    if (headValue === 0 && trailValue === 0) return []; // never played

    const head = asStat(raw, spec.head);
    const trail = spec.trail ? asStat(raw, spec.trail) : undefined;
    const cells = [
        ...(spec.trail && trail ? [`§7${spec.trail.label}: ${trail.formatted}`] : []),
        ...(spec.lines ?? []).map((value) => {
            const number = read(raw, value);
            return `§7${value.label}: ${w("keys" in value && value.big ? compact(number) : number)}`;
        }),
    ];
    const rows: string[] = [];
    for (let i = 0; i < cells.length; i += 3) rows.push(cells.slice(i, i + 3).join("   "));
    return gameTags(game, [`§7${spec.title} ${head.formatted}`, ...rows], head, trail);
}

// shorthands
const wins = (tier: Thresholds, ...keys: string[]): Tagged => ({ label: "Wins", keys, tiers: tier, mark: "W" });
const kdr = (tier: Thresholds, kills = "kills", deaths = "deaths"): Tagged => ({
    label: "KDR",
    over: [kills],
    under: [deaths],
    tiers: tier,
});

const count = (label: string, key: string, big = false): Count => ({ label, keys: [key], big });

// keyed by the game the tags belong to, so nothing has to repeat it
const SPECS = {
    // single mode games
    blitz: {
        title: "Blitz SG",
        block: "HungerGames",
        head: wins(tiers.BLITZ_WINS, "wins", "wins_teams"),
        trail: kdr(tiers.BLITZ_KDR),
        lines: [count("Kills", "kills"), count("Deaths", "deaths"), count("Coins", "coins", true)],
    },
    buildbattle: {
        title: "Build Battle",
        block: "BuildBattle",
        head: wins(tiers.BUILDBATTLE_WINS, "wins"),
        trail: { label: "Score", keys: ["score"], tiers: tiers.BUILDBATTLE_SCORE, mark: "S", big: true },
        lines: [count("Games", "games_played"), count("Guesses", "correct_guesses"), count("Pro wins", "wins_solo_pro")],
    },
    guessthebuild: {
        title: "Guess the Build",
        block: "BuildBattle",
        head: wins(tiers.GUESSTHEBUILD_WINS, "wins_guess_the_build"),
        trail: { label: "Score", keys: ["score_guess_the_build"], tiers: tiers.GUESSTHEBUILD_SCORE, mark: "S", big: true },
        lines: [count("Games", "games_played_guess_the_build"), count("Guesses", "correct_guesses_guess_the_build")],
    },
    cvc: {
        title: "Cops and Crims",
        block: "MCGO",
        head: wins(tiers.CVC_WINS, "game_wins"),
        trail: kdr(tiers.CVC_KDR),
        lines: [count("Kills", "kills"), count("Deaths", "deaths"), count("Headshots", "headshot_kills")],
    },
    megawalls: {
        title: "Mega Walls",
        block: "Walls3",
        head: wins(tiers.MEGAWALLS_WINS, "wins"),
        trail: { label: "FKDR", over: ["final_kills"], under: ["final_deaths"], tiers: tiers.MEGAWALLS_FKDR },
        lines: [count("Finals", "final_kills"), count("Kills", "kills"), count("Losses", "losses")],
    },
    smashheroes: {
        title: "Smash Heroes",
        block: "SuperSmash",
        head: { label: "Level", keys: ["smashLevel"], tiers: tiers.SMASH_LEVEL },
        trail: kdr(tiers.SMASH_KDR),
        lines: [count("Wins", "wins"), count("Kills", "kills"), count("Deaths", "deaths")],
    },
    warlords: {
        title: "Warlords",
        block: "Battleground",
        head: wins(tiers.WARLORDS_WINS, "wins"),
        trail: kdr(tiers.WARLORDS_KDR),
        lines: [count("Losses", "losses"), count("Kills", "kills"), count("Assists", "assists")],
    },

    // uhc
    speeduhc: {
        title: "Speed UHC",
        block: "SpeedUHC",
        head: wins(tiers.SPEEDUHC_WINS, "wins"),
        trail: kdr(tiers.SPEEDUHC_KDR),
        lines: [count("Score", "score"), count("Kills", "kills"), count("Winstreak", "winstreak|highestWinstreak")],
    },

    // tnt games, one row per mode. the trailing slot is the whole games win
    // count, since a single mode has no ratio to put there
    tntrun: {
        title: "TNT Run",
        block: "TNTGames",
        head: wins(tiers.TNT_RUN_WINS, "wins_tntrun"),
        lines: [count("Record", "record_tntrun"), count("PvP Run", "wins_pvprun")],
    },
    tnttag: {
        title: "TNT Tag",
        block: "TNTGames",
        head: wins(tiers.TNTTAG_WINS, "wins_tntag"),
        lines: [count("Kills", "kills_tntag"), count("TNT Run", "wins_tntrun")],
    },
    pvprun: {
        title: "PvP Run",
        block: "TNTGames",
        head: wins(tiers.PVPRUN_WINS, "wins_pvprun"),
        lines: [count("Kills", "kills_pvprun"), count("Deaths", "deaths_pvprun")],
    },
    tntwizards: {
        title: "TNT Wizards",
        block: "TNTGames",
        head: wins(tiers.WIZARDS_WINS, "wins_tntwizards"),
        lines: [count("Kills", "kills_capture"), count("Deaths", "deaths_capture"), count("Points", "points_capture")],
    },
    bowspleef: {
        title: "Bow Spleef",
        block: "TNTGames",
        head: wins(tiers.BOWSPLEEF_WINS, "wins_bowspleef"),
        lines: [count("Kills", "kills_bowspleef"), count("Deaths", "deaths_bowspleef")],
    },

    // arcade
    blockingdead: {
        title: "Blocking Dead",
        block: "Arcade",
        head: wins(tiers.BLOCKINGDEAD_WINS, "wins_dayone"),
        trail: { label: "Kills", keys: ["kills_dayone"], tiers: tiers.BLOCKINGDEAD_KILLS, mark: "K", big: true },
        lines: [count("Headshots", "headshots_dayone")],
    },
    bountyhunters: {
        title: "Bounty Hunters",
        block: "Arcade",
        head: wins(tiers.BOUNTYHUNTERS_WINS, "wins_oneinthequiver"),
        trail: kdr(tiers.BOUNTYHUNTERS_KDR, "kills_oneinthequiver", "deaths_oneinthequiver"),
        lines: [count("Kills", "kills_oneinthequiver"), count("Deaths", "deaths_oneinthequiver")],
    },
    creeperattack: {
        title: "Creeper Attack",
        block: "Arcade",
        head: { label: "Max wave", keys: ["max_wave"], tiers: tiers.CREEPERATTACK_MAXWAVES },
    },
    disasters: {
        title: "Disasters",
        block: "Arcade",
        path: ["disasters", "stats"], // nested twice for some reason
        head: wins(tiers.DISASTERS_WINS, "wins"),
        lines: [count("Games", "games_played"), count("Losses", "losses")],
    },
    dragonwars: {
        title: "Dragon Wars",
        block: "Arcade",
        head: wins(tiers.DRAGONWARS_WINS, "wins_dragonwars2"),
        trail: { label: "Kills", keys: ["kills_dragonwars2"], tiers: tiers.DRAGONWARS_KILLS, mark: "K", big: true },
    },
    dropper: {
        title: "Dropper",
        block: "Arcade",
        path: ["dropper"], // nested for some reason
        head: wins(tiers.DROPPERS_WINS, "wins"),
        trail: { label: "Flawless", keys: ["flawless_games"], tiers: tiers.DROPPER_FLAWLESS, mark: "F" },
        lines: [count("Fails", "fails"), count("Maps", "maps_completed"), count("Finished", "games_finished")],
    },
    enderspleef: {
        title: "Ender Spleef",
        block: "Arcade",
        head: wins(tiers.ENDERSPLEEF_WINS, "wins_ender"),
        trail: {
            label: "Blocks",
            keys: ["blocks_destroyed_ender"],
            tiers: tiers.ENDERSPLEEF_BLOCKSBROKEN,
            mark: "B",
            big: true,
        },
    },
    farmhunt: {
        title: "Farm Hunt",
        block: "Arcade",
        head: wins(tiers.FARMHUNT_WINS, "wins_farm_hunt"),
        trail: {
            label: "Kills",
            keys: ["kills_farm_hunt|animal_kills_farm_hunt"],
            tiers: tiers.FARMHUNT_KILLS,
            mark: "K",
            big: true,
        },
        lines: [count("Poop", "poop_collected"), count("Taunts", "taunts_used")],
    },
    football: {
        title: "Football",
        block: "Arcade",
        head: wins(tiers.FOOTBALL_WINS, "wins_soccer"),
        trail: { label: "Goals", keys: ["goals_soccer"], tiers: tiers.FOOTBALL_GOALS, mark: "G" },
        lines: [count("Powerkicks", "powerkicks_soccer")],
    },
    galaxywars: {
        title: "Galaxy Wars",
        block: "Arcade",
        head: wins(tiers.GALAXYWARS_WINS, "sw_game_wins"),
        trail: kdr(tiers.GALAXYWARS_KDR, "sw_kills", "sw_deaths"),
        lines: [count("Kills", "sw_kills"), count("Deaths", "sw_deaths"), count("Shots", "sw_shots_fired", true)],
    },
    hideandseek: {
        title: "Hide and Seek",
        block: "Arcade",
        head: wins(tiers.HIDEANDSEEK_WINS, "seeker_wins_hide_and_seek", "hider_wins_hide_and_seek"),
        lines: [count("As seeker", "seeker_wins_hide_and_seek"), count("As hider", "hider_wins_hide_and_seek")],
    },
    holeinthewall: {
        title: "Hole in the Wall",
        block: "Arcade",
        head: wins(tiers.HOLEINTHEWALLS_WINS, "wins_hole_in_the_wall"),
        trail: {
            label: "Rounds",
            keys: ["rounds_hole_in_the_wall|walls_hole_in_the_wall"],
            tiers: tiers.HOLEINTHEWALLS_WALLS,
            mark: "R",
            big: true,
        },
        lines: [count("Best (qualify)", "hitw_record_q"), count("Best (finals)", "hitw_record_f")],
    },
    hypixelsays: {
        title: "Hypixel Says",
        block: "Arcade",
        head: wins(tiers.HYPIXELSAYS_WINS, "wins_simon_says", "wins_santa_says"),
        trail: {
            label: "Rounds",
            keys: ["rounds_simon_says", "rounds_santa_says"],
            tiers: tiers.HYPIXELSAYS_ROUNDS,
            mark: "R",
            big: true,
        },
        lines: [count("Top score", "top_score_simon_says"), count("Round wins", "round_wins_simon_says")],
    },
    miniwalls: {
        title: "Mini Walls",
        block: "Arcade",
        head: wins(tiers.MINIWALLS_WINS, "wins_mini_walls"),
        trail: kdr(tiers.MINIWALLS_KDR, "kills_mini_walls", "deaths_mini_walls"),
        lines: [
            count("Finals", "final_kills_mini_walls"),
            count("Wither kills", "wither_kills_mini_walls"),
            count("Arrows hit", "arrows_hit_mini_walls"),
        ],
    },
    partygames: {
        title: "Party Games",
        block: "Arcade",
        head: wins(tiers.PARTYGAMES_WINS, "wins_party", "wins_party_2", "wins_party_3"),
        trail: {
            label: "Stars",
            keys: ["total_stars_party|stars_party"],
            tiers: tiers.PARTYGAMES_STARS,
            mark: "S",
            big: true,
        },
    },
    pixelpainters: {
        title: "Pixel Painters",
        block: "Arcade",
        head: wins(tiers.PIXELPAINTERS_WINS, "wins_draw_their_thing"),
    },
    pixelparty: {
        title: "Pixel Party",
        block: "Arcade",
        path: ["pixel_party"],
        head: wins(tiers.PIXELPARTY_WINS, "wins"),
        // no losses counter, games played covers it the same way murder mystery does
        trail: { label: "WLR", over: ["wins"], under: ["games_played"], less: true, tiers: tiers.PIXELPARTY_WLR },
        lines: [count("Games", "games_played"), count("Best round", "highest_round"), count("Powerups", "power_ups_collected")],
    },
    throwout: {
        title: "Throw Out",
        block: "Arcade",
        head: wins(tiers.THROWOUT_WINS, "wins_throw_out"),
        trail: kdr(tiers.THROWOUT_KDR, "kills_throw_out", "deaths_throw_out"),
        lines: [count("Kills", "kills_throw_out"), count("Deaths", "deaths_throw_out")],
    },
    zombies: {
        title: "Zombies",
        block: "Arcade",
        head: wins(tiers.ZOMBIES_WINS, "wins_zombies"),
        trail: {
            label: "Kills",
            keys: ["zombie_kills_zombies|zombie_kills"],
            tiers: tiers.ZOMBIES_KILLS,
            mark: "K",
            big: true,
        },
        lines: [count("Rounds", "total_rounds_survived_zombies"), count("Best round", "best_round_zombies")],
    },

    // simulators, all of them live in the arcade block too
    eastersim: {
        title: "Easter Simulator",
        block: "Arcade",
        head: wins(tiers.EASTERSIM_WINS, "wins_easter_simulator"),
        trail: { label: "Eggs", keys: ["eggs_found_easter_simulator"], tiers: tiers.EASTERSIM_EGGS, mark: "E" },
    },
    grinchsim: {
        title: "Grinch Simulator",
        block: "Arcade",
        head: wins(tiers.GRINCHSIM_WINS, "wins_grinch_simulator_v2|wins_grinch_simulator"),
        trail: {
            label: "Gifts",
            keys: ["gifts_grinch_simulator_v2|gifts_grinch_simulator"],
            tiers: tiers.GRINCHSIM_GIFTS,
            mark: "G",
        },
    },
    santasim: {
        title: "Santa Simulator",
        block: "Arcade",
        head: wins(tiers.GRINCHSIM_WINS, "wins_santa_simulator"),
        trail: { label: "Gifts", keys: ["gifts_santa_simulator"], tiers: tiers.GRINCHSIM_GIFTS, mark: "G" },
    },
    halloweensim: {
        title: "Halloween Simulator",
        block: "Arcade",
        head: wins(tiers.HALLOWEENSIM_WINS, "wins_halloween_simulator"),
        trail: {
            label: "Candy",
            keys: ["candy_found_halloween_simulator"],
            tiers: tiers.HALLOWEENSIM_CANDY,
            mark: "C",
        },
    },
    scubasim: {
        title: "Scuba Simulator",
        block: "Arcade",
        head: wins(tiers.SCUBASIM_WINS, "wins_scuba_simulator"),
        trail: {
            label: "Points",
            keys: ["total_points_scuba_simulator|points_scuba_simulator"],
            tiers: tiers.SCUBASIM_POINTS,
            mark: "P",
        },
        lines: [count("Items", "items_found_scuba_simulator")],
    },

    // classic games
    quake: {
        title: "Quake",
        block: "Quake",
        head: wins(tiers.QUAKE_WINS, "wins", "wins_teams"),
        trail: { label: "Kills", keys: ["kills", "kills_teams"], tiers: tiers.QUAKE_KILLS, mark: "K", big: true },
        lines: [count("Deaths", "deaths", true), count("Headshots", "headshots", true), count("Killstreaks", "killstreaks")],
    },
    arena: {
        title: "Arena Brawl",
        block: "Arena",
        head: wins(tiers.ARENA_WINS, "wins_1v1", "wins_2v2", "wins_4v4"),
        trail: {
            label: "KDR",
            over: ["kills_1v1", "kills_2v2", "kills_4v4"],
            under: ["deaths_1v1", "deaths_2v2", "deaths_4v4"],
            tiers: tiers.ARENA_KDR,
        },
        lines: [count("Rating", "rating"), count("Coins", "coins", true)],
    },
    thewalls: {
        title: "The Walls",
        block: "Walls",
        head: wins(tiers.WALLS_WINS, "wins"),
        trail: kdr(tiers.WALLS_KDR),
        lines: [count("Losses", "losses"), count("Kills", "kills"), count("Deaths", "deaths")],
    },
    vampirez: {
        title: "VampireZ",
        block: "VampireZ",
        head: wins(tiers.VAMPIREZ_HUMAN_WINS, "human_wins"),
        trail: kdr(tiers.VAMPIREZ_HUMAN_KDR, "vampire_kills", "human_deaths"),
        lines: [
            count("Vampire wins", "vampire_wins"),
            count("Zombie kills", "zombie_kills", true),
            count("Human kills", "human_kills"),
        ],
    },
    tkr: {
        title: "Turbo Kart Racers",
        block: "GingerBread",
        head: wins(tiers.TKR_WINS, "wins"),
        trail: {
            label: "Trophies",
            keys: ["gold_trophy", "silver_trophy", "bronze_trophy"],
            tiers: tiers.TKR_TROPHIES,
            mark: "T",
        },
        lines: [count("Laps", "laps_completed"), count("Boxes", "box_pickups"), count("Coins", "coins", true)],
    },
    paintball: {
        title: "Paintball",
        block: "Paintball",
        head: wins(tiers.PAINTBALL_WINS, "wins"),
        trail: kdr(tiers.PAINTBALL_KDR),
        lines: [
            count("Kills", "kills", true),
            count("Deaths", "deaths", true),
            count("Shots", "shots_fired", true),
        ],
    },

    // other
    // stats.Housing holds packages and per-house layouts, no cookie counter -
    // cookies live on the house rather than the player, so this stays dark until
    // hypixel exposes one. left in place so housing is still accounted for
    housing: {
        title: "Housing",
        block: "Housing",
        head: { label: "Cookies", keys: ["cookies"], tiers: tiers.HOUSING_COOKIES, mark: "C" },
    },
} satisfies Partial<Record<GameMode, GameSpec>>;

// the games written by hand further up, the rest come out of SPECS
const BY_HAND = [
    bedwarsTags,
    skywarsTags,
    duelsTags,
    uhcTags,
    tntgamesTags,
    murdermysteryTags,
    fishingTags, // "lobby"
    woolgamesTags,
    woolwarsTags,
    sheepwarsTags,
    ctwTags,
    arcadeTags,
    classicTags,
];

type Handled =
    | "bedwars" | "skywars" | "duels" | "uhc" | "tntgames" | "murdermystery" | "lobby"
    | "woolgames" | "woolwars" | "sheepwars" | "ctw" | "arcade" | "classic" 
    | keyof typeof SPECS;

// adding a game to GameMode without giving it tags turns this line red.
// this is a compile time check + also goofy linter stuff, but it works
type Assert<T extends never> = T;
type _EveryGameHasTags = Assert<Exclude<GameMode, Handled | "unknown">>;

// every tag we know how to make for a player. the renderer picks the ones
// matching the game being played, so building the lot once per lookup is fine
export const allTags = (player: HypixelPlayer): Tag[] => [
    ...BY_HAND.flatMap((build) => build(player)), // custom mades
    ...Object.entries(SPECS).flatMap(([game, spec]) => specTags(player, game as GameMode, spec)), // map of data
];
