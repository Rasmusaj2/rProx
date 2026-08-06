import type { Collected, EnrichmentEngine } from "../core/enrichment";
import type { Plugin, PlayerRef, Session, Tag } from "../core/types";
import { actionName } from "../core/lobby";
import { componentToLegacy, PREFIX } from "../core/chat";
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

// leave the promise in a cache so it doesnt fire its own api call again
// hypixel fails api calls on the same user from the same key if they're too recent
// this fixes some issues where double firing a request on a user will display it at the start and remove it later
interface CacheEntry {
    lookup: Promise<Collected>;
    expires: number;
}

interface SessionState {
    teams: Map<string, TeamInfo>;
    memberTeam: Map<string, string>; // lowercase name -> team name
    tab: Map<string, TabEntry>; // uuid -> entry
    tabByName: Map<string, string>; // lowercase name -> uuid
    tagCache: Map<string, CacheEntry>;
    failures: Map<string, number>; // lowercase name -> lookups in a row that came back failed
    retries: Map<string, NodeJS.Timeout>; // job key -> pending second attempt
    lookups: number; // fresh api lookups spent on this server, capped by maxTablistPlayers
    pending: Set<string>;
    dirty: Set<string>;
    games: GameTracker;
    schedule: (fn: () => Promise<void>) => void; // own queue, see stateFor
}

const MAX_TEAM_FIELD = 16; // protocol cap on a 1.8 team prefix/suffix
const MAX_TAB_SUFFIX = 32;

const byPriority = (a: Tag, b: Tag) => (b.priority ?? 0) - (a.priority ?? 0); // higher priority first, undefined is 0


function renderTag(tag: Tag, compact = false): string {
    const plain = COLOR_CODES[tag.color ?? "gray"] + (tag.short ?? tag.text);
    return compact ? plain : (tag.formatted ?? plain);
}

function visibleTags(tags: Tag[]): Tag[] {
    return [...tags].sort(byPriority).filter((tag) => tag.formatted || (tag.short ?? tag.text));
}

// trailing suffix since 1.8 gives us a 32 char limit, so we need to weigh by priority
function buildSuffix(tags: Tag[], budget: number): string {
    let out = "";
    for (const tag of visibleTags(tags)) {
        // fall back to the compact form before giving up on the tag entirely
        const piece = [renderTag(tag), renderTag(tag, true)]
            .map((form) => ` ${form}`)
            .find((candidate) => out.length + candidate.length <= budget);
        if (!piece) break;
        out += piece;
    }
    return out;
}

// bracketed prefix, e.g. "§8[§b✫312§8] "
// budget cap can be hit by a single tag, so we try the full form first, then the compact form, then drop tags until it fits. if nothing fits, return the empty string
function buildPrefix(tags: Tag[], budget = Infinity): string {
    const wanted = visibleTags(tags);
    const wrap = (parts: string[]) => (parts.length ? `§8[${parts.join("§8 ")}§8] ` : "");
    for (const compact of [false, true]) {
        const out = wrap(wanted.map((tag) => renderTag(tag, compact)));
        if (out && out.length <= budget) return out;
    }
    const parts = wanted.map((tag) => renderTag(tag, true));
    while (parts.length) {
        parts.pop();
        const out = wrap(parts);
        if (out.length <= budget) return out;
    }
    return "";
}

// the pair of builders a name gets decorated with
// use factory-ish patterns to have different renderers for each gamemode
interface NametagRenderer {
    prefix(tags: Tag[], budget?: number): string;
    suffix(tags: Tag[], budget: number): string;
}

