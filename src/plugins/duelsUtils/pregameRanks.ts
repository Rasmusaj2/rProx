import { PREFIX } from "../../core/chat";
import { actionName } from "../../core/lobby";
import { SidebarInjector, SIDEBAR_LINES } from "../../core/sidebar";
import type { PluginApi, Session } from "../../core/types";
import { dashUuid } from "../../services/microsoft";
import { stripColorCodes } from "../../util/mcColors";
import { OPPONENT, isDuelsTitle, trackSidebar } from "./shared";

// tallies the ranks sitting in a duels pregame queue, names there are obfuscated but the rank colour is not

interface PregameRanksConfig {
    enabled?: boolean;
    includeSelf?: boolean;
}

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
    sidebar: SidebarInjector; // read only
    tab: Map<string, string>; // uuid to tab name
    tabByName: Map<string, string>; // stripped name to uuid
    rankByUuid: Map<string, Rank>; // uuid to rank
    pendingRank: PendingRank[]; // members still waiting for entry (might be nicked)
    selfRank?: Rank;
    rankTimer?: NodeJS.Timeout;
    lastRanks: string;
    started: boolean;
}

export const PREGAME_RANKS_DEFAULTS = {
    enabled: true,
    includeSelf: true,
};

export function registerPregameRanks(api: PluginApi): void {
    const config = (api.pluginConfig.pregameRanks ?? {}) as PregameRanksConfig;
    const on = () => config.enabled !== false; // read live, //config can flip it without a reload

    const sessions = new Map<string, SessionState>();

    const stateFor = (session: Session): SessionState => {
        let state = sessions.get(session.id);
        if (!state) {
            state = {
                sidebar: new SidebarInjector(SIDEBAR_LINES),
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
        if (state?.rankTimer) clearTimeout(state.rankTimer);
        sessions.delete(session.id);
    });

    api.onCleanup(() => {
        for (const state of sessions.values()) {
            if (state.rankTimer) clearTimeout(state.rankTimer);
        }
        sessions.clear();
    });

    const rankOf = (color: string): Rank => ({ color, label: RANK_COLORS[color] });

    const rankKey = (name: string): string => stripColorCodes(name).replace(/[^a-z0-9_]/gi, "").toLowerCase();

    const prunePending = (state: SessionState, now: number): void => {
        state.pendingRank = state.pendingRank.filter((join) => now - join.at < RANK_WAIT_MS);
    };

    const inDuelsQueue = (session: Session, state: SessionState): boolean =>
        session.game === "duels" || isDuelsTitle(state.sidebar.title);

    const postRanks = (session: Session, state: SessionState): void => {
        if (!on()) return;
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

    const stopReporting = (state: SessionState): void => {
        state.started = true;
        if (state.rankTimer) clearTimeout(state.rankTimer);
        state.rankTimer = undefined;
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
            stopReporting(state);
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
            trackSidebar(state.sidebar, name, data);
            switch (name) {
                case "scoreboard_team":
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
                    if (state.rankTimer) clearTimeout(state.rankTimer);
                    state.rankTimer = undefined;
                    state.tab.clear();
                    state.tabByName.clear();
                    state.rankByUuid.clear();
                    state.pendingRank = [];
                    state.selfRank = undefined;
                    state.lastRanks = "";
                    state.started = false;
                    break;
            }
        } catch (error) {
            api.log.debug(`pregameRanks ${name} handling failed: ${error}`);
        }
    });

    // the opponent line means the match is on, same as the rank teams going away
    api.on("chat", (msg, session) => {
        if (!OPPONENT.test(msg.text)) return;
        stopReporting(stateFor(session));
    });
}
