import { PREFIX, component } from "../core/chat";
import { gameFromTitle } from "../core/game";
import { SIDEBAR_LINES, SidebarInjector } from "../core/sidebar";
import {
    CATCH_KINDS,
    CATCH_LABELS,
    emptyTotals,
    formatCount,
    formatElapsed,
    formatRate,
    mythicalName,
    mythicalTooltip,
    parseCatch,
    recordMythical,
    totalCatches,
    type CatchKind,
    type CatchTotals,
    type MythicalTotals,
} from "../services/fishing";
import { COLOR_CODES, colorFromCode, colorFromName, type McColorName } from "../util/mcColors";
import type { Plugin, Session } from "../core/types";

// the totals a row can be drawn for, and what the config colors are keyed on
type RowKey = CatchKind | "total";

interface LobbyFishingConfig {
    enabled?: boolean;
    sidebar?: boolean; // draw the session block under hypixels own fishing lines
    maxSidebarLines?: number; // rows the client will actually render, 15 on vanilla
    colors?: Partial<Record<RowKey, string>>; // per row number color, "gold" or "§6"
}

const DEFAULT_COLORS: Record<RowKey, McColorName> = {
    total: "green",
    fish: "yellow",
    plant: "dark_green",
    mythical: "gold",
    treasure: "aqua",
    junk: "gray",
    creature: "light_purple",
};

// "gold", "§6" and "6" all name the same color
function parseColor(value: string): McColorName | undefined {
    return colorFromName(value) ?? colorFromCode(value.replace(/^§/, ""));
}

interface SessionState {
    totals: CatchTotals;
    mythicals: MythicalTotals; // which orbs, for the //session hover
    startedAt?: number; // starts at first catch
    sidebar: SidebarInjector;
    flush?: NodeJS.Immediate;
}

// what goes on the sidebar, currently we can only do 3 lines because of 1.8 15 line limit for sidebars
// and doing more lines would override the built in hypixel fishing lines which we dont want to lose.
// the middle row is whichever of fish or plants the session has more
// plants show up on fishing friday from what i can tell ? might be wrong
function rowsFor(totals: CatchTotals): Array<[key: RowKey, label: string, value: number]> {
    const headline: CatchKind = totals.plant > totals.fish ? "plant" : "fish";
    return [
        ["total", "Catches", totalCatches(totals)],
        [headline, CATCH_LABELS[headline], totals[headline]],
        ["mythical", "Mythicals", totals.mythical],
    ];
}

