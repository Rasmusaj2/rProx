import { PREFIX } from "../core/chat";
import { actionName, isFakeUuid } from "../core/lobby";
import { SidebarInjector, SIDEBAR_LINES } from "../core/sidebar";
import type { Plugin, PlayerRef, Session } from "../core/types";
import {
    getHypixelService,
    duelsStats,
    duelsCategoryStats,
    duelsTargetFromText,
    fetchErrorMessage,
    type DuelsTarget,
} from "../services/hypixel";
import { duelsMode, duelsOverview } from "../services/duelsRender";
import { formatRankedName } from "../services/rank";
import { dashUuid, resolveUuid } from "../services/microsoft";
import { stripColorCodes } from "../util/mcColors";

// posts the stats of your opponent at duels game start detecting duel type from scoreboard and opponent from game start chat message

interface DuelsStatsConfig {
    enabled?: boolean;
    apiKey?: string; // empty falls back to builtInPlugins.hypixelStats.apiKey
    delaySeconds?: number;
    includeSelf?: boolean;
}

const DEFAULT_DELAY_SECONDS = 1;
const SEND_DELAY_MS = 500;

// opponenet detection stuff
const OPPONENT = /^\s+Opponents?:\s*(.+)$/i;
const BRACKETS = /\[[^\]]*\]/g;
const TOKEN = /[A-Za-z0-9_]+/g;
const NOT_A_NAME = new Set(["none", "and", "vs"]);

const RANK_COLORS: Record<string, string> = {
    "7": "NON",
    "a": "VIP/VIP+",
    "b": "MVP/MVP+",
    "9": "MVP/MVP+",
    "6": "MVP++",
    "c": "YouTube/Staff",
    "d": "NICKED",
};
const RANK_ORDER = ["7", "a", "b", "9", "6", "c", "d"];
const NICKED_COLOR = "d";
const RANK_TEAM = /^§([0-9a-f])$/i;
const OBFUSCATED = /§k/i;
const RANK_WAIT_MS = 3000;
const REPORT_DEBOUNCE_MS = 300;

interface Rank {
    color: string;
    label: string;
}

interface PendingRank {
    key: string; // stripped obfuscation name
    color: string;
    at: number;
}

interface SessionState {
    sidebar: SidebarInjector; // read only, never flushed, so it writes no packets
    enemies: Map<string, string>; // lowercase name -> name
    announced: Set<string>; // lowercase names already posted
    timer?: NodeJS.Timeout;
    tab: Map<string, string>; // uuid to tab name
    tabByName: Map<string, string>; // stripped name to uuid
    rankByUuid: Map<string, Rank>; // uuid to rank
    pendingRank: PendingRank[]; // members still waiting for entry (might be nicked)
    selfRank?: Rank;
    rankTimer?: NodeJS.Timeout;
    lastRanks: string;
    started: boolean;
}

// names no rank
function namesIn(rest: string): string[] {
    const names: string[] = [];
    for (const segment of rest.replace(BRACKETS, " ").split(",")) {
        for (const token of segment.match(TOKEN) ?? []) {
            if (token.length > 16 || NOT_A_NAME.has(token.toLowerCase())) continue;
            names.push(token);
        }
    }
    return names;
}

