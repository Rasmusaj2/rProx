import { PREFIX } from "../core/chat";
import { isFakeUuid } from "../core/lobby";
import type { Plugin, PlayerRef, Session, Tag } from "../core/types";
import {
    HypixelService,
    bedwarsStats,
    skywarsStats,
    duelsStats,
    uhcStats,
    tntGamesStats,
    murderMysteryStats,
    fishingStats,
    fetchErrorMessage,
    findDuelsTarget,
    duelsCategoryStats,
    DUELS_MODES,
    MYTHICAL_FANCY_NAMES,
    type HypixelPlayer,
    type PlayerFetch,
    type DuelsCategory,
    type DuelsDivision,
    type DuelsModeStats,
} from "../services/hypixel";
import { bedwarsStar } from "../services/prestige";
import * as fish from "../services/fishing";
import {
    tierFormat,
    BEDWARS_FKDR,
    SKYWARS_KDR,
    DUELS_WINS,
    DUELS_WLR,
    DUELS_KDR,
    DUELS_MODE_WINS,
    DUELS_DIVISION,
    UHC_WINS,
    UHC_KDR,
    TNT_TOTAL_WINS,
    TNT_RUN_WINS,
    MM_WINS,
    MM_WLR,
    FISHING_MYTHICAL,
    FISHING_CATCHES,
} from "../services/thresholds";

import { formatRankedName } from "../services/rank";
import { resolveUuid } from "../services/microsoft";
import { COLOR_CODES, type McColorName } from "../util/mcColors";

import * as tags from "../util/tags";


// hypixel stats. an enricher handing back the tags for every game we know (see
// util/tags.ts), plus stat commands (ie. //bw, //sw and //duels) 
// needs api key from https://developer.hypixel.net/

interface HypixelStatsConfig {
    enabled?: boolean;
    apiKey?: string;
    cacheTtlSeconds?: number;
}

const DEFAULT_CACHE_SECONDS = 300;

const c = (color: McColorName, value: string | number) => COLOR_CODES[color] + value;

// enrichment changes retryable array
const RETRYABLE: ReadonlyArray<PlayerFetch["status"]> = ["ratelimited", "error", "unresolved"];

const division = (d: DuelsDivision | null): string =>
    d ? ` §8(${tierFormat(d.index, DUELS_DIVISION, d.label)}§8)` : "";

// the simple line of wins, wlr, kdr
function duelsLine(m: DuelsModeStats): string {
    const bridge = m.bridgeKills > 0 || m.bridgeDeaths > 0;
    const kdr = bridge ? m.bridgeKdr : m.kdr;
    return `§7Wins: ${tierFormat(m.wins, DUELS_MODE_WINS)}  §7WLR: ${tierFormat(m.wlr, DUELS_WLR)}`
        + (m.kills > 0 || bridge ? `  §7KDR: ${tierFormat(kdr, DUELS_KDR)}` : "")
        + (bridge ? `  §7Goals: ${c("white", m.goals.toLocaleString())}` : "");
}

// the breakdown of all the categories and their modes
function duelsBreakdown(session: Session, categories: DuelsCategory[]): void {
    for (const category of categories) {
        session.chat.text(`  §b${category.name}§8: ${duelsLine(category.combined)}`);
        if (category.modes.length < 2) continue;
        for (const mode of category.modes) {
            session.chat.text(`    §7${mode.variant || mode.name}§8: ${duelsLine(mode)}`);
        }
    }
}

