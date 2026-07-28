import { PREFIX } from "../core/chat";
import type { Plugin, PlayerRef, Session, Tag } from "../core/types";
import {
    HypixelService,
    bedwarsStats,
    skywarsStats,
    duelsStats,
    uhcStats,
    tntGamesStats,
    murderMysteryStats,
    fetchErrorMessage,
    type HypixelPlayer,
} from "../services/hypixel";
import { formatStar, starText, starColor, formatFkdr, fkdrColor } from "../services/bedwars";
import * as sw from "../services/skywars";
import * as duels from "../services/duels";
import * as uhc from "../services/uhc";
import * as tnt from "../services/tntgames";
import * as mm from "../services/murdermystery";
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

const c = (color: McColorName, value: string | number) => COLOR_CODES[color] + value;

export const hypixelStatsPlugin: Plugin = {
    name: "hypixelStats",
    version: "0.1.1",
    description: "Bedwars, SkyWars and Duels stats from the Hypixel API.",
    setup(api) {
        const config = api.pluginConfig as HypixelStatsConfig;
        const ttl = (config.cacheTtlSeconds ?? 300) * 1000;
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

        const fetch = async (player: PlayerRef) => {
            const result = await hypixel.fetchPlayer(await withUuid(player));
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

        api.registerEnricher({
            name: "hypixelStats",
            async enrich(player) {
                const result = await fetch(player);
                if (result.status !== "ok") return null;
                return [...bedwarsTags(result.player), ...skywarsTags(result.player), ...duelsTags(result.player), ...uhcTags(result.player), ...tntgamesTags(result.player), ...murdermysteryTags(result.player)];
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
            const result = await fetch(target);
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
                const s = uhcTags(found.player);
                session.chat.text(`${PREFIX} ${found.title} §7- §bUHC`);
                if (s.length === 0) {
                    session.chat.text(`  §7No UHC stats`);
                    return;
                }
                session.chat.text(`  §7Wins: ${s[0].formatted}  §7WLR: ${s[1].formatted}  §7KDR: ${s[2].formatted}`);
            },
            "UHC stats for a player (or yourself)",
        );
        api.registerCommand(
            "tnt",
            async (args, session) => {
                const found = await resolve(args, session);
                if (!found) return;
                const s = tntgamesTags(found.player);
                session.chat.text(`${PREFIX} ${found.title} §7- §bTNT Games`);
                if (s.length === 0) {
                    session.chat.text(`  §7No TNT Games stats`);
                    return;
                }
                session.chat.text(`  §7Wins: ${s[0].formatted}  §7WLR: ${s[1].formatted}`);
            },
            "TNT Games stats for a player (or yourself)",
        );
        api.registerCommand(
            "mm",
            async (args, session) => {
                const found = await resolve(args, session);
                if (!found) return;
                const s = murdermysteryTags(found.player);
                session.chat.text(`${PREFIX} ${found.title} §7- §bMurder Mystery`);
                if (s.length === 0) {
                    session.chat.text(`  §7No Murder Mystery stats`);
                    return;
                }
            }
        );
    },
};

export default hypixelStatsPlugin;
