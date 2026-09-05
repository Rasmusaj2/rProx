import { PREFIX } from "../core/chat";
import { isFakeUuid } from "../core/lobby";
import type { Plugin, PlayerRef, Session, Tag } from "../core/types";
import {
    getHypixelService,
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
import { resolveUuid, dashUuid } from "../services/microsoft";
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

// autogenerates commands for every game based on tooltips from tags
const autogen = {
            "hypixel": { "game": "general", description: "Network stats for a player (or yourself)" },
            "bw": { "game": "bedwars", description: "Bedwars stats for a player (or yourself)" },
            "sw": { "game": "skywars", description: "SkyWars stats for a player (or yourself)" },
            "uhc": { "game": "uhc", description: "UHC stats for a player (or yourself)" },
            "tnt": { "game": "tntgames", description: "TNT Games stats for a player (or yourself)" },
            "mm": { "game": "murdermystery", description: "Murder Mystery stats for a player (or yourself)" },

            "blitz": { "game": "blitz", description: "Blitz SG stats for a player (or yourself)" },
            "sg": { "game": "blitz", description: "Blitz SG stats for a player (or yourself)" },
            "cvc": { "game": "cvc", description: "Cops and Crims stats for a player (or yourself)" },
            "mw": { "game": "megawalls", description: "Mega Walls stats for a player (or yourself)" },
            "smash": { "game": "smashheroes", description: "Smash Heroes stats for a player (or yourself)" },
            "warlords": { "game": "warlords", description: "Warlords stats for a player (or yourself)" },
            "wl": { "game": "warlords", description: "Warlords stats for a player (or yourself)" },
            "bb": { "game": "buildbattle", description: "Build Battle stats for a player (or yourself)" },
            "gtb": { "game": "guessthebuild", description: "Guess the Build stats for a player (or yourself)" },
            "suhc": { "game": "speeduhc", description: "Speed UHC stats for a player (or yourself)" },

            "wool": { "game": "woolgames", description: "Wool Games stats for a player (or yourself)" },
            "ww": { "game": "woolwars", description: "Wool Wars stats for a player (or yourself)" },
            "sheep": { "game": "sheepwars", description: "Sheep Wars stats for a player (or yourself)" },
            "ctw": { "game": "ctw", description: "Capture the Wool stats for a player (or yourself)" },

            "tntrun": { "game": "tntrun", description: "TNT Run stats for a player (or yourself)" },
            "tnttag": { "game": "tnttag", description: "TNT Tag stats for a player (or yourself)" },
            "pvprun": { "game": "pvprun", description: "PvP Run stats for a player (or yourself)" },
            "wizards": { "game": "tntwizards", description: "TNT Wizards stats for a player (or yourself)" },
            "bowspleef": { "game": "bowspleef", description: "Bow Spleef stats for a player (or yourself)" },

            "arcade": { "game": "arcade", description: "Arcade stats for a player (or yourself)" },
            "blockingdead": { "game": "blockingdead", description: "Blocking Dead stats for a player (or yourself)" },
            "bounty": { "game": "bountyhunters", description: "Bounty Hunters stats for a player (or yourself)" },
            "creeperattack": { "game": "creeperattack", description: "Creeper Attack stats for a player (or yourself)" },
            "disasters": { "game": "disasters", description: "Disasters stats for a player (or yourself)" },
            "dragonwars": { "game": "dragonwars", description: "Dragon Wars stats for a player (or yourself)" },
            "dropper": { "game": "dropper", description: "Dropper stats for a player (or yourself)" },
            "enderspleef": { "game": "enderspleef", description: "Ender Spleef stats for a player (or yourself)" },
            "farmhunt": { "game": "farmhunt", description: "Farm Hunt stats for a player (or yourself)" },
            "football": { "game": "football", description: "Football stats for a player (or yourself)" },
            "galaxywars": { "game": "galaxywars", description: "Galaxy Wars stats for a player (or yourself)" },
            "hideandseek": { "game": "hideandseek", description: "Hide and Seek stats for a player (or yourself)" },
            "hitw": { "game": "holeinthewall", description: "Hole in the Wall stats for a player (or yourself)" },
            "hypixelsays": { "game": "hypixelsays", description: "Hypixel Says stats for a player (or yourself)" },
            "miniwalls": { "game": "miniwalls", description: "Mini Walls stats for a player (or yourself)" },
            "partygames": { "game": "partygames", description: "Party Games stats for a player (or yourself)" },
            "pixelpainters": { "game": "pixelpainters", description: "Pixel Painters stats for a player (or yourself)" },
            "pixelparty": { "game": "pixelparty", description: "Pixel Party stats for a player (or yourself)" },
            "throwout": { "game": "throwout", description: "Throw Out stats for a player (or yourself)" },
            "zombies": { "game": "zombies", description: "Zombies stats for a player (or yourself)" },

            "eastersim": { "game": "eastersim", description: "Easter Simulator stats for a player (or yourself)" },
            "grinchsim": { "game": "grinchsim", description: "Grinch Simulator stats for a player (or yourself)" },
            "santasim": { "game": "santasim", description: "Santa Simulator stats for a player (or yourself)" },
            "halloweensim": { "game": "halloweensim", description: "Halloween Simulator stats for a player (or yourself)" },
            "scubasim": { "game": "scubasim", description: "Scuba Simulator stats for a player (or yourself)" },

            "classic": { "game": "classic", description: "Classic Games stats for a player (or yourself)" },
            "quake": { "game": "quake", description: "Quake stats for a player (or yourself)" },
            "arena": { "game": "arena", description: "Arena Brawl stats for a player (or yourself)" },
            "walls": { "game": "thewalls", description: "The Walls stats for a player (or yourself)" },
            "vampirez": { "game": "vampirez", description: "VampireZ stats for a player (or yourself)" },
            "vz": { "game": "vampirez", description: "VampireZ stats for a player (or yourself)" },
            "tkr": { "game": "tkr", description: "Turbo Kart Racers stats for a player (or yourself)" },
            "pb": { "game": "paintball", description: "Paintball stats for a player (or yourself)" },

            "pit": { "game": "pit", description: "The Pit stats for a player (or yourself)" },
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
    version: "0.1.4",
    description: "Stats from the Hypixel API, every game it reports on.",

    defaultConfig: {
        enabled: true,
        apiKey: "",
        cacheTtlSeconds: DEFAULT_CACHE_SECONDS,
    },

    setup(api) {
        const config = api.pluginConfig as HypixelStatsConfig;
        const ttl = (config.cacheTtlSeconds ?? DEFAULT_CACHE_SECONDS) * 1000;
        const hypixel = getHypixelService(api.http, config.apiKey ?? "", ttl); // shared instance, see getHypixelService

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

        // gexp + recent games, two extra endpoints the enricher never touches
        const generalExtras = async (player: HypixelPlayer) => {
            const dashed = player.uuid ? dashUuid(player.uuid) : undefined;
            if (!dashed) return undefined;
            const [gexp, recent] = await Promise.all([hypixel.guildExp(dashed), hypixel.recentGames(dashed)]);
            return { gexp, recent };
        };

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

        // commands from map
        const RENDERED = new Set(["duels", "fish"]);
        for (const [rawName, rawCommand] of Object.entries(autogen ?? {})) {
            if (!rawCommand || typeof rawCommand !== "object") {
                api.log.warn(`tooltipCommands entry "${rawName}": needs { game, description }, skipping it`);
                continue;
            }
            const name = rawName.trim().toLowerCase();
            const game = (rawCommand.game ?? "").trim();
            const description = (rawCommand.description ?? "").trim();
            if (!/^[a-z0-9]+$/.test(name)) {
                api.log.warn(`tooltipCommands entry "${rawName}": Invalid name (invalid characters)`);
                continue;
            }
            if (RENDERED.has(name)) {
                api.log.warn(`tooltipCommands entry "${name}": Collides with custom written command`);
                continue;
            }
            if (!game) {
                api.log.warn(`tooltipCommands entry "${name}": Invalid game (empty)`);
                continue;
            }
            if (!description) {
                api.log.warn(`tooltipCommands entry "${name}": Invalid description (empty)`);
                continue;
            }
            api.registerCommand(
                name,
                async (args, session) => {
                    const found = await resolve(args, session);
                    if (!found) return;
                    // general is the one tooltip with extra endpoints behind it
                    const extras = game === "general" ? await generalExtras(found.player) : undefined;
                    const tag = game === "general"
                        ? tags.generalTags(found.player, extras)[0]
                        : tags.allTags(found.player).find((t) => t.game === game);
                    if (!tag?.tooltip) {
                        session.chat.text(`${PREFIX} ${found.title} §7- §b${game}`);
                        session.chat.text(`  §7No ${game} stats`);
                        return;
                    }
                    const lines = tag.tooltip.split("\n").filter((line) => !line.startsWith("§8via"));
                    session.chat.text(`${PREFIX} ${found.title} §7- ${lines[0]}`);
                    for (const line of lines.slice(1)) session.chat.text(`  ${line}`);
                },
                description,
            );
        }
    },
};

export default hypixelStatsPlugin;