function duelsMode(session: Session, title: string, m: DuelsModeStats, streaksHidden: boolean, queues: DuelsModeStats[] = []): void {
    session.chat.text(`${PREFIX} ${title} §7- §bDuels §8(§7${m.name}§8)${division(m.division)}`);
    if (!m.played) {
        session.chat.text(`  §7No ${m.name} stats`);
        return;
    }
    session.chat.text(`  §7Wins: ${tierFormat(m.wins, DUELS_MODE_WINS)}  §7Losses: ${c("white", m.losses.toLocaleString())}  §7WLR: ${tierFormat(m.wlr, DUELS_WLR)}  §7Rounds: ${c("white", m.roundsPlayed.toLocaleString())}`);
    const streaks = streaksHidden
        ? `§7Winstreak: ${c("dark_gray", "hidden")}`
        : `§7Winstreak: ${c("white", m.currentWinstreak)}  §7Best: ${c("white", m.bestWinstreak)}`;
    session.chat.text(`  §7Kills: ${c("white", m.kills.toLocaleString())}  §7Deaths: ${c("white", m.deaths.toLocaleString())}  §7KDR: ${tierFormat(m.kdr, DUELS_KDR)}  ${streaks}`);

    // bridge stats for goals
    if (m.goals > 0 || m.bridgeKills > 0) {
        session.chat.text(`  §7Goals: ${c("white", m.goals.toLocaleString())}  §7Bridge kills: ${c("white", m.bridgeKills.toLocaleString())}  §7Bridge deaths: ${c("white", m.bridgeDeaths.toLocaleString())}  §7Bridge KDR: ${tierFormat(m.bridgeKdr, DUELS_KDR)}`);
    }

    const hit: string[] = [];
    if (m.meleeSwings > 0) hit.push(`§7Melee: ${c("white", `${m.meleeAccuracy}%`)} §8(${m.meleeHits.toLocaleString()}/${m.meleeSwings.toLocaleString()})`);
    if (m.bowShots > 0) hit.push(`§7Bow: ${c("white", `${m.bowAccuracy}%`)} §8(${m.bowHits.toLocaleString()}/${m.bowShots.toLocaleString()})`);
    if (hit.length > 0) session.chat.text(`  ${hit.join("  ")}`);

    const rest: string[] = [];
    const add = (label: string, value: number) => {
        if (value > 0) rest.push(`§7${label}: ${c("white", value.toLocaleString())}`);
    };
    add("Damage", m.damageDealt);
    add("Health regen", m.healthRegenerated);
    add("Blocks", m.blocksPlaced);
    add("Gapples", m.goldenApplesEaten);
    add("Kit wins", m.kitWins);
    for (const extra of m.extras) rest.push(`§7${extra.label}: ${c("white", extra.text)}`);
    for (let i = 0; i < rest.length; i += 3) session.chat.text(`  ${rest.slice(i, i + 3).join("  ")}`);

    if (queues.length < 2) return;
    for (const queue of queues) session.chat.text(`    §7${queue.variant || queue.name}§8: ${duelsLine(queue)}`);
}

