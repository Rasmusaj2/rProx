import { PREFIX, component, componentToLegacy } from "../core/chat";
import { BossBarInjector, type BossBarMode, type BossEntity } from "../core/bossbar";
import { gameFromTitle } from "../core/game";
import { MAX_ENTRY, SIDEBAR_LINES } from "../core/sidebar";
import { SidebarApi } from "../interface/sidebarApi";
import {
    DEFAULT_HEAT,
    MythicalFight,
    orbFromSkull,
    type FightState,
    type HeatModel,
} from "../services/mythical";
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

// heat is the thing worth a boss bar, see services/mythical. "progress" swaps
// the fill over to how close the fish is to being landed instead
type BarMode = "heat" | "progress";

interface MythicalConfig {
    enabled?: boolean; // follow the fight at all
    bossBar?: boolean; // and draw it as a boss bar
    debug?: boolean;
    bar?: BarMode; // what the fill means, heat by default
    bossBarMode?: BossBarMode; // how we get a bar on screen, see core/bossbar
    bossEntity?: BossEntity; // and what we hang it off
    adoptServerBar?: boolean; // old name for bossBarMode "adopt"
    heatPerClick?: number; // what one click in the red phase costs
    heatDecayPerSecond?: number; // how fast it bleeds back off
    heatMax?: number;
    safeHeat?: number; // at or under this, clicking in red is the plan again
}

const BAR_MODES: BossBarMode[] = ["replace", "adopt", "own"];
const BOSS_ENTITIES: BossEntity[] = ["dragon", "wither"];
const DEMO_SECONDS = 15; // how long //bossbar test leaves a bar up for
const DEMO_SWEEP_MS = 5000; // and how long one 0-100% sweep of it takes

interface LobbyFishingConfig {
    enabled?: boolean;
    sidebar?: boolean; // draw the session block under hypixels own fishing lines
    maxSidebarLines?: number; // rows the client will actually render, 15 on vanilla
    colors?: Partial<Record<RowKey, string>>; // per row number color, "gold" or "§6"
    spacer?: boolean; // blank row between hypixels rows and our session row
    hideRows?: string[]; // hypixel rows to drop for the room, matched colorless and case insensitively
    mythical?: MythicalConfig;
}

const ARMOR_STAND = 78; // object type, 1.8 spawns stands as objects rather than mobs
const HEAD_SLOT = 4; // entity_equipment slot the orb skull rides in
const META_CUSTOM_NAME = 2; // datawatcher slot holding the fishs health bar
const USE_ITEM = -1; // block_place direction for "right clicked nothing", ie. a reel

// one client tick. the injector only writes when a value actually moved, so
// this is a redraw rate rather than a packet rate
const FIGHT_TICK_MS = 50;

// hypixel announces your own mythical, which is what tells the fight the next
// fish to surface is yours and not the one the guy next to you hooked
const MYTHICAL_TITLE = /mythical fish/i;
const EMERGES = /emerges/i;

// the level row is the one nobody reads twice, and dropping it pays for the
// spacer so the block below still costs hypixel the same number of rows
const DEFAULT_HIDDEN_ROWS = ["hypixel level"];

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
    sidebar: SidebarApi;
    dumped?: boolean; // logged this lobbys rows already
    bossbar: BossBarInjector;
    fight: MythicalFight;
    ticker?: NodeJS.Timeout; // only runs while a mythical is on the line
    demoUntil?: number; // or while //bossbar test is showing off
}

