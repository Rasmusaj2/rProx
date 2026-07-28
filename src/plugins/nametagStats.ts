import type { EnrichmentEngine } from "../core/enrichment";
import type { Plugin, PlayerRef, Session, Tag } from "../core/types";
import { actionName } from "../core/lobby";
import { componentToLegacy } from "../core/chat";
import { GameTracker, tagsForGame, type GameMode } from "../core/game";
import { dashUuid } from "../services/microsoft";
import { COLOR_CODES, colorFromCode, lastColor } from "../util/mcColors";

interface NametagConfig {
    enabled?: boolean;
    aboveHead?: boolean;
    tablist?: boolean;
    cacheTtlSeconds?: number;
    maxTablistPlayers?: number; // limit amounts to lookup to avoid wasting ratelimit on big hubs, default 32
    lookupConcurrency?: number; // concurrency, default 4
}

interface TeamInfo {
    complete: boolean;
    name: string;
    serverPrefix: string; // exactly as the server sent it, never our additions
    serverSuffix: string;
    friendlyFire: number;
    nameTagVisibility: string;
    color: number;
    players: Set<string>;
    applied?: { prefix: string; suffix: string }; // what we last pushed
}

interface TabEntry {
    name: string;
    serverDisplay?: string; // server display name rendered to legacy, if any
    applied?: string; // what we last pushed
}

interface SessionState {
    teams: Map<string, TeamInfo>;
    memberTeam: Map<string, string>; // lowercase name -> team name
    tab: Map<string, TabEntry>; // uuid -> entry
    tabByName: Map<string, string>; // lowercase name -> uuid
    tagCache: Map<string, { tags: Tag[]; expires: number }>;
    pending: Set<string>;
    dirty: Set<string>;
    games: GameTracker;
    schedule: (fn: () => Promise<void>) => void; // own queue, see stateFor
}

const MAX_TEAM_FIELD = 16; // protocol cap on a 1.8 team prefix/suffix
const MAX_TAB_SUFFIX = 32;

const byPriority = (a: Tag, b: Tag) => (b.priority ?? 0) - (a.priority ?? 0); // higher priority first, undefined is 0

function renderTag(tag: Tag): string {
    return tag.formatted ?? COLOR_CODES[tag.color ?? "gray"] + (tag.short ?? tag.text);
}

// trailing suffix since 1.8 gives us a 32 char limit, so we need to weigh by priority
function buildSuffix(tags: Tag[], budget: number): string {
    let out = "";
    for (const tag of [...tags].sort(byPriority)) {
        if (!tag.formatted && !(tag.short ?? tag.text)) continue;
        const piece = ` ${renderTag(tag)}`;
        if (out.length + piece.length > budget) break;
        out += piece;
    }
    return out;
}

// bracketed prefix, e.g. "§8[§b✫312§8] "
function buildPrefix(tags: Tag[]): string {
    const parts = [...tags].sort(byPriority).map(renderTag);
    return parts.length ? `§8[${parts.join("§8 ")}§8] ` : "";
}

// the pair of builders a name gets decorated with
// use factory-ish patterns to have different renderers for each gamemode
interface NametagRenderer {
    prefix(tags: Tag[]): string;
    suffix(tags: Tag[], budget: number): string;
}

function makeRenderer(game: GameMode): NametagRenderer {
    return {
        prefix: (tags) => buildPrefix(tagsForGame(tags, game).filter((t) => t.prefix)),
        suffix: (tags, budget) => buildSuffix(tagsForGame(tags, game).filter((t) => !t.prefix), budget),
    };
}

// create the renderer the first time its called, cached for later use
const RENDERERS = new Map<GameMode, NametagRenderer>();
function rendererFor(game: GameMode): NametagRenderer {
    let renderer = RENDERERS.get(game);
    if (!renderer) {
        renderer = makeRenderer(game);
        RENDERERS.set(game, renderer);
    }
    return renderer;
}

function hasColorCode(str: string): boolean {
    return /§[0-9a-f]/i.test(str);
}

