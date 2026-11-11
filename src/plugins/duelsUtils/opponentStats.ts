import { PREFIX } from "../../core/chat";
import { isFakeUuid } from "../../core/lobby";
import { SidebarInjector, SIDEBAR_LINES } from "../../core/sidebar";
import type { PluginApi, PlayerRef, Session } from "../../core/types";
import {
    getHypixelService,
    duelsStats,
    duelsCategoryStats,
    duelsTargetFromText,
    duelsQueueForTeamSize,
    fetchErrorMessage,
    type DuelsTarget,
} from "../../services/hypixel";
import { duelsAnnounce, duelsAnnounceOverview } from "../../services/duelsRender";
import { formatRankedName } from "../../services/rank";
import { resolveUuid } from "../../services/microsoft";
import { OPPONENT, isDuelsTitle, trackSidebar } from "./shared";

// posts the stats of your opponent at duels game start detecting duel type from scoreboard and opponent from game start chat message

interface OpponentStatsConfig {
    enabled?: boolean;
    apiKey?: string; // empty falls back to builtInPlugins.hypixelStats.apiKey
    delaySeconds?: number;
}

const DEFAULT_DELAY_SECONDS = 1;
const SEND_DELAY_MS = 500;

// opponenet detection stuff
const BRACKETS = /\[[^\]]*\]/g;
const TOKEN = /[A-Za-z0-9_]+/g;
const NOT_A_NAME = new Set(["none", "and", "vs"]);

interface SessionState {
    sidebar: SidebarInjector; // read only, never flushed, so it writes no packets
    enemies: Map<string, string>; // lowercase name -> name
    announced: Set<string>; // lowercase names already posted
    timer?: NodeJS.Timeout;
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

export const OPPONENT_STATS_DEFAULTS = {
    enabled: true,
    apiKey: "", // empty falls back to builtInPlugins.hypixelStats.apiKey
    delaySeconds: DEFAULT_DELAY_SECONDS,
};

// posts the stats of your duels opponent(s) in the active mode when a game starts
export function registerOpponentStats(api: PluginApi): void {
    const config = (api.pluginConfig.opponentStats ?? {}) as OpponentStatsConfig;
    const on = () => config.enabled !== false; // read live, //config can flip it without a reload

    // avoid restart
    const hypixel = () => {
        const apiKey = config.apiKey || (api.config.builtInPlugins?.hypixelStats as { apiKey?: string } | undefined)?.apiKey || "";
        return getHypixelService(api.http, apiKey);
    };

    if (on() && !hypixel().enabled) {
        api.log.warn("no apiKey found, opponentStats is off until one is set (set builtInPlugins.hypixelStats.apiKey)");
    }

    const sessions = new Map<string, SessionState>();

    const stateFor = (session: Session): SessionState => {
        let state = sessions.get(session.id);
        if (!state) {
            state = {
                sidebar: new SidebarInjector(SIDEBAR_LINES),
                enemies: new Map(),
                announced: new Set(),
            };
            sessions.set(session.id, state);
        }
        return state;
    };

    api.on("sessionEnd", (session) => {
        const state = sessions.get(session.id);
        if (state?.timer) clearTimeout(state.timer);
        sessions.delete(session.id);
    });

    api.onCleanup(() => {
        for (const state of sessions.values()) {
            if (state.timer) clearTimeout(state.timer);
        }
        sessions.clear();
    });

    api.on("serverPacket", (name, data, session) => {
        const state = stateFor(session);
        try {
            trackSidebar(state.sidebar, name, data);
            if (name === "login") {
                // a new server is a new game, forget the last one
                if (state.timer) clearTimeout(state.timer);
                state.timer = undefined;
                state.enemies.clear();
                state.announced.clear();
            }
        } catch (error) {
            api.log.debug(`opponentStats ${name} handling failed: ${error}`);
        }
    });

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
        const result = await hypixel().fetchPlayer(player);
        if (result.status === "no_data") {
            nick(session, name);
            return;
        }
        if (result.status !== "ok") {
            api.log.debug(`opponentStats lookup for ${name} failed: ${result.status}`);
            session.chat.text(`${PREFIX} §c${fetchErrorMessage(result.status)} §7(${name})`);
            return;
        }
        const title = formatRankedName(result.player, name);
        const s = duelsStats(result.player);
        if (target?.kind === "category") {
            duelsAnnounce(session, title, duelsCategoryStats(s, target.category), s.winstreaksHidden); // can tell category
        } else if (target?.kind === "mode") {
            duelsAnnounce(session, title, duelsCategoryStats(s, target.mode.category), s.winstreaksHidden, target.mode.key);
        } else {
            duelsAnnounceOverview(session, title, s); // no mode readable, fall back to the whole account
        }
    };

    const announce = async (session: Session, state: SessionState): Promise<void> => {
        if (sessions.get(session.id) !== state) return;
        if (!on()) return;
        if (!hypixel().enabled) return; // no key yet
        if (!inDuels(session, state)) return;
        const pending = [...state.enemies.values()].filter((name) => !state.announced.has(name.toLowerCase()));
        if (pending.length === 0) return;
        let target = targetFor(state);
        if (target?.kind === "category") {
            // the scoreboard named the game but not the queue, so go off how many opponents there are
            const mode = duelsQueueForTeamSize(target.category, state.enemies.size);
            if (mode) target = { kind: "mode", mode };
        }
        api.log.debug(`opponentStats posting ${pending.length} opponent(s)${target ? "" : " (no mode detected)"}`);
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
            announce(session, state).catch((error) => api.log.error(`opponentStats announce failed: ${error}`));
        }, (config.delaySeconds ?? DEFAULT_DELAY_SECONDS) * 1000);
        state.timer.unref?.();
    };

    api.on("chat", (msg, session) => {
        const state = stateFor(session);
        const match = OPPONENT.exec(msg.text);
        if (!match) return;
        const names = namesIn(match[1]).filter(
            (name) => name.toLowerCase() !== "none" && name.toLowerCase() !== session.username.toLowerCase(),
        );
        if (names.length === 0) return;
        for (const name of names) state.enemies.set(name.toLowerCase(), name);
        api.log.debug(`opponentStats opponents: ${names.join(", ")}`);
        schedule(session, state);
    });
}
