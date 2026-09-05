import type { GameMode } from "../core/game";
import { isFakeUuid } from "../core/lobby";
import type { Plugin, Session } from "../core/types";
import { getHypixelService, bedwarsStats } from "../services/hypixel";
import { resolveUuid } from "../services/microsoft";
import { stripColorCodes, type McColorName } from "../util/mcColors";

interface PartyTeamsConfig {
    enabled?: boolean;
    apiKey?: string;
    delaySeconds?: number; // wait after the start line before announcing, lets team packets land
}

const DEFAULT_DELAY_SECONDS = 1;
const GAME_START_COOLDOWN_MS = 15_000;

const SETTLE_POLL_MS = 500;
const SETTLE_POLL_MAX = 10;

const SEND_DELAY_MS = 500;

const GAME_START_PATTERN = "Protect your bed and destroy the enemy beds.";

// remembering s for gray cause green has g
const TEAM_LETTERS: Record<string, { label: string; color: McColorName }> = {
    R: { label: "RED", color: "red" },
    B: { label: "BLUE", color: "blue" },
    G: { label: "GREEN", color: "green" },
    Y: { label: "YELLOW", color: "yellow" },
    A: { label: "AQUA", color: "aqua" },
    W: { label: "WHITE", color: "white" },
    P: { label: "PINK", color: "light_purple" },
    S: { label: "GRAY", color: "gray" },
};

const TEAM_LETTER = /\[([RBGYAWPS])\]/i;

interface TeamInfo {
    prefix: string;
    players: Set<string>;
}

interface SessionState {
    teams: Map<string, TeamInfo>;
    lastStart: number;
    uuids: Map<string, string>;
    timer?: NodeJS.Timeout;
}

// steals hypixelStats apikey
function apiKeyOf(api: Parameters<Plugin["setup"]>[0], config: PartyTeamsConfig): string {
    if (config.apiKey) return config.apiKey;
    const stats = api.config.builtInPlugins?.hypixelStats as { apiKey?: string } | undefined;
    return stats?.apiKey ?? "";
}