// queue with a ceiling on how many jobs run at once
function limiter(max: number): (fn: () => Promise<void>) => void {
    let active = 0;
    const queue: Array<() => Promise<void>> = [];
    const pump = () => {
        while (active < max && queue.length) {
            const fn = queue.shift()!;
            active++;
            void fn().finally(() => {
                active--;
                pump();
            });
        }
    };
    return (fn) => {
        queue.push(fn);
        pump();
    };
}

export function createNametagStatsPlugin(enrichment: EnrichmentEngine): Plugin { // this is not 
    return {
        name: "nametagStats",
        version: "0.1.0",
        description: "Stats on tab list entries and above-head nametags.",
        setup(api) {
            const config = api.pluginConfig as NametagConfig;
            const ttl = (config.cacheTtlSeconds ?? 120) * 1000;
            const doAboveHead = config.aboveHead !== false;
            const doTablist = config.tablist !== false;
            const maxTab = config.maxTablistPlayers ?? 32;
            const version = api.config.proxy.version;
            const concurrency = Math.max(1, config.lookupConcurrency ?? 4);
            const sessions = new Map<string, SessionState>();

            const stateFor = (id: string): SessionState => {
                let state = sessions.get(id);
                if (!state) {
                    state = {
                        teams: new Map(),
                        memberTeam: new Map(),
                        tab: new Map(),
                        tabByName: new Map(),
                        tagCache: new Map(),
                        pending: new Set(),
                        dirty: new Set(),
                        games: new GameTracker(),
                        schedule: limiter(concurrency),
                    };
                    sessions.set(id, state);
                }
                return state;
            };

            api.on("sessionEnd", (session) => sessions.delete(session.id)); // cleanup

            api.on("serverPacket", (name, data, session) => {
                try {
                    if (name === "scoreboard_team") handleTeam(data, session); // update team info, which drives above-head nametags and tablist names
                    else if (name === "player_info") handleTabList(data, session); // update tablist info, which drives tablist names
                    else if (name === "scoreboard_objective") {
                        if (stateFor(session.id).games.applyObjective(data)) onGameChange(session); // objective title changed, change gamemode 
                    } else if (name === "scoreboard_display_objective") {
                        if (stateFor(session.id).games.applyDisplayObjective(data)) onGameChange(session); // sidebar objective changed, change gamemode
                    }
                } catch (error) {
                    api.log.debug(`${name} handling failed: ${error}`);
                }
            });

            // a different game means a different set of stats on every name, so redo everything when the game changes
            function onGameChange(session: Session): void {
                const state = stateFor(session.id);
                session.game = state.games.game;
                api.log.info(`game is now ${session.game}`);
                for (const uuid of state.tab.keys()) queueTab(session, state, uuid);
                for (const teamName of state.teams.keys()) queueTeam(session, state, teamName);
            }

            // a players tags, cached per name for this session
            async function tagsFor(state: SessionState, player: PlayerRef): Promise<Tag[]> {
                const key = player.name.toLowerCase();
                const hit = state.tagCache.get(key);
                if (hit && hit.expires > Date.now()) return hit.tags;
                const tags = await enrichment.collect(player, "GAME");
                state.tagCache.set(key, { tags, expires: Date.now() + ttl });
                return tags;
            }

            // run job under a key, coalescing repeats: if the same key comes in
            // while one is in flight it re-runs once afterwards
            function run(state: SessionState, key: string, job: () => Promise<void>): void {
                if (state.pending.has(key)) {
                    state.dirty.add(key);
                    return;
                }
                state.pending.add(key);
                state.schedule(async () => {
                    try {
                        await job();
                    } finally {
                        state.pending.delete(key);
                        if (state.dirty.delete(key)) run(state, key, job);
                    }
                });
            }

            // what the client sees in the tab list, which is what we decorate
            // this is SO terrible
            function handleTabList(data: any, session: Session): void {
                const state = stateFor(session.id);
                const action = actionName(data.action);

                for (const entry of data.data ?? []) {
                    const rawUuid = entry.uuid ?? entry.UUID;
                    if (!rawUuid) continue;
                    const uuid = dashUuid(rawUuid).toLowerCase();

                    if (action === "add_player") {
                        if (!entry.name) continue;
                        state.tab.set(uuid, {
                            name: entry.name,
                            serverDisplay: entry.displayName ? componentToLegacy(version, entry.displayName) : undefined,
                        });
                        state.tabByName.set(entry.name.toLowerCase(), uuid);
                        queueTab(session, state, uuid);
                    } else if (action === "remove_player") {
                        const known = state.tab.get(uuid);
                        if (known) {
                            // drop the cached stats so a rejoin re-reads them
                            // instead of showing a stale snapshot, and so long
                            // sessions dont grow forever
                            state.tabByName.delete(known.name.toLowerCase());
                            state.tagCache.delete(known.name.toLowerCase());
                        }
                        state.tab.delete(uuid);
                    } else if (action === "update_display_name") {
                        const known = state.tab.get(uuid);
                        if (!known) continue;
                        const incoming = entry.displayName ? componentToLegacy(version, entry.displayName) : undefined;
                        if (incoming !== known.applied) { // ignore the echo of our own value
                            known.serverDisplay = incoming;
                            queueTab(session, state, uuid);
                        }
                    }
                }
            }

            // the name as the client would draw it if we werent here at all
            function tabBase(state: SessionState, entry: TabEntry): string {
                if (entry.serverDisplay) return entry.serverDisplay;
                const teamName = state.memberTeam.get(entry.name.toLowerCase());
                const team = teamName ? state.teams.get(teamName) : undefined;
                if (!team) return entry.name;
                const color =
                    hasColorCode(team.serverPrefix) || team.color < 0 || team.color > 15
                        ? ""
                        : `§${team.color.toString(16)}`;
                return `${team.serverPrefix}${color}${entry.name}${team.serverSuffix}`;
            }

            function queueTab(session: Session, state: SessionState, uuid: string): void {
                if (!doTablist) return;
                if (state.tab.size > maxTab) return; // hub sized list, skip it
                const entry = state.tab.get(uuid);
                // skip invalid entries, npcs, whatever
                if (!entry || !/^[A-Za-z0-9_]{1,16}$/.test(entry.name)) return;

                run(state, `tab:${uuid}`, async () => {
                    const before = state.tab.get(uuid);
                    if (!before) return;
                    const tags = await tagsFor(state, { name: before.name, uuid });
                    const render = rendererFor(state.games.game);
                    const prefix = render.prefix(tags);
                    const suffix = render.suffix(tags, MAX_TAB_SUFFIX);

                    const current = state.tab.get(uuid);
                    if (!current) return;
                    // no reason to send a packet if nothing changed
                    if (!prefix && !suffix && !current.applied) return;
                    const display = prefix + tabBase(state, current) + suffix;
                    if (display === current.applied) return;
                    current.applied = prefix || suffix ? display : undefined;
                    session.sendPacket("player_info", {
                        action: "update_display_name",
                        data: [{ uuid, displayName: JSON.stringify({ text: display }) }],
                    });
                });
            }

            // above header nametags are driven by "hacking" the minecraft teams system, which is why we need to track the teams and their members
            function handleTeam(data: any, session: Session): void {
                const state = stateFor(session.id);
                const teamName: string = data.team;
                const mode: number = data.mode;

                if (mode === 1) {
                    const gone = state.teams.get(teamName);
                    if (gone) for (const member of gone.players) state.memberTeam.delete(member.toLowerCase());
                    state.teams.delete(teamName);
                    return;
                }

                let info = state.teams.get(teamName);
                if (mode === 0) {
                    info = {
                        complete: true,
                        name: data.name ?? "",
                        serverPrefix: data.prefix ?? "",
                        serverSuffix: data.suffix ?? "",
                        friendlyFire: data.friendlyFire ?? 0,
                        nameTagVisibility: data.nameTagVisibility ?? "always",
                        color: data.color ?? 15,
                        players: new Set<string>(data.players ?? []),
                    };
                    state.teams.set(teamName, info);
                    for (const member of info.players) state.memberTeam.set(member.toLowerCase(), teamName);
                } else if (mode === 2 && info) {
                    // the server re-sent this teams own formatting, take it as our base
                    info.name = data.name ?? info.name;
                    info.serverPrefix = data.prefix ?? info.serverPrefix;
                    info.serverSuffix = data.suffix ?? info.serverSuffix;
                    info.friendlyFire = data.friendlyFire ?? info.friendlyFire;
                    info.nameTagVisibility = data.nameTagVisibility ?? info.nameTagVisibility;
                    info.color = data.color ?? info.color;
                    info.complete = true;
                    info.applied = undefined;
                } else if (mode === 3 && info) {
                    for (const member of data.players ?? []) {
                        info.players.add(member);
                        state.memberTeam.set(member.toLowerCase(), teamName);
                    }
                } else if (mode === 4 && info) {
                    for (const member of data.players ?? []) {
                        info.players.delete(member);
                        state.memberTeam.delete(member.toLowerCase());
                    }
                }

                if (!info) return;
                queueTeam(session, state, teamName);
                // team formatting feeds tab list names too, so refresh those
                for (const member of info.players) {
                    const uuid = state.tabByName.get(member.toLowerCase());
                    if (uuid) queueTab(session, state, uuid);
                }
            }

            function sendTeam(session: Session, teamName: string, info: TeamInfo, prefix: string, suffix: string): void {
                session.sendPacket("scoreboard_team", {
                    team: teamName,
                    mode: 2,
                    name: info.name,
                    prefix,
                    suffix,
                    friendlyFire: info.friendlyFire,
                    nameTagVisibility: info.nameTagVisibility,
                    color: info.color,
                });
            }

            // put the servers own formatting back on a team we decorated.
            // matters a lot when a team stops holding exactly one player, since
            // hypixel reuses team names across games and shuffles players
            // this is especially important for bedwars lobbies where there's like 50 trillion people
            function revertTeam(session: Session, teamName: string, info: TeamInfo): void {
                if (!info.applied) return;
                info.applied = undefined;
                sendTeam(session, teamName, info, info.serverPrefix, info.serverSuffix);
            }

            function queueTeam(session: Session, state: SessionState, teamName: string): void {
                if (!doAboveHead) return;
                if (!state.teams.get(teamName)?.complete) return;

                run(state, `team:${teamName}`, async () => {
                    const info = state.teams.get(teamName);
                    if (!info) return;

                    // queue a lookup for the one player on this team, if any. if there are 
                    const members = [...info.players];
                    const member = members.length === 1 ? members[0] : undefined;
                    const player =
                        member && member.toLowerCase() !== session.username.toLowerCase()
                            ? session.findPlayer(member)
                            : undefined;
                    if (!player) {
                        revertTeam(session, teamName, info);
                        return;
                    }

                    const tags = await tagsFor(state, player);

                    // re-check after awaiting, membership may have moved underneath us
                    const current = state.teams.get(teamName);
                    if (!current) return;
                    if (current.players.size !== 1 || [...current.players][0] !== member) {
                        revertTeam(session, teamName, current);
                        return;
                    }

                    // the star replaces the servers prefix text since the 16 char
                    // cap leaves no room for both, but we put back the color that
                    // governed the name so the name itself looks untouched
                    const render = rendererFor(state.games.game);
                    let prefix = current.serverPrefix;
                    const ours = render.prefix(tags);
                    if (ours) {
                        const nameColor =
                            lastColor(current.serverPrefix) ??
                            (current.color >= 0 && current.color <= 15
                                ? colorFromCode(current.color.toString(16))
                                : undefined);
                        const candidate = ours + (nameColor ? COLOR_CODES[nameColor] : "");
                        if (candidate.length <= MAX_TEAM_FIELD) prefix = candidate;
                    }
                    const suffix =
                        current.serverSuffix + render.suffix(tags, MAX_TEAM_FIELD - current.serverSuffix.length);

                    if (current.applied?.prefix === prefix && current.applied?.suffix === suffix) return;
                    current.applied = { prefix, suffix };
                    sendTeam(session, teamName, current, prefix, suffix);
                });
            }

            api.log.info(`name decoration active (above-head: ${doAboveHead}, tablist: ${doTablist})`);
        },
    };
}