export const lobbyFishingPlugin: Plugin = {
    name: "lobbyFishing",
    version: "0.1.0",
    description: "Session catch counts and hourly rates on the main lobby sidebar.",
    setup(api) {
        const config = api.pluginConfig as LobbyFishingConfig;
        const useSidebar = config.sidebar !== false;
        const maxLines = Math.max(1, Math.floor(config.maxSidebarLines ?? SIDEBAR_LINES));
        const sessions = new Map<string, SessionState>();

        // resolved once, a color the config got wrong is worth saying out loud
        const colors = {} as Record<RowKey, string>;
        for (const key of Object.keys(DEFAULT_COLORS) as RowKey[]) {
            const wanted = config.colors?.[key];
            const color = wanted ? parseColor(wanted) : undefined;
            if (wanted && !color) api.log.warn(`unknown color "${wanted}" for ${key}, using ${DEFAULT_COLORS[key]}`);
            colors[key] = COLOR_CODES[color ?? DEFAULT_COLORS[key]];
        }

        const stateFor = (id: string): SessionState => {
            let state = sessions.get(id);
            if (!state) {
                state = { totals: emptyTotals(), mythicals: {}, sidebar: new SidebarInjector(maxLines) };
                sessions.set(id, state);
            }
            return state;
        };

        const elapsedOf = (state: SessionState) => (state.startedAt ? Date.now() - state.startedAt : 0);

        function sidebarLines(state: SessionState): string[] {
            const elapsed = elapsedOf(state);
            return rowsFor(state.totals).map(
                ([key, label, value]) =>
                    `§eSession ${label}: ${colors[key]}${formatCount(value)} §8(§7${formatRate(value, elapsed)}/h§8)`,
            );
        }

        const showable = (state: SessionState): boolean =>
            useSidebar &&
            totalCatches(state.totals) > 0 && 
            gameFromTitle(state.sidebar.title ?? "") === "lobby";

        function schedule(session: Session, state: SessionState): void {
            if (state.flush) return;
            state.flush = setImmediate(() => {
                state.flush = undefined;
                state.sidebar.set(showable(state) ? sidebarLines(state) : []);
                try {
                    state.sidebar.flush((name, data) => session.sendPacket(name, data));
                } catch (error) {
                    api.log.debug(`sidebar update failed: ${error}`);
                }
            });
        }

        api.on("serverPacket", (name, data, session) => {
            const state = stateFor(session.id);
            try {
                if (name === "scoreboard_objective") state.sidebar.applyObjective(data);
                else if (name === "scoreboard_display_objective") state.sidebar.applyDisplayObjective(data);
                else if (name === "scoreboard_score") state.sidebar.applyScore(data);
                else if (name === "login") {
                    // hypixel moves you between lobbies with a fresh login packet
                    // and the client bins its scoreboard when one lands
                    state.sidebar.clear();
                    return;
                } else return;
            } catch (error) {
                api.log.debug(`${name} handling failed: ${error}`);
                return;
            }
            schedule(session, state);
        });

        api.on("chat", (msg, session) => {
            const caught = parseCatch(msg.text);
            if (!caught) return;
            const state = stateFor(session.id);
            state.totals[caught.kind]++;
            state.startedAt ??= Date.now();
            if (caught.orb) recordMythical(state.mythicals, caught.orb, caught.weight);
            const what = caught.orb
                ? `${mythicalName(caught.orb)}${caught.weight ? ` (${caught.weight}kg)` : ""}`
                : caught.kind;
            api.log.debug(`caught ${what} (${totalCatches(state.totals)} this session)`);
            schedule(session, state);
        });

        api.on("sessionEnd", (session) => {
            const state = sessions.get(session.id);
            if (state?.flush) clearImmediate(state.flush);
            sessions.delete(session.id);
        });

        api.registerCommand(
            "session",
            (args, session) => {
                const state = stateFor(session.id);
                if (args[0]?.toLowerCase() === "reset") {
                    state.totals = emptyTotals();
                    state.mythicals = {};
                    state.startedAt = undefined;
                    schedule(session, state);
                    session.chat.text(`${PREFIX} §7Session catches reset.`);
                    return;
                }
                if (args[0]) { // incase of reset typo
                    session.chat.text(`${PREFIX} §7Usage: §f${api.config.commandPrefix}catches §8[reset]`);
                    return;
                }

                const total = totalCatches(state.totals);
                if (total === 0) {
                    session.chat.text(`${PREFIX} §7Nothing caught yet this session.`);
                    return;
                }
                const elapsed = elapsedOf(state);
                // same numbers, same colors as the sidebar
                const row = (key: RowKey, label: string, value: number) =>
                    `  §f${label}: ${colors[key]}${formatCount(value)} §8(§7${formatRate(value, elapsed)}/h§8)`;

                session.chat.text(`${PREFIX} §7Session catches §8- §f${formatElapsed(elapsed)} §7fishing`);
                session.chat.text(row("total", "Total", total));
                for (const kind of CATCH_KINDS) {
                    if (!state.totals[kind]) continue;
                    const line = row(kind, CATCH_LABELS[kind], state.totals[kind]);
                    // the mythical row carries the breakdown of which orbs in its hover,
                    // theres no room for eight of them on the line itself
                    const tooltip = kind === "mythical" ? mythicalTooltip(state.mythicals) : "";
                    if (tooltip) session.chat.raw(component([{ text: line, tooltip }]));
                    else session.chat.text(line);
                }
            },
            `session lobby fishing counts, ${api.config.commandPrefix}catches [reset]`,
        );

        api.log.info(`lobby catch tracking active (sidebar: ${useSidebar}, ${maxLines} row cap)`);
    },
};

export default lobbyFishingPlugin;