// what goes on the sidebar, currently we can only do 3 lines because of 1.8 15 line limit for sidebars
// and doing more lines would override the built in hypixel fishing lines which we dont want to lose.
// the middle row is whichever of fish or plants the session has more
// plants show up on fishing friday from what i can tell ? might be wrong
const SESSION_WORDS = ["Session", "S."]; // fallback to shorthand if the lines get too long

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
    defaultConfig: {
        enabled: true,
        sidebar: true, // false still counts catches for //session, it just draws nothing
        maxSidebarLines: SIDEBAR_LINES, // rows your client renders, raise it if yours draws more than vanilla
        spacer: true, // blank row between hypixels rows and ours
        hideRows: DEFAULT_HIDDEN_ROWS, // hypixel rows to drop for the room, matched colorless and case insensitively
        colors: DEFAULT_COLORS, // per row number color, "gold" or "§6"
        mythical: {
            enabled: true, // follow the fight
            bossBar: true, // and draw it as a boss bar
            debug: false, // registers //bossbar
            bar: "heat", // what the fill means, "heat" or "progress"
            bossBarMode: "replace", // "replace", "adopt" or "own"
            bossEntity: "dragon", // "dragon" or "wither"
            heatPerClick: DEFAULT_HEAT.perClick,
            heatDecayPerSecond: DEFAULT_HEAT.decayPerSecond,
            heatMax: DEFAULT_HEAT.max,
            safeHeat: DEFAULT_HEAT.safe, // at or over this the bar says HOLD instead of CLICK
        },
    },
    setup(api) {
        const config = api.pluginConfig as LobbyFishingConfig;
        const useSidebar = config.sidebar !== false;
        const maxLines = Math.max(1, Math.floor(config.maxSidebarLines ?? SIDEBAR_LINES));
        const useSpacer = config.spacer !== false;
        const sessions = new Map<string, SessionState>();

        const mythicalConfig = config.mythical ?? {};
        const trackFight = mythicalConfig.enabled !== false;
        const useBossBar = mythicalConfig.bossBar !== false;
        const barMode: BarMode = mythicalConfig.bar === "progress" ? "progress" : "heat";
        const bossBarMode: BossBarMode = BAR_MODES.includes(mythicalConfig.bossBarMode as BossBarMode)
            ? (mythicalConfig.bossBarMode as BossBarMode)
            : mythicalConfig.adoptServerBar
              ? "adopt"
              : "replace";
        const bossEntity: BossEntity = BOSS_ENTITIES.includes(mythicalConfig.bossEntity as BossEntity)
            ? (mythicalConfig.bossEntity as BossEntity)
            : "dragon";
        const heat: HeatModel = {
            perClick: positive(mythicalConfig.heatPerClick, DEFAULT_HEAT.perClick),
            decayPerSecond: positive(mythicalConfig.heatDecayPerSecond, DEFAULT_HEAT.decayPerSecond),
            max: positive(mythicalConfig.heatMax, DEFAULT_HEAT.max),
            safe: atLeastZero(mythicalConfig.safeHeat, DEFAULT_HEAT.safe),
        };
        heat.safe = Math.min(heat.safe, heat.max);

        // a pattern the config got wrong would throw on every lobby, so build
        // them once here and drop the ones that dont compile
        const hidden: RegExp[] = [];
        for (const source of config.hideRows ?? DEFAULT_HIDDEN_ROWS) {
            try {
                hidden.push(new RegExp(source, "i"));
            } catch {
                api.log.warn(`hideRows entry "${source}" is not a valid regex, ignoring it`);
            }
        }

        // resolved once, a color the config got wrong is worth saying out loud
        const colors = {} as Record<RowKey, string>;
        for (const key of Object.keys(DEFAULT_COLORS) as RowKey[]) {
            const wanted = config.colors?.[key];
            const color = wanted ? parseColor(wanted) : undefined;
            if (wanted && !color) api.log.warn(`unknown color "${wanted}" for ${key}, using ${DEFAULT_COLORS[key]}`);
            colors[key] = COLOR_CODES[color ?? DEFAULT_COLORS[key]];
        }

        // the api writes to the client itself, so it needs the session rather
        // than being handed one a packet at a time
        const stateFor = (session: Session): SessionState => {
            let state = sessions.get(session.id);
            if (!state) {
                const sidebar = new SidebarApi(session, {
                    maxLines,
                    onError: (error) => api.log.debug(`sidebar update failed: ${error}`),
                });
                for (const pattern of hidden) sidebar.removeLines(pattern);
                sidebar.setEnabled(false);
                state = {
                    totals: emptyTotals(),
                    mythicals: {},
                    sidebar,
                    bossbar: new BossBarInjector({ mode: bossBarMode, entity: bossEntity }),
                    fight: new MythicalFight(heat),
                };
                sessions.set(session.id, state);
            }
            return state;
        };

        const elapsedOf = (state: SessionState) => (state.startedAt ? Date.now() - state.startedAt : 0);

        function sidebarLines(state: SessionState): string[] {
            const elapsed = elapsedOf(state);
            const totals = rowsFor(state.totals);
            const build = (word: string): string[] =>
                totals.map(
                    ([key, label, value]) =>
                        `§f${word} ${label}: ${colors[key]}${formatCount(value)} §8(§7${formatRate(value, elapsed)}/h§8)`,
                );
            let rows = build(SESSION_WORDS[0]);
            for (const word of SESSION_WORDS.slice(1)) {
                if (rows.every((row) => row.length <= MAX_ENTRY)) break;
                rows = build(word);
            }
            // the blank sits above our block so hypixels rows dont run into ours.
            return useSpacer ? [" ", ...rows] : rows;
        }

        const showable = (state: SessionState): boolean =>
            useSidebar &&
            totalCatches(state.totals) > 0 &&
            gameFromTitle(state.sidebar.serverTitle ?? "") === "lobby";

        // say what we want up there. the api coalesces the packets itself, so
        // this is safe to call as often as something worth redrawing happens
        function refresh(state: SessionState): void {
            const drawing = showable(state);
            // hideRows is only as good as the text it is matched against, so
            // put that text in the log once per lobby to compare it to
            if (drawing && !state.dumped) {
                state.dumped = true;
                for (const row of state.sidebar.serverRows()) {
                    api.log.debug(`sidebar ${String(row.score).padStart(3)} ${JSON.stringify(row.text)}`); // lmao this prints emojis in consle
                }
            }
            state.sidebar.setEnabled(drawing);
            if (drawing) state.sidebar.setLines(sidebarLines(state));
        }

        api.on("serverPacket", (name, data, session) => {
            const state = stateFor(session);
            if (!state.sidebar.handlePacket(name, data)) return;
            if (name === "login") {
                // a new lobby is a fresh set of rows worth logging again
                state.dumped = false;
                return;
            }
            // the rates are time based, so the rows get rebuilt against whatever
            // hypixel just sent rather than left to go stale
            refresh(state);
        });

        // what the bar says
        function barTitle(fight: FightState): string {
            const percent = Math.round((fight.heat / heat.max) * 100);
            const hot = fight.heat > heat.safe;
            const heatColor = fight.heat >= heat.max * 0.85 ? "§c" : hot ? "§e" : "§a";
            const head = fight.phase === "green" ? "§a§lREEL" : hot ? "§c§lHOLD" : "§e§lCLICK"; // REEL on green phase, HOLD above hot on red, CLICK below hot on red
            const parts = [head, `§7Heat ${heatColor}${percent}%`];
            if (fight.orb) parts.push(`§6${titleCase(fight.orb)}`);
            if (fight.maxClicks) parts.push(`§f${Math.min(fight.clicks, fight.maxClicks)}§7/§f${fight.maxClicks}`);
            else parts.push(`§f${fight.clicks} §7reels`);
            parts.push(`§7${fight.secondsLeft}s`);
            return parts.join(" §8| ");
        }

        function barProgress(fight: FightState): number {
            if (barMode === "progress" && fight.maxClicks) return fight.clicks / fight.maxClicks;
            return fight.heat / heat.max;
        }

        function pushBar(session: Session, state: SessionState): void {
            try {
                state.bossbar.flush((name, data) => session.sendPacket(name, data));
            } catch (error) {
                api.log.debug(`boss bar update failed: ${error}`);
            }
        }

        function stopTicker(state: SessionState): void {
            if (state.ticker) clearInterval(state.ticker);
            state.ticker = undefined;
        }

        // heat only moves with time on test bar
        function startTicker(session: Session, state: SessionState): void {
            if (state.ticker) return;
            let announced = false;
            state.ticker = setInterval(() => {
                const now = Date.now();
                // //bossbar test wins over a fight, its there to be looked at
                if (state.demoUntil) {
                    if (now < state.demoUntil) {
                        const left = (state.demoUntil - now) / 1000;
                        const progress = ((now % DEMO_SWEEP_MS) / DEMO_SWEEP_MS);
                        state.bossbar.set({
                            title: `§b§lrProx test bar §8| §f${Math.round(progress * 100)}% §8| §7${left.toFixed(0)}s`,
                            progress,
                        });
                        pushBar(session, state);
                        return;
                    }
                    state.demoUntil = undefined;
                    state.bossbar.set(null);
                    pushBar(session, state);
                }
                const fight = state.fight.sample(now);
                if (!fight) {
                    stopTicker(state);
                    state.bossbar.set(null);
                    pushBar(session, state);
                    return;
                }
                if (!useBossBar) return;
                state.bossbar.set({ title: barTitle(fight), progress: barProgress(fight) });
                pushBar(session, state);
                // whether the bar we ended up on is one of hypixels or one of ours
                // is the first thing worth knowing when it does not show up
                if (!announced) {
                    announced = true;
                    api.log.debug(`boss bar up, hosting: ${state.bossbar.hosting}`);
                }
            }, FIGHT_TICK_MS);
            state.ticker.unref?.();
        }

        function moved(state: SessionState, x: number, y: number, z: number): void {
            state.bossbar.setPlayerPosition(x, y, z);
            state.fight.setPlayerPosition(x, y, z);
        }

        // fight on entities since its not announced in chat
        api.on("serverPacket", (name, data, session) => {
            if (!trackFight) return;
            const state = stateFor(session);
            const now = Date.now();
            try {
                switch (name) {
                    case "spawn_entity":
                        // 1.8 sends entity positions as 32nds of a block
                        if (data.type === ARMOR_STAND) {
                            state.fight.trackStand(data.entityId, data.x / 32, data.y / 32, data.z / 32, now);
                        }
                        return;
                    case "entity_equipment":
                        if (data.slot === HEAD_SLOT) state.fight.trackHead(data.entityId, orbFromSkull(data.item));
                        return;
                    case "entity_metadata": {
                        state.bossbar.applyMetadata(data);
                        const custom = customName(data.metadata);
                        if (custom === undefined) return;
                        const before = state.fight.active;
                        if (!state.fight.trackName(data.entityId, custom, now)) {
                            if (custom && state.fight.watching(data.entityId, now)) {
                                api.log.debug(`unread nametag near the fish: ${JSON.stringify(custom)}`);
                            }
                            return;
                        }
                        if (!before) {
                            api.log.debug(`mythical on the line: ${JSON.stringify(custom)}`);
                            startTicker(session, state);
                        }
                        return;
                    }
                    case "entity_destroy":
                        state.bossbar.applyDestroy(data);
                        state.fight.remove(data.entityIds ?? []);
                        return;
                    case "spawn_entity_living":
                        state.bossbar.applySpawnLiving(data);
                        return;
                    case "update_attributes":
                        state.bossbar.applyAttributes(data);
                        return;
                    case "entity_teleport":
                    case "rel_entity_move":
                    case "entity_move_look":
                    case "entity_look":
                        state.bossbar.applyMove(name, data);
                        return;
                    case "entity_head_rotation":
                        state.bossbar.applyHeadRotation(data);
                        return;
                    case "position":
                        if (!data.flags) {
                            moved(state, data.x, data.y, data.z);
                            state.bossbar.setPlayerLook(data.yaw, data.pitch);
                        }
                        return;
                    case "title":
                        if (data.action !== 0 && data.action !== 1) return;
                        if (!isMythicalTitle(componentToLegacy(api.config.proxy.version, data.text))) return;
                        state.fight.arm(now);
                        return;
                    case "login":
                    case "respawn": // on server transfer throw away everything
                        state.bossbar.clear();
                        state.fight.end();
                        stopTicker(state);
                        return;
                    default:
                        return;
                }
            } catch (error) {
                api.log.debug(`mythical ${name} handling failed: ${error}`);
            }
        });

        api.on("clientPacket", (name, data, session) => {
            if (!trackFight) return;
            const state = stateFor(session);
            try {
                // a wither only draws a bar while it is in shot, so where the player
                // is looking is as load bearing as where they are standing
                if (name === "position" || name === "position_look") {
                    moved(state, data.x, data.y, data.z);
                    if (name === "position_look") state.bossbar.setPlayerLook(data.yaw, data.pitch);
                    return;
                }
                if (name === "look") {
                    state.bossbar.setPlayerLook(data.yaw, data.pitch);
                    return;
                }
                if (!state.fight.active) return;
                // a reel is a right click on nothing, aiming at an entity doesnt send this packet but does an entity interaction as well
                // which doesnt count, same reason a rod isnt thrown in this case
                if (name === "block_place" && data.direction === USE_ITEM) state.fight.click(Date.now());
                else if (name === "use_entity" && data.mouse !== 1) state.fight.click(Date.now());
            } catch (error) {
                api.log.debug(`mythical ${name} handling failed: ${error}`);
            }
        });

        api.on("chat", (msg, session) => {
            const caught = parseCatch(msg.formatted);
            if (!caught) return;
            const state = stateFor(session);
            state.totals[caught.kind]++;
            state.startedAt ??= Date.now();
            if (caught.orb) recordMythical(state.mythicals, caught.orb, caught.weight);
            const what = caught.orb
                ? `${mythicalName(caught.orb)}${caught.weight ? ` (${caught.weight}kg)` : ""}`
                : caught.kind;
            api.log.debug(`caught ${what} (${totalCatches(state.totals)} this session)`);
            if (caught.kind === "mythical" && state.fight.active) {
                const guess = state.fight.orbName;
                if (guess && caught.orb && guess !== caught.orb) {
                    api.log.debug(`fight read the skull as ${guess}, caught ${caught.orb}`);
                }
                state.fight.end();
            }
            refresh(state);
        });

        api.on("sessionEnd", (session) => {
            const state = sessions.get(session.id);
            if (state) {
                state.sidebar.dispose();
                stopTicker(state);
            }
            sessions.delete(session.id);
        });

        api.registerCommand(
            "session",
            (args, session) => {
                const state = stateFor(session);
                if (args[0]?.toLowerCase() === "reset") {
                    state.totals = emptyTotals();
                    state.mythicals = {};
                    state.startedAt = undefined;
                    refresh(state);
                    session.chat.text(`${PREFIX} §7Session catches reset.`);
                    return;
                }
                if (args[0]) { // incase of reset typo
                    session.chat.text(`${PREFIX} §7Usage: §f${api.config.commandPrefix}session §8[reset]`);
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
            `session lobby fishing counts, ${api.config.commandPrefix}session [reset]`,
        );

        // debug command for boss bar
        if (mythicalConfig.debug) {
            api.registerCommand(
                "bossbar",
                (args, session) => {
                    const state = stateFor(session);
                    const send = (name: string, data: unknown) => session.sendPacket(name, data);
                    const sub = args[0]?.toLowerCase() ?? "info";
                    switch (sub) {
                        case "test": {
                            const seconds = Math.min(120, positive(Number(args[1]), DEMO_SECONDS));
                            state.demoUntil = Date.now() + seconds * 1000;
                            startTicker(session, state);
                            session.chat.text(`${PREFIX} §7Test bar up for §f${seconds}s §8(${state.bossbar.hosting})`);
                            return;
                        }
                        case "off":
                            state.demoUntil = undefined;
                            state.fight.end();
                            state.bossbar.set(null);
                            pushBar(session, state);
                            stopTicker(state);
                            session.chat.text(`${PREFIX} §7Bar cleared.`);
                            return;
                        case "mode": {
                            const mode = args[1]?.toLowerCase() as BossBarMode;
                            if (!BAR_MODES.includes(mode)) {
                                session.chat.text(`${PREFIX} §7Modes: §f${BAR_MODES.join("§7, §f")}`);
                                return;
                            }
                            state.bossbar.setMode(mode, send);
                            session.chat.text(`${PREFIX} §7Boss bar mode is now §f${mode}§7.`);
                            return;
                        }
                        case "entity": {
                            const entity = args[1]?.toLowerCase() as BossEntity;
                            if (!BOSS_ENTITIES.includes(entity)) {
                                session.chat.text(`${PREFIX} §7Entities: §f${BOSS_ENTITIES.join("§7, §f")}`);
                                return;
                            }
                            state.bossbar.setEntity(entity, send);
                            session.chat.text(`${PREFIX} §7Boss bar entity is now §f${entity}§7.`);
                            return;
                        }
                        case "info":
                            session.chat.text(`${PREFIX} §7Boss bar`);
                            for (const line of state.bossbar.describe()) session.chat.text(`  §8${line}`);
                            for (const line of state.fight.describe(Date.now())) session.chat.text(`  §8${line}`);
                            return;
                        default:
                            session.chat.text(
                                `${PREFIX} §7Usage: §f${api.config.commandPrefix}bossbar §8[info|test [s]|off|mode <${BAR_MODES.join("|")}>|entity <${BOSS_ENTITIES.join("|")}>]`,
                            );
                    }
                },
                `test and tune the mythical boss bar, ${api.config.commandPrefix}bossbar info`,
            );

            api.log.info(`lobby catch tracking active (sidebar: ${useSidebar}, ${maxLines} row cap)`);
            if (trackFight) {
                api.log.info(
                    `mythical fight tracking active (boss bar: ${useBossBar} ${bossBarMode}/${bossEntity}, fill: ${barMode}, heat ${heat.perClick}/click, -${heat.decayPerSecond}/s)`,
                );
            }
        }
    }
};

function customName(metadata: unknown): string | undefined {
    if (!Array.isArray(metadata)) return undefined;
    const entry = metadata.find((item) => item && (item as { key: number }).key === META_CUSTOM_NAME);
    const value = (entry as { value?: unknown } | undefined)?.value;
    return typeof value === "string" ? value : undefined;
}

function isMythicalTitle(text: string): boolean {
    return MYTHICAL_TITLE.test(text) && EMERGES.test(text);
}

function titleCase(word: string): string {
    return word.charAt(0).toUpperCase() + word.slice(1);
}

function positive(value: unknown, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function atLeastZero(value: unknown, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

export default lobbyFishingPlugin;