export const duelsStatsPlugin: Plugin = {
    name: "duelsStats",
    version: "0.1.0",
    description: "Posts the stats of your duels opponent(s) in the active mode when a game starts.",

    defaultConfig: {
        enabled: true,
        apiKey: "", // empty falls back to builtInPlugins.hypixelStats.apiKey
        delaySeconds: DEFAULT_DELAY_SECONDS,
        includeSelf: true,
    },

    setup(api) {
        const config = api.pluginConfig as DuelsStatsConfig;
        const apiKey = config.apiKey || (api.config.builtInPlugins?.hypixelStats as { apiKey?: string } | undefined)?.apiKey || "";
        if (!apiKey) {
            api.log.warn("no apiKey found, duelsStats is off (set builtInPlugins.hypixelStats.apiKey)");
            return;
        }

        // shared instance, the ttl and ratelimit state live on hypixelStats copy
        const hypixel = getHypixelService(api.http, apiKey);
        const sessions = new Map<string, SessionState>();

        const stateFor = (session: Session): SessionState => {
            let state = sessions.get(session.id);
            if (!state) {
                state = {
                    sidebar: new SidebarInjector(SIDEBAR_LINES),
                    enemies: new Map(),
                    announced: new Set(),
                    tab: new Map(),
                    tabByName: new Map(),
                    rankByUuid: new Map(),
                    pendingRank: [],
                    lastRanks: "",
                    started: false,
                };
                sessions.set(session.id, state);
            }
            return state;
        };

        api.on("sessionEnd", (session) => {
            const state = sessions.get(session.id);
            if (state?.timer) clearTimeout(state.timer);
            if (state?.rankTimer) clearTimeout(state.rankTimer);
            sessions.delete(session.id);
        });

        const rankOf = (color: string): Rank => ({ color, label: RANK_COLORS[color] });

        const rankKey = (name: string): string => stripColorCodes(name).replace(/[^a-z0-9_]/gi, "").toLowerCase();

        const prunePending = (state: SessionState, now: number): void => {
            state.pendingRank = state.pendingRank.filter((join) => now - join.at < RANK_WAIT_MS);
        };

        const inDuelsQueue = (session: Session, state: SessionState): boolean =>
            session.game === "duels" || isDuelsTitle(state.sidebar.title);

        const postRanks = (session: Session, state: SessionState): void => {
            if (sessions.get(session.id) !== state) return;
            if (!inDuelsQueue(session, state)) return;
            if (state.started) return;
            const counts = new Map<string, number>(); // colour to players
            for (const [uuid, rank] of state.rankByUuid) {
                if (!state.tab.has(uuid)) continue; // already left the queue
                counts.set(rank.color, (counts.get(rank.color) ?? 0) + 1);
            }
            if (config.includeSelf && state.selfRank) {
                counts.set(state.selfRank.color, (counts.get(state.selfRank.color) ?? 0) + 1);
            }
            const summary = [...counts.entries()]
                .sort((a, b) => RANK_ORDER.indexOf(a[0]) - RANK_ORDER.indexOf(b[0]))
                .map(([color, nicked]) => `§${color}${RANK_COLORS[color]} (${nicked})`)
                .join(", ");
            if (summary === state.lastRanks) return; // nothing changed, say nothing
            state.lastRanks = summary;
            session.chat.text(summary ? `${PREFIX} §bPregame ranks§7: ${summary}` : `${PREFIX} §bPregame ranks§7: §8empty`);
        };

        // join and rank packet are seperate so we need to wait for the rank packet to hit 
        // so we dont accidentally announce twice for a player (first announce being "nicked")
        const scheduleReport = (session: Session, state: SessionState): void => {
            if (state.started) return; // the match is on, the pregame tally is done
            if (state.rankTimer) clearTimeout(state.rankTimer);
            state.rankTimer = setTimeout(() => {
                state.rankTimer = undefined;
                postRanks(session, state);
            }, REPORT_DEBOUNCE_MS);
            state.rankTimer.unref?.();
        };

        const applyRankMember = (state: SessionState, color: string, member: string): void => {
            const now = Date.now();
            prunePending(state, now);
            const key = rankKey(member);
            const uuid = state.tabByName.get(key);
            if (uuid) {
                const known = state.rankByUuid.get(uuid);
                if (!known || known.color === NICKED_COLOR) state.rankByUuid.set(uuid, rankOf(color));
                return;
            }
            if (!state.pendingRank.some((join) => join.key === key)) state.pendingRank.push({ key, color, at: now });
        };

        const applyTabAdd = (state: SessionState, uuid: string, name: string): void => {
            const now = Date.now();
            prunePending(state, now);
            const prev = state.tab.get(uuid);
            if (prev !== undefined) {
                const prevKey = rankKey(prev);
                if (state.tabByName.get(prevKey) === uuid) state.tabByName.delete(prevKey); // rerolled
            }
            state.tab.set(uuid, name);
            state.tabByName.set(rankKey(name), uuid);

            if (!OBFUSCATED.test(name)) {
                state.rankByUuid.delete(uuid); // revealed or plain name, no pregame rank to hold
                return;
            }
            if (state.rankByUuid.has(uuid)) return;
            const index = state.pendingRank.findIndex((join) => join.key === rankKey(name));
            if (index !== -1) {
                const [pending] = state.pendingRank.splice(index, 1);
                state.rankByUuid.set(uuid, rankOf(pending.color));
                return;
            }
            state.rankByUuid.set(uuid, rankOf(NICKED_COLOR));
        };

        // keep hypixels rank teams in sync with tab list
        const applyRankTeam = (state: SessionState, session: Session, data: any): void => {
            const mode: number = data.mode;
            const color = RANK_TEAM.exec(data.team)?.[1]?.toLowerCase();
            if (!color) return;

            if (mode === 1) {
                // the rank teams being torn down means the match started, so stop
                // reporting and drop anything already queued to be announced
                state.started = true;
                if (state.rankTimer) clearTimeout(state.rankTimer);
                state.rankTimer = undefined;
                for (const [uuid, rank] of state.rankByUuid) if (rank.color === color) state.rankByUuid.delete(uuid);
                state.pendingRank = state.pendingRank.filter((join) => join.color !== color);
                if (state.selfRank?.color === color) state.selfRank = undefined;
                return;
            }
            if (mode !== 0 && mode !== 3) return; // only create and add carry members
            state.started = false; // a rank team exists again, so a pregame queue is on

            for (const member of data.players ?? []) {
                if (!OBFUSCATED.test(member)) {
                    if (member.toLowerCase() === session.username.toLowerCase()) state.selfRank = rankOf(color);
                    continue;
                }
                applyRankMember(state, color, member);
            }
            scheduleReport(session, state);
        };

        api.on("serverPacket", (name, data, session) => {
            const state = stateFor(session);
            try {
                switch (name) {
                    case "scoreboard_objective":
                        state.sidebar.applyObjective(data);
                        break;
                    case "scoreboard_display_objective":
                        state.sidebar.applyDisplayObjective(data);
                        break;
                    case "scoreboard_score":
                        state.sidebar.applyScore(data);
                        break;
                    case "scoreboard_team":
                        state.sidebar.applyTeam(data);
                        applyRankTeam(state, session, data);
                        break;
                    case "player_info": {
                        const action = actionName(data.action);
                        let changed = false;
                        for (const entry of data.data ?? []) {
                            const rawUuid = entry.uuid ?? entry.UUID;
                            if (!rawUuid) continue;
                            const uuid = dashUuid(rawUuid).toLowerCase();
                            if (action === "add_player") {
                                if (!entry.name) continue;
                                applyTabAdd(state, uuid, entry.name);
                                changed = true;
                            } else if (action === "remove_player") {
                                const name = state.tab.get(uuid);
                                if (name !== undefined) {
                                    const key = rankKey(name);
                                    if (state.tabByName.get(key) === uuid) state.tabByName.delete(key);
                                    state.pendingRank = state.pendingRank.filter((join) => join.key !== key);
                                }
                                if (state.tab.delete(uuid)) changed = true;
                                state.rankByUuid.delete(uuid);
                            }
                        }
                        if (changed) scheduleReport(session, state);
                        break;
                    }
                    case "login":
                        // a new server is a new game, forget the last one
                        if (state.timer) clearTimeout(state.timer);
                        state.timer = undefined;
                        if (state.rankTimer) clearTimeout(state.rankTimer);
                        state.rankTimer = undefined;
                        state.enemies.clear();
                        state.announced.clear();
                        state.tab.clear();
                        state.tabByName.clear();
                        state.rankByUuid.clear();
                        state.pendingRank = [];
                        state.selfRank = undefined;
                        state.lastRanks = "";
                        state.started = false;
                        state.sidebar.clear();
                        break;
                }
            } catch (error) {
                api.log.debug(`duelsStats ${name} handling failed: ${error}`);
            }
        });

        // check if its a duels sidebar
        const isDuelsTitle = (title: string | undefined): boolean =>
            !!title && /DUELS?/i.test(stripColorCodes(title));

        const inDuels = (session: Session, state: SessionState): boolean => {
            const title = state.sidebar.title;
            if (!title) return true; // sidebar not read yet, trust the message
            return isDuelsTitle(title) || session.game === "duels";
        };

        // the mode the client is currently playing, read off the scoreboard
        const targetFor = (state: SessionState): DuelsTarget | undefined => {
            const title = state.sidebar.title;
            if (!isDuelsTitle(title)) return undefined;
            const fromTitle = duelsTargetFromText(title!);
            if (fromTitle) return fromTitle;
            // some titles are just "DUELS", the mode then sits on a row
            for (const row of state.sidebar.rows()) {
                const target = duelsTargetFromText(row.text);
                if (target) return target;
            }
            return undefined;
        };

        const withUuid = async (player: PlayerRef): Promise<PlayerRef> => {
            if (player.uuid && !isFakeUuid(player.uuid)) return player;
            const uuid = await resolveUuid(api.http, player.name);
            return uuid ? { ...player, uuid } : player;
        };

        const nick = (session: Session, name: string): void => {
            session.chat.text(`${PREFIX} §cNICKED §7${name} §8- no account behind this name`);
        };

        const post = async (session: Session, name: string, target: DuelsTarget | undefined): Promise<void> => {
            const player = await withUuid(session.findPlayer(name) ?? { name });
            if (!player.uuid) {
                // no real account resolves to that name, so its a nick
                nick(session, name);
                return;
            }
            const result = await hypixel.fetchPlayer(player);
            if (result.status === "no_data") {
                nick(session, name);
                return;
            }
            if (result.status !== "ok") {
                api.log.debug(`duelsStats lookup for ${name} failed: ${result.status}`);
                session.chat.text(`${PREFIX} §c${fetchErrorMessage(result.status)} §7(${name})`);
                return;
            }
            const title = formatRankedName(result.player, name);
            const s = duelsStats(result.player);
            if (target?.kind === "category") {
                const category = duelsCategoryStats(s, target.category);
                duelsMode(session, title, category.combined, s.winstreaksHidden, category.modes);
            } else if (target?.kind === "mode") {
                duelsMode(session, title, s.modes[target.mode.key], s.winstreaksHidden);
            } else {
                duelsOverview(session, title, s); // no mode readable, fall back to the whole account
            }
        };

        const announce = async (session: Session, state: SessionState): Promise<void> => {
            if (sessions.get(session.id) !== state) return;
            if (!inDuels(session, state)) return;
            const pending = [...state.enemies.values()].filter((name) => !state.announced.has(name.toLowerCase()));
            if (pending.length === 0) return;
            const target = targetFor(state);
            api.log.debug(`duelsStats posting ${pending.length} opponent(s)${target ? "" : " (no mode detected)"}`);
            let first = true;
            for (const name of pending) {
                state.announced.add(name.toLowerCase());
                if (!first) await new Promise((resolve) => setTimeout(resolve, SEND_DELAY_MS));
                first = false;
                await post(session, name, target);
            }
        };

        const schedule = (session: Session, state: SessionState): void => {
            if (state.timer) clearTimeout(state.timer);
            state.timer = setTimeout(() => {
                state.timer = undefined;
                announce(session, state).catch((error) => api.log.error(`duelsStats announce failed: ${error}`));
            }, (config.delaySeconds ?? DEFAULT_DELAY_SECONDS) * 1000);
            state.timer.unref?.();
        };

        api.on("chat", (msg, session) => {
            const state = stateFor(session);
            const match = OPPONENT.exec(msg.text);
            if (!match) return;
            state.started = true;
            if (state.rankTimer) clearTimeout(state.rankTimer);
            state.rankTimer = undefined;
            const names = namesIn(match[1]).filter(
                (name) => name.toLowerCase() !== "none" && name.toLowerCase() !== session.username.toLowerCase(),
            );
            if (names.length === 0) return;
            for (const name of names) state.enemies.set(name.toLowerCase(), name);
            api.log.debug(`duelsStats opponents: ${names.join(", ")}`);
            schedule(session, state);
        });
    },
};

export default duelsStatsPlugin;
