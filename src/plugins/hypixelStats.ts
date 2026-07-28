import { PREFIX } from "../core/chat";
import type { Plugin, PlayerRef, Session, Tag } from "../core/types";
import {
    HypixelService,
    bedwarsStats,
    skywarsStats,
    duelsStats,
    fetchErrorMessage,
    type HypixelPlayer,
} from "../services/hypixel";
import { formatStar, starText, starColor, formatFkdr, fkdrColor } from "../services/bedwars";
import * as sw from "../services/skywars";
import * as duels from "../services/duels";
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
    version: "0.1.0",
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
                { text: s.levelText, short: s.levelText, formatted: s.levelFormatted, color: sw.levelColor(s.levelFormatted), prefix: true, tooltip, priority: 20, game: "skywars" },
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

        api.registerEnricher({
            name: "hypixelStats",
            async enrich(player) {
                const result = await fetch(player);
                if (result.status !== "ok") return null;
                // one api call already has everything, so build all three and let
                // the active game decide what actually gets shown
                return [...bedwarsTags(result.player), ...skywarsTags(result.player), ...duelsTags(result.player)];
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
    },
};

export default hypixelStatsPlugin;