export const partyTeamsPlugin: Plugin = {
    name: "partyTeams",
    version: "0.1.0",
    description: "Posts combined team stars/fkdr to party chat on Bedwars game start.",

        defaultConfig: {
            enabled: true,
            apiKey: "", // empty falls back to builtInPlugins.hypixelStats.apiKey
            delaySeconds: DEFAULT_DELAY_SECONDS,
        },

    setup(api) {
        const config = api.pluginConfig as PartyTeamsConfig;
        const apiKey = apiKeyOf(api, config);
        if (!apiKey) {
            api.log.warn("no apiKey found, partyTeams is off (set builtInPlugins.hypixelStats.apiKey)");
            return;
        }

        // shared instance, the ttl and ratelimit state live on hypixelStats copy
        const hypixel = getHypixelService(api.http, apiKey);
        const sessions = new Map<string, SessionState>();

        const stateFor = (session: Session): SessionState => {
            let state = sessions.get(session.id);
            if (!state) {
                state = { teams: new Map(), lastStart: 0, uuids: new Map() };
                sessions.set(session.id, state);
            }
            return state;
        };

        api.on("sessionEnd", (session) => {
            const state = sessions.get(session.id);
            if (state?.timer) clearTimeout(state.timer);
            sessions.delete(session.id);
        });

        api.on("serverPacket", (name, data, session) => {
            const state = stateFor(session);
            if (name === "login") {
                state.teams.clear();
                return;
            }
            if (name !== "scoreboard_team") return;
            const teamName: string = data.team;
            const mode: number = data.mode;

            if (mode === 1) {
                state.teams.delete(teamName);
            } else if (mode === 0) {
                state.teams.set(teamName, {
                    prefix: data.prefix ?? "",
                    players: new Set<string>(data.players ?? []),
                });
            } else if (mode === 2) {
                const info = state.teams.get(teamName);
                if (!info) return;
                info.prefix = data.prefix ?? info.prefix;
            } else if (mode === 3) {
                const info = state.teams.get(teamName) ?? { prefix: "", players: new Set<string>() };
                state.teams.set(teamName, info);
                for (const member of data.players ?? []) info.players.add(member);
            } else if (mode === 4) {
                const info = state.teams.get(teamName);
                if (!info) return;
                for (const member of data.players ?? []) info.players.delete(member);
            }
        });

        const NAME_WORDS: Record<string, string> = {
            red: "R", blue: "B", green: "G", yellow: "Y",
            aqua: "A", white: "W", pink: "P", gray: "S", grey: "S",
        };
        const letterOf = (info: TeamInfo, teamName: string): string | undefined => {
            const plain = stripColorCodes(info.prefix).trim();
            const m = /^([RBGYAWPS])(?:\[.*\])?\b/i.exec(plain) ?? TEAM_LETTER.exec(plain);
            if (m) return m[1].toUpperCase();
            const word = NAME_WORDS[teamName.toLowerCase().replace(/[^a-z].*$/, "")];
            return word;
        };

        const memberStats = async (
            session: Session,
            state: SessionState,
            name: string,
        ): Promise<{ level: number; fkdr: number } | { nick: true } | undefined> => {
            const key = name.toLowerCase();
            let uuid = state.uuids.get(key);
            if (!uuid) {
                uuid = session.findPlayer(name)?.uuid ?? (await resolveUuid(api.http, name));
                if (uuid) state.uuids.set(key, uuid);
            }

            if (uuid && isFakeUuid(uuid)) return { nick: true };
            const result = await hypixel.fetchPlayer({ name, uuid });
            if (result.status === "no_data") return { nick: true };
            if (result.status !== "ok") {
                api.log.debug(`partyTeams lookup for ${name} failed: ${result.status}`);
                return undefined;
            }
            const stats = bedwarsStats(result.player);
            return { level: stats.level, fkdr: stats.fkdr };
        };

        const gameTeams = (state: SessionState): Map<string, Set<string>> => {
            const byLetter = new Map<string, Set<string>>();
            for (const [teamName, info] of state.teams) {
                const letter = letterOf(info, teamName);
                if (!letter) continue; // not a game team
                const players = byLetter.get(letter) ?? new Set<string>();
                for (const member of info.players) players.add(member);
                byLetter.set(letter, players);
            }
            return byLetter;
        };

        const teamsSettled = (state: SessionState): boolean => {
            for (const [teamName, info] of state.teams) {
                if (letterOf(info, teamName) && info.players.size === 0) return false;
            }
            return true;
        };

        const announce = async (session: Session, state: SessionState): Promise<void> => {
            api.log.debug(`partyTeams announce for ${session.username}'s session, ${state.teams.size} scoreboard teams`);
            const self = session.username.toLowerCase();
            const teams = gameTeams(state);
            if (teams.size === 0) {
                const dump = [...state.teams.entries()]
                    .map(([name, info]) => `${name}=${JSON.stringify(stripColorCodes(info.prefix))}`)
                    .join(", ");
                api.log.debug(`partyTeams found no game teams, skipping announce. teams: ${dump}`);
                return;
            }
            const membersOf = (players: Set<string>): string[] =>
                [...players].filter((member) => /^[A-Za-z0-9_]{1,16}$/.test(member) && !session.isNpc(member));
            const allMembers = [...new Set([...teams.values()].flatMap((players) => membersOf(players)))];
            const statsByMember = new Map<string, Awaited<ReturnType<typeof memberStats>>>();
            await Promise.all(
                allMembers.map(async (member) => {
                    statsByMember.set(member, await memberStats(session, state, member));
                }),
            );

            let sent = false;
            for (const [letter, players] of teams) {
                const team = TEAM_LETTERS[letter];
                const members = membersOf(players);
                const stats = members.map((member) => statsByMember.get(member));
                const got = stats.filter((s): s is { level: number; fkdr: number } => s !== undefined && !("nick" in s));
                const nicks = stats.filter((s) => s !== undefined && "nick" in s).length;
                if (got.length === 0 && nicks === 0) {
                    api.log.debug(`partyTeams [${letter}] had no usable stats for ${members.length} members, skipping`);
                    continue; // nothing usable, dont post an empty line
                }

                const stars = got.reduce((sum, s) => sum + s.level, 0);
                const fkdr = got.reduce((sum, s) => sum + s.fkdr, 0);
                const us = members.some((member) => member.toLowerCase() === self);

                const line =
                    `[${team.label}] ${us ? "(US) " : ""}- ✫${stars} - ${fkdr.toFixed(2)} FKDR` +
                    (nicks > 0 ? ` (${nicks} nick${nicks === 1 ? "" : "s"})` : "");
                if (sent) await new Promise((resolve) => setTimeout(resolve, SEND_DELAY_MS));
                session.sendUpstream(`/pc ${line}`);
                sent = true;
            }
        };

        const onGameStart = (session: Session, state: SessionState): void => {
            const now = Date.now();
            api.log.debug(`Game start detected: ${session.username}'s session, last start ${now - state.lastStart}ms ago`);
            if (now - state.lastStart < GAME_START_COOLDOWN_MS) return;
            state.lastStart = now;
            if (state.timer) clearTimeout(state.timer);

            let polls = 0;
            const tick = (): void => {
                if (sessions.get(session.id) !== state) return;
                polls++;
                const settled = state.teams.size > 0 && teamsSettled(state);
                if (!settled && polls < SETTLE_POLL_MAX) {
                    api.log.debug(`partyTeams waiting for teams to settle, poll ${polls}/${SETTLE_POLL_MAX}`);
                    state.timer = setTimeout(tick, SETTLE_POLL_MS);
                    return;
                }
                state.timer = undefined;
                announce(session, state).catch((err) => {
                    api.log.error(`partyTeams announce failed: ${err}`);
                });
            };
            state.timer = setTimeout(tick, (config.delaySeconds ?? DEFAULT_DELAY_SECONDS) * 1000);
        };

        api.on("chat", (msg, session) => {
            if (!config.enabled) return;
            if (session.lobby) return;
            if (session.game !== "bedwars" && session.game !== "unknown") return;
            const state = stateFor(session);
            const text = msg.text.trim();
            
            if (GAME_START_PATTERN == text) {
                api.log.debug(`partyTeams saw game start in ${session.username}'s session`);
                onGameStart(session, state);
                return;
            }
        });
    },
};

export default partyTeamsPlugin;