export const hypixelStatsPlugin: Plugin = {
    name: "hypixelStats",
    version: "0.1.3",
    description: "Stats from the Hypixel API, every game it reports on.",

    defaultConfig: {
        enabled: true,
        apiKey: "",
        cacheTtlSeconds: DEFAULT_CACHE_SECONDS,
    },

    setup(api) {
        const config = api.pluginConfig as HypixelStatsConfig;
        const ttl = (config.cacheTtlSeconds ?? DEFAULT_CACHE_SECONDS) * 1000;
        const hypixel = new HypixelService(api.http, config.apiKey ?? "", ttl); // this is hard to convert to a hard reference unless the HypixelService takes in the entire config object

        if (!hypixel.enabled) {
            api.log.warn("no apiKey set, hypixelStats is off (set builtInPlugins.hypixelStats.apiKey)");
            return;
        }

        let warnedInvalidKey = false;

        // the api only takes uuids, /who and chat detections only give us names
        const withUuid = async (player: PlayerRef): Promise<PlayerRef> => {
            if (player.uuid) return player;
            const uuid = await resolveUuid(api.http, player.name);
            return uuid ? { ...player, uuid } : player;
        };

        // essential means somebody typed a command for this one, so it may spend the
        // slice of the ratelimit window that background decoration is kept out of
        const fetch = async (player: PlayerRef, options: { essential?: boolean } = {}) => {
            const result = await hypixel.fetchPlayer(await withUuid(player), options);
            if (result.status === "invalid_key" && !warnedInvalidKey) {
                warnedInvalidKey = true;
                api.log.warn("Hypixel API key is invalid, stats stay off until its fixed (developer.hypixel.net)");
            }
            return result;
        };

        // one tag pair per game - a prestige-ish value in front of the name and a
        // ratio trailing it. whoever renders picks the set matching the game.
        

        api.registerEnricher({
            name: "hypixelStats",
            async enrich(player) {
                if (player.uuid && isFakeUuid(player.uuid)) return tags.nickTags("via tab list uuid"); // fake uuid means fake npc or nicked player
                const result = await fetch(player);
                if (result.status !== "ok") {
                    if (RETRYABLE.includes(result.status)) throw new Error(fetchErrorMessage(result.status));
                    if (result.status === "no_data") return tags.nickTags("via Hypixel API"); // apply nick tag when no data available, ie. uuid doesnt exist on hypixel api - shouldnt usually be hit since it'll be detected via uuid check
                    return null;
                }
                return tags.allTags(result.player);
            },
        });

        // resolve the command target and pull its data, reporting why not into chat
        const resolve = async (
            args: string[],
            session: Session,
        ): Promise<{ title: string; player: HypixelPlayer } | null> => {
            const target: PlayerRef = args[0]
                ? (session.findPlayer(args[0]) ?? { name: args[0] })
                : { name: session.username };
            const result = await fetch(target, { essential: true });
            if (result.status !== "ok") {
                session.chat.text(`${PREFIX} §c${fetchErrorMessage(result.status)} §7(${target.name})`);
                return null;
            }
            return { title: formatRankedName(result.player, target.name), player: result.player };
        };

        api.registerCommand(
            "bw",
            async (args, session) => {
                const found = await resolve(args, session);
                if (!found) return;
                const s = bedwarsStats(found.player);
                session.chat.text(`${PREFIX} ${found.title} §7- §bBedwars`);
                session.chat.text(`  §7Star: ${bedwarsStar(s.level).formatted}  §7FKDR: ${tierFormat(s.fkdr, BEDWARS_FKDR)}  §7WLR: ${c("white", s.wlr)}  §7KDR: ${c("white", s.kdr)}`);
                session.chat.text(`  §7Finals: ${c("white", s.finalKills)}  §7Wins: ${c("white", s.wins)}  §7Winstreak: ${c("white", s.winstreak)}`);
            },
            "Bedwars stats for a player (or yourself)",
        );

        api.registerCommand(
            "sw",
            async (args, session) => {
                const found = await resolve(args, session);
                if (!found) return;
                const s = skywarsStats(found.player);
                session.chat.text(`${PREFIX} ${found.title} §7- §bSkyWars`);
                session.chat.text(`  §7Level: ${s.levelFormatted || c("gray", "none")}  §7KDR: ${tierFormat(s.kdr, SKYWARS_KDR)}  §7WLR: ${c("white", s.wlr)}`);
                session.chat.text(`  §7Wins: ${c("white", s.wins)}  §7Kills: ${c("white", s.kills)}`);
            },
            "SkyWars stats for a player (or yourself)",
        );

        api.registerCommand(
            "duels",
            async (args, session) => {
                const found = await resolve(args, session);
                if (!found) return;
                const s = duelsStats(found.player);

                if (args[1]) {
                    const target = findDuelsTarget(args[1]);
                    if (target?.kind === "category") {
                        const category = duelsCategoryStats(s, target.category);
                        duelsMode(session, found.title, category.combined, s.winstreaksHidden, category.modes);
                        return;
                    }
                    const mode = target?.mode;
                    if (!mode) {
                        const games = [...new Set(DUELS_MODES.map((m) => m.category))];
                        session.chat.text(`${PREFIX} §7No duels mode called §f${args[1]}§7.`);
                        session.chat.text(`  §7Modes: §f${games.join("§7, §f")} §8(a game on its own is every queue of it, add 1/2/3/4 for one, ie. §7bridge2§8)`);
                        return;
                    }
                    duelsMode(session, found.title, s.modes[mode.key], s.winstreaksHidden);
                    return;
                }

                session.chat.text(`${PREFIX} ${found.title} §7- §bDuels${division(s.division)}`);
                session.chat.text(`  §7Wins: ${tierFormat(s.wins, DUELS_WINS)}  §7WLR: ${tierFormat(s.wlr, DUELS_WLR)}  §7KDR: ${tierFormat(s.kdr, DUELS_KDR)}  §7Games: ${c("white", s.gamesPlayed.toLocaleString())}`);
                if (s.categories.length === 0) {
                    session.chat.text(`  §7No Duels stats`);
                    return;
                }
                const streaks = s.winstreaksHidden
                    ? `§7Winstreak: ${c("dark_gray", "hidden")}`
                    : `§7Winstreak: ${c("white", s.currentWinstreak)}  §7Best: ${c("white", s.bestWinstreak)}`;
                session.chat.text(`  ${streaks}  §7Melee: ${c("white", `${s.meleeAccuracy}%`)}  §7Bow: ${c("white", `${s.bowAccuracy}%`)}`);
                duelsBreakdown(session, s.categories);
            },
            "Duels stats for a player, optionally a single mode (//duels <player> bridge2)",
        );

        api.registerCommand(
            "uhc",
            async (args, session) => {
                const found = await resolve(args, session);
                if (!found) return;
                const s = uhcStats(found.player);
                session.chat.text(`${PREFIX} ${found.title} §7- §bUHC`);
                if (s.wins === 0 && s.kills === 0) {
                    session.chat.text(`  §7No UHC stats`);
                    return;
                }
                session.chat.text(`  §7Wins: ${tierFormat(s.wins, UHC_WINS)}  §7KDR: ${tierFormat(s.kdr, UHC_KDR)}  §7Score: ${c("white", s.score)}`);
                session.chat.text(`  §7Kills: ${c("white", s.kills)}  §7Deaths: ${c("white", s.deaths)}  §7Heads eaten: ${c("white", s.headsEaten)}`);
            },
            "UHC stats for a player (or yourself)",
        );
        api.registerCommand(
            "tnt",
            async (args, session) => {
                const found = await resolve(args, session);
                if (!found) return;
                const s = tntGamesStats(found.player);
                session.chat.text(`${PREFIX} ${found.title} §7- §bTNT Games`);
                if (s.wins === 0) {
                    session.chat.text(`  §7No TNT Games stats`);
                    return;
                }
                // no losses are reported anywhere in tnt, so this breaks the wins
                // down per mode instead of showing a ratio it cannot work out
                session.chat.text(`  §7Wins: ${tierFormat(s.wins, TNT_TOTAL_WINS)}  §7Winstreak: ${c("white", s.winstreak)}`);
                session.chat.text(`  §7TNT Run: ${tierFormat(s.tntRun, TNT_RUN_WINS)}  §7PvP Run: ${c("white", s.pvpRun)}  §7Bow Spleef: ${c("white", s.bowSpleef)}`);
                session.chat.text(`  §7TNT Tag: ${c("white", s.tntTag)}  §7Wizards: ${c("white", s.wizards)}`);
            },
            "TNT Games stats for a player (or yourself)",
        );
        api.registerCommand(
            "mm",
            async (args, session) => {
                const found = await resolve(args, session);
                if (!found) return;
                const s = murderMysteryStats(found.player);
                session.chat.text(`${PREFIX} ${found.title} §7- §bMurder Mystery`);
                if (s.wins === 0 && s.games === 0) {
                    session.chat.text(`  §7No Murder Mystery stats`);
                    return;
                }
                session.chat.text(`  §7Wins: ${tierFormat(s.wins, MM_WINS)}  §7WLR: ${tierFormat(s.wlr, MM_WLR)}  §7KDR: ${c("white", s.kdr)}`);
                session.chat.text(`  §7Games: ${c("white", s.games)}  §7As murderer: ${c("white", s.murdererWins)}  §7As detective: ${c("white", s.detectiveWins)}`);
            },
            "Murder Mystery stats for a player (or yourself)",
        );
        api.registerCommand(
            "fish",
            async (args, session) => {
                const found = await resolve(args, session);
                if (!found) return;
                const s = fishingStats(found.player);
                session.chat.text(`${PREFIX} ${found.title} §7- §bLobby Fishing`);
                if (!s || s.totalCatches === 0) {
                    session.chat.text(`  §7No Lobby Fishing stats`);
                    return;
                }
                session.chat.text(`  §7Mythical: ${tierFormat(s.mythicalCaught, FISHING_MYTHICAL)}  §7Catches: ${tierFormat(s.totalCatches, FISHING_CATCHES)}  §7Special: ${c("white", s.specialCaught)}`);
                session.chat.text(`  §7Fish: ${c("white", s.fishCaught.toLocaleString())}  §7Treasure: ${c("white", s.treasureCaught.toLocaleString())}  §7Junk: ${c("white", s.junkCaught.toLocaleString())}`);
                session.chat.text(`  §7Plants: ${c("white", s.plantsCaught.toLocaleString())}  §7Creatures: ${c("white", s.creaturesCaught.toLocaleString())}`);
                
                // per area
                for (const [name, a] of Object.entries(s.areas)) {
                    session.chat.text(
                        `  §f${name[0].toUpperCase()}${name.slice(1)}§8: §7fish ${c("white", a.fishCaught.toLocaleString())}` +
                        `  §7treasure: ${c("white", a.treasureCaught.toLocaleString())}` +
                        `  §7junk: ${c("white", a.junkCaught.toLocaleString())}` +
                        `  §7plants: ${c("white", a.plantsCaught.toLocaleString())}` +
                        `  §7creatures: ${c("white", a.creaturesCaught.toLocaleString())}`,
                    );
                }

                // orbs (mythical) weights + amount + fancy name and coloring correctly for high weight rolls
                const mythicals = Object.entries(s.mythicalCaughtIndividual)
                    .sort((a, b) => b[1] - a[1])
                    .map(([orb, count]) => {
                        const weight = s.mythicalWeight[orb] ?? 0;
                        // gold means they landed the top of that orbs weight range
                        return `§7${MYTHICAL_FANCY_NAMES[orb] ?? orb}: ${c("white", count.toLocaleString())}${weight ? ` §8(${fish.formatWeight(orb, weight)}§8)` : ""}`;
                    });
                for (let i = 0; i < mythicals.length; i += 2) {
                    session.chat.text(`  ${mythicals.slice(i, i + 2).join("  ")}`);
                }
            },
            "Lobby Fishing stats for a player (or yourself)",
        );
    },
};

export default hypixelStatsPlugin;