function makeRenderer(game: GameMode): NametagRenderer {
    return {
        prefix: (tags, budget) => buildPrefix(tagsForGame(tags, game).filter((t) => t.prefix), budget),
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

// a lookup we could not complete is worth another go soon rather than sitting in
// the cache showing nothing for the full ttl
const FAILED_TTL_MS = 10_000;
const RETRY_DELAY_MS = 15_000; // grows with each attempt
const MAX_RETRIES = 3;

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
        version: "0.1.2",
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
                        failures: new Map(),
                        retries: new Map(),
                        lookups: 0,
                        pending: new Set(),
                        dirty: new Set(),
                        games: new GameTracker(),
                        schedule: limiter(concurrency),
                    };
                    sessions.set(id, state);
                }
                return state;
            };

            // everything the client throws away when it gets a fresh login packet.
            // the stats cache is not in here, those survive a lobby switch just fine
            const forgetServerState = (state: SessionState): void => {
                state.teams.clear();
                state.memberTeam.clear();
                state.tab.clear();
                state.tabByName.clear();
                state.pending.clear();
                state.dirty.clear();
                for (const timer of state.retries.values()) clearTimeout(timer);
                state.retries.clear();
                state.lookups = 0; // new server, new budget
                state.games.clear();
            };

            api.on("sessionEnd", (session) => {
                // timers outlive the socket unless we go and cancel them
                const state = sessions.get(session.id);
                if (state) for (const timer of state.retries.values()) clearTimeout(timer);
                sessions.delete(session.id);
            });

            api.on("serverPacket", (name, data, session) => {
                try {
                    if (name === "scoreboard_team") handleTeam(data, session); // update team info, which drives above-head nametags and tablist names
                    else if (name === "player_info") handleTabList(data, session); // update tablist info, which drives tablist names
                    else if (name === "login") {
                        // hypixel moves you between servers with a fresh login packet,
                        // and the client drops its scoreboard and tab list when it
                        // arrives. holding on to ours leaves us decorating teams the
                        // client no longer has, and the dead entries keep counting
                        // against maxTablistPlayers so the new lobby gets skipped
                        forgetServerState(stateFor(session.id));
                        session.game = "unknown";
                    } else if (name === "scoreboard_objective") {
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

            // a players tags, cached per name for this session. the entry is stored
            // before the lookup resolves so whoever asks next waits on the same
            // call, and a lookup that failed only holds the slot for a moment
            function tagsFor(state: SessionState, player: PlayerRef): Promise<Collected> {
                const key = player.name.toLowerCase();
                const hit = state.tagCache.get(key);
                if (hit && hit.expires > Date.now()) return hit.lookup;

                state.lookups++;
                const entry: CacheEntry = { expires: Infinity, lookup: Promise.resolve({ tags: [], failed: true }) };
                const settle = (result: Collected): Collected => {
                    entry.expires = Date.now() + (result.failed ? FAILED_TTL_MS : ttl);
                    if (result.failed) state.failures.set(key, (state.failures.get(key) ?? 0) + 1);
                    else state.failures.delete(key);
                    return result;
                };
                entry.lookup = enrichment.collectDetailed(player, "GAME").then(settle, (error) => {
                    api.log.debug(`lookup for ${player.name} failed: ${error}`);
                    return settle({ tags: [], failed: true });
                });
                state.tagCache.set(key, entry);
                return entry.lookup;
            }

            // nothing re-drives a failed lookup on its own, so a rate limited player
            // would show nothing until something unrelated happened to move their
            // team or tab entry. ask again on a timer instead, backing off each time
            function retryLater(state: SessionState, name: string, key: string, again: () => void): void {
                if (state.retries.has(key)) return;
                const attempt = state.failures.get(name.toLowerCase()) ?? 1;
                if (attempt > MAX_RETRIES) return;
                const timer = setTimeout(() => {
                    state.retries.delete(key);
                    again();
                }, RETRY_DELAY_MS * attempt);
                timer.unref?.();
                state.retries.set(key, timer);
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
                    } catch (error) {
                        api.log.debug(`${key} update failed: ${error}`); // something bro idk
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
                // one packet carries the whole lobby on a join, so queueTab cannot
                // judge the size of the list until every entry in it is applied.
                // deciding per entry meant whoever happened to be early in the
                // packet got decorated and everybody after them never did
                const queued = new Set<string>();

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
                        queued.add(uuid);
                        // the team can arrive before the entry it names
                        const teamName = state.memberTeam.get(entry.name.toLowerCase());
                        if (teamName) queueTeam(session, state, teamName);
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
                            queued.add(uuid);
                        }
                    }
                }

                for (const uuid of queued) queueTab(session, state, uuid);
            }

            // the name as the client would draw it if we werent here at all
            function tabBase(state: SessionState, entry: TabEntry): string {
                if (entry.serverDisplay) return entry.serverDisplay;
                const teamName = state.memberTeam.get(entry.name.toLowerCase());
                const team = teamName ? state.teams.get(teamName) : undefined;
                // an incomplete team is one we only know the membership of, so it has
                // no formatting of its own to rebuild the name from
                if (!team?.complete) return entry.name;
                const color =
                    hasColorCode(team.serverPrefix) || team.color < 0 || team.color > 15
                        ? ""
                        : `§${team.color.toString(16)}`;
                return `${team.serverPrefix}${color}${entry.name}${team.serverSuffix}`;
            }

            // maxTablistPlayers is a budget of api lookups per server, not a switch
            // that turns the whole list off once its big. a lobby of 90 spends 80 and
            // decorates those 80, rather than deciding 90 is too many and decorating
            // nobody. reading a name back out of the cache is free, so refreshing
            // someone we already know never eats into it
            function affordLookup(state: SessionState, name: string): boolean {
                const hit = state.tagCache.get(name.toLowerCase());
                if (hit && hit.expires > Date.now()) return true;
                return state.lookups < maxTab;
            }

            function queueTab(session: Session, state: SessionState, uuid: string): void {
                if (!doTablist) return;
                const entry = state.tab.get(uuid);
                // skip invalid entries, npcs, and hypixels fake "Tokens: ..." style
                // tab rows, none of which should cost a lookup
                if (!entry || !/^[A-Za-z0-9_]{1,16}$/.test(entry.name)) return;

                const key = `tab:${uuid}`;
                run(state, key, async () => {
                    const before = state.tab.get(uuid);
                    if (!before) return;
                    if (!affordLookup(state, before.name)) return;
                    const { tags, failed } = await tagsFor(state, { name: before.name, uuid });

                    const current = state.tab.get(uuid);
                    if (!current) return;
                    if (failed) {
                        retryLater(state, before.name, key, () => queueTab(session, state, uuid));
                        // leave a name we already decorated alone, a lookup we could
                        // not finish is no reason to strip the tags back off it
                        if (current.applied) return;
                    }

                    const render = rendererFor(state.games.game);
                    const prefix = render.prefix(tags);
                    const suffix = render.suffix(tags, MAX_TAB_SUFFIX);
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

            // memberTeam holds one team per player, and hypixel adds a player to
            // their new team before removing them from the old one. dropping the
            // mapping blind lets that stale removal erase the new team, so only
            // let go when it still points at the team doing the letting go
            function unlinkMember(state: SessionState, member: string, teamName: string): void {
                const key = member.toLowerCase();
                if (state.memberTeam.get(key) === teamName) state.memberTeam.delete(key);
            }

            function refreshTabs(session: Session, state: SessionState, names: Iterable<string>): void {
                for (const name of names) {
                    const uuid = state.tabByName.get(name.toLowerCase());
                    if (uuid) queueTab(session, state, uuid);
                }
            }

            // above header nametags are driven by "hacking" the minecraft teams system, which is why we need to track the teams and their members
            function handleTeam(data: any, session: Session): void {
                const state = stateFor(session.id);
                const teamName: string = data.team;
                const mode: number = data.mode;

                const touched = new Set<string>(); // names that need their tablist refreshed after this team change

                if (mode === 1) {
                    const gone = state.teams.get(teamName);
                    if (gone) {
                        for (const member of gone.players) {
                            unlinkMember(state, member, teamName);
                            touched.add(member);
                        }
                    }
                    state.teams.delete(teamName);
                    refreshTabs(session, state, touched);
                    return;
                }

                let info = state.teams.get(teamName);
                if (mode === 0) {
                    // hypixel reuses team names across games, so whoever was under this name before is gone
                    if (info) {
                        for (const member of info.players) {
                            unlinkMember(state, member, teamName);
                            touched.add(member);
                        }
                    }
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
                    for (const member of info.players) {
                        state.memberTeam.set(member.toLowerCase(), teamName);
                        touched.add(member);
                    }
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
                } else if (mode === 3) {
                    // players can show up for a team whose create packet we never
                    // saw. track the membership anyway so the player is not left
                    // teamless, and leave it incomplete so we neither invent
                    // formatting for it nor revert one we were never given
                    info ??= {
                        complete: false,
                        name: "",
                        serverPrefix: "",
                        serverSuffix: "",
                        friendlyFire: 0,
                        nameTagVisibility: "always",
                        color: 15,
                        players: new Set<string>(),
                    };
                    state.teams.set(teamName, info);
                    for (const member of data.players ?? []) {
                        info.players.add(member);
                        state.memberTeam.set(member.toLowerCase(), teamName);
                        touched.add(member);
                    }
                } else if (mode === 4) {
                    for (const member of data.players ?? []) {
                        info?.players.delete(member);
                        unlinkMember(state, member, teamName);
                        touched.add(member);
                    }
                }

                if (info) {
                    queueTeam(session, state, teamName);
                    // team formatting feeds tab list names too, so refresh those
                    for (const member of info.players) touched.add(member);
                }
                refreshTabs(session, state, touched);
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

                const key = `team:${teamName}`;
                run(state, key, async () => {
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
                    // the same budget the tab list draws on. a lookup is a lookup
                    // whichever decoration ends up consuming it
                    if (!affordLookup(state, player.name)) return;

                    const { tags, failed } = await tagsFor(state, player);

                    // re-check after awaiting, membership may have moved underneath us
                    const current = state.teams.get(teamName);
                    if (!current) return;
                    if (current.players.size !== 1 || [...current.players][0] !== member) {
                        revertTeam(session, teamName, current);
                        return;
                    }
                    if (failed) {
                        retryLater(state, player.name, key, () => queueTeam(session, state, teamName));
                        if (current.applied) return; // keep the tag thats already above their head
                    }

                    // the star replaces the servers prefix text since the 16 char
                    // cap leaves no room for both, but we put back the color that
                    // governed the name so the name itself looks untouched
                    const render = rendererFor(state.games.game);
                    const nameColor =
                        lastColor(current.serverPrefix) ??
                        (current.color >= 0 && current.color <= 15
                            ? colorFromCode(current.color.toString(16))
                            : undefined);
                    const tail = nameColor ? COLOR_CODES[nameColor] : "";
                    // budget the color back in up front so a prefix that doesnt fit
                    // sheds its lowest priority tag instead of dropping out whole
                    const ours = render.prefix(tags, MAX_TEAM_FIELD - tail.length);
                    const prefix = ours ? ours + tail : current.serverPrefix;
                    const suffix =
                        current.serverSuffix +
                        render.suffix(tags, Math.max(0, MAX_TEAM_FIELD - current.serverSuffix.length));

                    // a player with nothing to show leaves the team exactly as the
                    // server sent it, so dont claim it as ours or we end up reverting
                    // a team we never touched
                    const untouched = prefix === current.serverPrefix && suffix === current.serverSuffix;
                    if (untouched && !current.applied) return;
                    if (current.applied?.prefix === prefix && current.applied?.suffix === suffix) return;
                    current.applied = untouched ? undefined : { prefix, suffix };
                    sendTeam(session, teamName, current, prefix, suffix);
                });
            }

            api.log.info(`name decoration active (above-head: ${doAboveHead}, tablist: ${doTablist})`);
        },
    };
}
