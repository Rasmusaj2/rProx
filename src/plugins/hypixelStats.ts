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
    MYTHICAL_FANCY_NAMES,
    type HypixelPlayer,
    type PlayerFetch,
} from "../services/hypixel";
import { formatStar, starText, starColor, formatFkdr, fkdrColor } from "../services/bedwars";
import * as sw from "../services/skywars";
import * as duels from "../services/duels";
import * as uhc from "../services/uhc";
import * as tnt from "../services/tntgames";
import * as mm from "../services/murdermystery";
import * as fish from "../services/fishing";
import { formatRankedName } from "../services/rank";
import { resolveUuid } from "../services/microsoft";
import { COLOR_CODES, type McColorName } from "../util/mcColors";

// hypixel stats. an enricher for the inline star + fkdr, plus //bw, //sw and
// //duels for the full breakdown. needs a key from developer.hypixel.net.

interface HypixelStatsConfig {
    enabled?: boolean;
    apiKey?: string;
    cacheTtlSeconds?: number;
}

const DEFAULT_CACHE_SECONDS = 300;

const c = (color: McColorName, value: string | number) => COLOR_CODES[color] + value;

// enrichment changes retryable array 
const RETRYABLE: ReadonlyArray<PlayerFetch["status"]> = ["ratelimited", "error", "unresolved"];

export const hypixelStatsPlugin: Plugin = {
    name: "hypixelStats",
    version: "0.1.2",
    description: "Bedwars, SkyWars and Duels stats from the Hypixel API.",

    defaultConfig: {
        enabled: true,
        apiKey: "",
        cacheTtlSeconds: DEFAULT_CACHE_SECONDS,
    },

    setup(api) {
        const config = api.pluginConfig as HypixelStatsConfig;
        const ttl = (config.cacheTtlSeconds ?? DEFAULT_CACHE_SECONDS) * 1000;
        const hypixel = new HypixelService(api.http, config.apiKey ?? "", ttl);

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
        const bedwarsTags = (player: HypixelPlayer): Tag[] => {
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

        const skywarsTags = (player: HypixelPlayer): Tag[] => {
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

        const duelsTags = (player: HypixelPlayer): Tag[] => {
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

        const uhcTags = (player: HypixelPlayer): Tag[] => {
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

        const tntgamesTags = (player: HypixelPlayer): Tag[] => {
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

        const murdermysteryTags = (player: HypixelPlayer): Tag[] => {
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
        const nickTags = (via: string): Tag[] => [
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

        const fishingTags = (player: HypixelPlayer): Tag[] => {
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

        api.registerEnricher({
            name: "hypixelStats",
            async enrich(player) {
                if (player.uuid && isFakeUuid(player.uuid)) return nickTags("via tab list uuid"); // fake uuid means fake npc or nicked player
                const result = await fetch(player);
                if (result.status !== "ok") {
                    if (RETRYABLE.includes(result.status)) throw new Error(fetchErrorMessage(result.status));
                    if (result.status === "no_data") return nickTags("via Hypixel API"); // apply nick tag when no data available, ie. uuid doesnt exist on hypixel api - shouldnt usually be hit since it'll be detected via uuid check
                    return null;
                }
                return [...bedwarsTags(result.player), 
                    ...skywarsTags(result.player), 
                    ...duelsTags(result.player), 
                    ...uhcTags(result.player), 
                    ...tntgamesTags(result.player), 
                    ...murdermysteryTags(result.player),
                    ...fishingTags(result.player),];
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
                session.chat.text(`  §7Star: ${formatStar(s.level)}  §7FKDR: ${formatFkdr(s.fkdr)}  §7WLR: ${c("white", s.wlr)}  §7KDR: ${c("white", s.kdr)}`);
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
                session.chat.text(`  §7Level: ${s.levelFormatted || c("gray", "none")}  §7KDR: ${c("white", s.kdr)}  §7WLR: ${c("white", s.wlr)}`);
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
                const modes = s.gamemodes ?? {};

                // second arg narrows to one gamemode, prefix match so "bridge"
                // finds bridge_doubles too if thats all thats there
                // not my prettiest args parser but fuck it
                if (args[1]) {
                    const query = args[1].toLowerCase();
                    const key = modes[query] ? query : Object.keys(modes).find((m) => m.startsWith(query));
                    if (!key) {
                        session.chat.text(`${PREFIX} §7No §f${args[1]} §7duels data. Played: §f${Object.keys(modes).join("§7, §f") || "(none)"}`);
                        return;
                    }
                    const mode = modes[key];
                    session.chat.text(`${PREFIX} ${found.title} §7- §bDuels §8(${key})`);
                    session.chat.text(`  §7Wins: ${c("white", mode.wins)}  §7WLR: ${c("white", mode.wlr)}  §7KDR: ${c("white", mode.kdr)}`);
                    return;
                }

                session.chat.text(`${PREFIX} ${found.title} §7- §bDuels`);
                session.chat.text(`  §7Wins: ${c("white", s.wins)}  §7WLR: ${c("white", s.wlr)}  §7KDR: ${c("white", s.kdr)}  §7Winstreak: ${c("white", s.winstreak)}`);
                session.chat.text(`  §7Modes: §f${Object.keys(modes).slice(0, 8).join("§7, §f") || "(none)"}`);
            },
            "Duels stats for a player, optionally a single gamemode",
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
                session.chat.text(`  §7Wins: ${uhc.formatWins(s.wins)}  §7KDR: ${uhc.formatKdr(s.kdr)}  §7Score: ${c("white", s.score)}`);
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
                session.chat.text(`  §7Wins: ${tnt.formatWins(s.wins)}  §7Winstreak: ${c("white", s.winstreak)}`);
                session.chat.text(`  §7TNT Run: ${tnt.formatTntRun(s.tntRun)}  §7PvP Run: ${c("white", s.pvpRun)}  §7Bow Spleef: ${c("white", s.bowSpleef)}`);
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
                session.chat.text(`  §7Wins: ${mm.formatWins(s.wins)}  §7WLR: ${mm.formatWlr(s.wlr)}  §7KDR: ${c("white", s.kdr)}`);
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
                session.chat.text(`  §7Mythical: ${fish.formatMythical(s.mythicalCaught)}  §7Catches: ${fish.formatCatches(s.totalCatches)}  §7Special: ${c("white", s.specialCaught)}`);
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
