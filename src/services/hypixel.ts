import type { HttpClient } from '../util/http';
import type { PlayerRef } from '../core/types';
import { dashUuid } from '../services/microsoft';
import { stripColorCodes } from '../util/mcColors';


export interface HypixelPlayer {
    [key: string]: unknown;
    displayname?: string;
    uuid?: string;
    achievements?: Record<string, number>;
    stats: {
        [game: string]: Record<string, any> | undefined;
        Bedwars?: Record<string, any>;
        SkyWars?: Record<string, any>;
        Duels?: Record<string, any>;
        UHC?: Record<string, any>;
        TNTGames?: Record<string, any>;
        MurderMystery?: Record<string, any>;
        MainLobby?: Record<string, any>; // fishing lives in here, there is no stats.Fishing
    }
}

interface HypixelResponse {
    success: boolean;
    player?: HypixelPlayer;
    cause?: string;
}

export type PlayerFetch = 
  { status: "ok", player: HypixelPlayer } // Successful response  
| { status: "no_key" } // No API key available
| { status: "unresolved" } // Could not resolve username to UUID
| { status: "no_data" } // No Hypixel Data for player (never logged on)
| { status: "invalid_key" } // Invalid API key
| { status: "ratelimited" } // Rate limited by Hypixel API
| { status: "error", cause?: string } // Other errors


const ESSENTIAL_RESERVE = 20; // ratelimit to leave 
const BLIND_BACKOFF_MS = 60_000;
const TRANSIENT_TTL_MS = 10_000;
const BAD_KEY_TTL_MS = 300_000;

export class HypixelService {
    private cache = new Map<string, { expires: number; result: PlayerFetch }>();
    // one request per player at a time
    private inflight = new Map<string, Promise<PlayerFetch>>();
    private limitedUntil = 0; // nothing goes out before this
    private windowResetAt = 0; // when the quota rolls over, per RateLimit-Reset
    private remaining = Infinity; // what the last response said was left


    constructor(private http: HttpClient, private readonly apiKey: string, private readonly ttl = 300_000) {}
    get enabled(): boolean { return this.apiKey.length > 0; }


    async fetchPlayer(player: PlayerRef, options: { essential?: boolean } = {}): Promise<PlayerFetch> {
        if (!this.enabled) return { status: "no_key" };
        const dashed = player.uuid ? dashUuid(player.uuid) : undefined;
        if (!dashed) return { status: "unresolved" };
        const cacheKey = `hypixel:${dashed}`;
        const cached = this.cache.get(cacheKey);
        if (cached && cached.expires > Date.now()) return cached.result;

        const pending = this.inflight.get(cacheKey);
        if (pending) return pending;

        if (this.throttled(options.essential)) return { status: "ratelimited" };

        const request = this.request(dashed, cacheKey).finally(() => this.inflight.delete(cacheKey));
        this.inflight.set(cacheKey, request);
        return request;
    }

    private throttled(essential = false): boolean {
        if (Date.now() < this.limitedUntil) return true;
        if (Date.now() >= this.windowResetAt) return false; // quota rolled over
        return !essential && this.remaining <= ESSENTIAL_RESERVE;
    }

    private async request(dashed: string, cacheKey: string): Promise<PlayerFetch> {
        const res = await this.http.send<HypixelResponse>(
            `https://api.hypixel.net/player?uuid=${dashed}`,
            "GET",
            { headers: { "API-Key": this.apiKey }, timeout: 5000 }
        );
        this.readLimits(res.headers, res.status);

        let result: PlayerFetch;
        if (res.status === 403) result = { status: "invalid_key" };
        else if (res.status === 429) result = { status: "ratelimited" };
        else if (!res.ok || !res.data) result = { status: "error", cause: `HTTP ${res.status}` };
        else if (!res.data.success) result = { status: "error", cause: res.data.cause };
        else if (res.data.player) result = { status: "ok", player: res.data.player };
        else result = { status: "no_data" };

        this.cache.set(cacheKey, { expires: Date.now() + this.cacheMsFor(result), result });
        return result;
    }

    private readLimits(headers: Record<string, string>, status: number): void {
        // read the ratelimit headers and update our state
        const num = (key: string): number | undefined => {
            const value = Number(headers[key]);
            return headers[key] !== undefined && Number.isFinite(value) ? value : undefined;
        };
        const reset = num("ratelimit-reset");
        const remaining = num("ratelimit-remaining");
        if (reset !== undefined) this.windowResetAt = Date.now() + Math.max(0, reset) * 1000;
        if (remaining !== undefined) this.remaining = remaining;
        if (status !== 429) return;

        const wait = num("retry-after") ?? reset;
        this.limitedUntil = Date.now() + (wait !== undefined ? Math.max(1, wait) * 1000 : BLIND_BACKOFF_MS);
        this.remaining = 0;
    }

    private cacheMsFor(result: PlayerFetch): number {
        switch (result.status) {
            case "ok":
            case "no_data": // a real answer, this player has never touched hypixel
                return this.ttl;
            case "invalid_key": // no point asking again every few seconds with a bad key
                return BAD_KEY_TTL_MS;
            case "ratelimited":
                return Math.max(TRANSIENT_TTL_MS, this.limitedUntil - Date.now());
            default:
                return TRANSIENT_TTL_MS;
        }
    }
}

export function fetchErrorMessage(status: PlayerFetch["status"]): string {
    switch (status) {
        case "no_key": return "No Hypixel API key available.";
        case "unresolved": return "Could not resolve username to UUID.";
        case "no_data": return "No Hypixel data for player (never logged on).";
        case "invalid_key": return "Invalid Hypixel API key.";
        case "ratelimited": return "Rate limited by Hypixel API.";
        case "error": return "An error occurred while fetching data from the Hypixel API.";
        default: return "";
    }
}


// safe fkdr calc
export function ratio(a: number, b: number): number {
    return b === 0 ? a : Number((a / b).toFixed(2));
}

// bedwars stats
export interface BedwarsStats {
    level: number,
    finalKills: number,
    finalDeaths: number,
    fkdr: number,
    wins: number,
    losses: number,
    wlr: number,
    kills: number,
    deaths: number,
    kdr: number,
    winstreak: number,
}

export function bedwarsStats(player: HypixelPlayer): BedwarsStats {
    const bw = player.stats?.Bedwars ?? {};
    
    return {
        level: (player.achievements?.bedwars_level ?? 1), // bedwars stars in ap is +1 for some reason (apparently not it was just tweaking?)
        finalKills: bw.final_kills_bedwars ?? 0,
        finalDeaths: bw.final_deaths_bedwars ?? 0,
        fkdr: ratio(bw.final_kills_bedwars ?? 0, bw.final_deaths_bedwars ?? 0),
        wins: bw.wins_bedwars ?? 0,
        losses: bw.losses_bedwars ?? 0,
        wlr: ratio(bw.wins_bedwars ?? 0, bw.losses_bedwars ?? 0),
        kills: bw.kills_bedwars ?? 0,
        deaths: bw.deaths_bedwars ?? 0,
        kdr: ratio(bw.kills_bedwars ?? 0, bw.deaths_bedwars ?? 0),
        winstreak: bw.winstreak ?? 0,
    }
}

// skywars stats
export interface SkywarsStats {
    level: number, // 0 when the player has never touched skywars
    levelFormatted: string, // hypixels own rendering, e.g. "§223✦"
    levelText: string, // the same with codes stripped, e.g. "23✦"
    wins: number,
    losses: number,
    wlr: number,
    kills: number,
    deaths: number,
    kdr: number,
}

// deprecate old xp table since angels descent update i forgot about this
// we can just get the skywars level from the hypixel api now 
export function skywarsLevel(levelFormatted: string): number {
    const digits = stripColorCodes(levelFormatted).match(/\d+/);
    return digits ? Number(digits[0]) : 0;
}

export function skywarsStats(player: HypixelPlayer): SkywarsStats {
    const sw = player.stats?.SkyWars ?? {};
    const levelFormatted: string = typeof sw.levelFormatted === "string" ? sw.levelFormatted : "";
    return {
        level: skywarsLevel(levelFormatted),
        levelFormatted,
        levelText: stripColorCodes(levelFormatted),
        wins: sw.wins ?? 0,
        losses: sw.losses ?? 0,
        wlr: ratio(sw.wins ?? 0, sw.losses ?? 0),
        kills: sw.kills ?? 0,
        deaths: sw.deaths ?? 0,
        kdr: ratio(sw.kills ?? 0, sw.deaths ?? 0),
    }
}

// uhc stats
export interface UhcStats {
    wins: number,
    kills: number,
    deaths: number,
    kdr: number,
    score: number,
    headsEaten: number,
}

export function uhcStats(player: HypixelPlayer): UhcStats {
    const uhc = player.stats?.UHC ?? {};
    // team and solo are counted separately, neither one alone is the total
    const kills = (uhc.kills ?? 0) + (uhc.kills_solo ?? 0);
    return {
        wins: (uhc.wins ?? 0) + (uhc.wins_solo ?? 0),
        kills,
        deaths: uhc.deaths ?? 0,
        kdr: ratio(kills, uhc.deaths ?? 0),
        score: uhc.score ?? 0, // what the ingame uhc title is based on
        headsEaten: uhc.heads_eaten ?? 0,
    }
}

// tnt games stats - no losses and no top level kills/deaths, only per mode counters
export interface TntGamesStats {
    wins: number,
    winstreak: number,
    tntRun: number,
    pvpRun: number,
    bowSpleef: number,
    tntTag: number,
    wizards: number,
}

export function tntGamesStats(player: HypixelPlayer): TntGamesStats {
    const tnt = player.stats?.TNTGames ?? {};
    return {
        wins: tnt.wins ?? 0,
        winstreak: tnt.winstreak ?? 0,
        tntRun: tnt.wins_tntrun ?? 0,
        pvpRun: tnt.wins_pvprun ?? 0,
        bowSpleef: tnt.wins_bowspleef ?? 0,
        tntTag: tnt.wins_tntag ?? 0,
        wizards: tnt.wins_capture ?? 0,
    }
}

// murder mystery stats
export interface MurderMysteryStats {
    wins: number,
    games: number,
    losses: number,
    wlr: number,
    kills: number,
    deaths: number,
    kdr: number,
    murdererWins: number,
    detectiveWins: number,
}

export function murderMysteryStats(player: HypixelPlayer): MurderMysteryStats {
    const mm = player.stats?.MurderMystery ?? {};
    const wins = mm.wins ?? 0;
    const games = mm.games ?? 0;
    const losses = Math.max(0, games - wins); // no losses field, games covers it
    return {
        wins,
        games,
        losses,
        wlr: ratio(wins, losses),
        kills: mm.kills ?? 0,
        deaths: mm.deaths ?? 0,
        kdr: ratio(mm.kills ?? 0, mm.deaths ?? 0),
        murdererWins: mm.murderer_wins ?? 0,
        detectiveWins: mm.detective_wins ?? 0,
    }
}

// everything special for duels
// division, kdr, special thiings for ie. bridge duels, etc.

export interface DuelsExtraSpec {
    key: string, // suffix under the mode prefix
    label: string,
    time?: boolean, // value is a duration in ms rather than a count
}

export interface DuelsMode {
    key: string, // api prefix, ie. "bridge_duel"
    category: string, // the game it belongs to, ie. "Bridge" (for display)
    variant: string, // subgamemode (ie. teams modes)
    aliases: string[], // what //duels will accept for it
    family?: string, // which *_title_prestige family it counts towards
    bridge?: boolean, // bridge specific for goals tracking
    extras?: DuelsExtraSpec[],
}

// alias for each gamemode
export const DUELS_CATEGORY_ALIASES: Record<string, string[]> = {
    "Classic": ["classic"],
    "Bridge": ["bridge"],
    "UHC": ["uhc"],
    "SkyWars": ["sw", "skywars"],
    "OP": ["op"],
    "Mega Walls": ["mw", "megawalls"],
    "Bed Wars": ["bedwars", "bw"],
    "Sumo": ["sumo"],
    "Boxing": ["boxing"],
    "NoDebuff": ["nodebuff", "potion", "pot"],
    "Combo": ["combo"],
    "Bow": ["bow"],
    "Bow Spleef": ["bowspleef"],
    "Spleef": ["spleef"],
    "Blitz": ["blitz", "sg"],
    "Parkour": ["parkour"],
    "Arena": ["arena"],
    "Quake": ["quake"],
    "Ranked": ["ranked"],
    "Tournament": ["tournament"],
};

// every mode duels has ever exposed, in menu order. modes with no rounds played
// are dropped at render time, so retired ones (quake, spleef) cost nothing.
export const DUELS_MODES: ReadonlyArray<DuelsMode> = [
    // classic
    { key: "classic_duel", category: "Classic", variant: "1v1", aliases: ["classic1", "classic1v1"], family: "classic" },
    { key: "classic_doubles", category: "Classic", variant: "2v2", aliases: ["classic2", "classicdoubles"], family: "classic" },

    // bridge
    { key: "bridge_duel", category: "Bridge", variant: "1v1", aliases: ["bridge1", "bridge1v1"], family: "bridge", bridge: true },
    { key: "bridge_doubles", category: "Bridge", variant: "2v2", aliases: ["bridge2", "bridgedoubles"], family: "bridge", bridge: true },
    { key: "bridge_threes", category: "Bridge", variant: "3v3", aliases: ["bridge3", "bridgethrees"], family: "bridge", bridge: true },
    { key: "bridge_four", category: "Bridge", variant: "4v4", aliases: ["bridge4", "bridgefour"], family: "bridge", bridge: true },
    { key: "bridge_2v2v2v2", category: "Bridge", variant: "2v2v2v2", aliases: ["bridge2v2v2v2"], family: "bridge", bridge: true },
    { key: "bridge_3v3v3v3", category: "Bridge", variant: "3v3v3v3", aliases: ["bridge3v3v3v3"], family: "bridge", bridge: true },
    { key: "capture_threes", category: "Bridge", variant: "CTF 3v3", aliases: ["ctf", "capture"], family: "bridge", bridge: true },

    // uhc
    { key: "uhc_duel", category: "UHC", variant: "1v1", aliases: ["uhc1", "uhc1v1"], family: "uhc", extras: [{ key: "golden_heads_eaten", label: "Golden heads" }] },
    { key: "uhc_doubles", category: "UHC", variant: "2v2", aliases: ["uhc2", "uhcdoubles"], family: "uhc" },
    { key: "uhc_four", category: "UHC", variant: "4v4", aliases: ["uhc4", "uhcfour"], family: "uhc" },
    { key: "uhc_meetup", category: "UHC", variant: "Deathmatch", aliases: ["meetup", "deathmatch"], family: "uhc" },

    // skywars
    { key: "sw_duel", category: "SkyWars", variant: "1v1", aliases: ["sw1", "sw1v1", "skywars1"], family: "skywars" },
    { key: "sw_doubles", category: "SkyWars", variant: "2v2", aliases: ["sw2", "swdoubles", "skywarsdoubles"], family: "skywars" },

    // op
    { key: "op_duel", category: "OP", variant: "1v1", aliases: ["op1", "op1v1"], family: "op" },
    { key: "op_doubles", category: "OP", variant: "2v2", aliases: ["op2", "opdoubles"], family: "op" },

    // mega walls
    { key: "mw_duel", category: "Mega Walls", variant: "1v1", aliases: ["mw1", "mw1v1", "megawalls1"], family: "mega_walls", extras: [
        { key: "strikes_from_cloak", label: "Cloak strikes" },
        { key: "master_alechmy_hearts", label: "Alchemy hearts" }, // NOTE - HYPIXEL TYPO
    ] },
    { key: "mw_doubles", category: "Mega Walls", variant: "2v2", aliases: ["mw2", "mwdoubles"], family: "mega_walls" },

    // bed wars duels & bed rush 
    { key: "bedwars_two_one_duels", category: "Bed Wars", variant: "Duel", aliases: ["bedwarsduel", "bwduel"], family: "bedwars" },
    { key: "bedwars_two_one_duels_rush", category: "Bed Wars", variant: "Rush", aliases: ["rush", "bedwarsrush", "bwrush"], family: "bedwars" },

    // one-mode games
    { key: "sumo_duel", category: "Sumo", variant: "", aliases: ["sumo"], family: "sumo" },
    { key: "boxing_duel", category: "Boxing", variant: "", aliases: ["boxing"], family: "boxing" },
    { key: "potion_duel", category: "NoDebuff", variant: "", aliases: ["nodebuff", "potion", "pot"], family: "no_debuff", extras: [{ key: "heal_pots_used", label: "Heal pots" }] },
    { key: "combo_duel", category: "Combo", variant: "", aliases: ["combo"], family: "combo", extras: [{ key: "longest_combo", label: "Longest combo" }] },
    { key: "bow_duel", category: "Bow", variant: "", aliases: ["bow"], family: "bow" },
    { key: "bowspleef_duel", category: "Bow Spleef", variant: "", aliases: ["bowspleef"], family: "tnt_games" },
    { key: "spleef_duel", category: "Spleef", variant: "", aliases: ["spleef"], family: "tnt_games", extras: [{ key: "blocks_broken", label: "Blocks broken" }] },
    { key: "blitz_duel", category: "Blitz", variant: "", aliases: ["blitz", "sg"], family: "blitz" },
    { key: "parkour_eight", category: "Parkour", variant: "", aliases: ["parkour"], family: "parkour", extras: [
        { key: "parkour_checkpoints_reached", label: "Checkpoints" },
        { key: "parkour_personal_best", label: "Personal best", time: true },
    ] },
    { key: "duel_arena", category: "Arena", variant: "", aliases: ["arena"] },
    { key: "quake_duel", category: "Quake", variant: "", aliases: ["quake"], extras: [
        { key: "quake_headshots", label: "Headshots" },
        { key: "quake_shot_hits", label: "Shots hit" },
        { key: "quake_shots_taken", label: "Shots taken" },
    ] },

    // legacy, mostly ignore
    { key: "ranked_1", category: "Ranked", variant: "Bridge", aliases: ["ranked"], bridge: true },
    { key: "bridge_tournament", category: "Tournament", variant: "Bridge", aliases: ["bridgetournament"], family: "tournament", bridge: true },
    { key: "sumo_tournament", category: "Tournament", variant: "Sumo", aliases: ["sumotournament"], family: "tournament" },
    { key: "sw_tournament", category: "Tournament", variant: "SkyWars", aliases: ["swtournament"], family: "tournament" },
    { key: "uhc_tournament", category: "Tournament", variant: "UHC", aliases: ["uhctournament"], family: "tournament" },
];

// division pretty print
const DUELS_DIVISIONS: ReadonlyArray<readonly [key: string, name: string]> = [
    ["rookie", "Rookie"],
    ["iron", "Iron"],
    ["gold", "Gold"],
    ["diamond", "Diamond"],
    ["master", "Master"],
    ["legend", "Legend"],
    ["grandmaster", "Grandmaster"],
    ["godlike", "Godlike"],
    ["celestial", "WORLD ELITE"],
    ["divine", "WORLD MASTER"],
    ["ascended", "WORLD'S BEST"],
];

export const DUELS_DIVISION_COUNT = DUELS_DIVISIONS.length;

export interface DuelsDivision {
    index: number, // where it sits on the ladder, for coloring
    name: string,
    prestige: number, // 1-5 for most tiers, 50 for top
    label: string, // ie. "Godlike V"
}

const ROMAN: ReadonlyArray<readonly [number, string]> = [[50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];

function roman(value: number): string {
    let left = value;
    let out = "";
    for (const [size, symbol] of ROMAN) {
        while (left >= size) { out += symbol; left -= size; }
    }
    return out;
}

function duelsDivision(duels: Record<string, any>, family: string | undefined): DuelsDivision | null {
    if (!family) return null;
    let found: DuelsDivision | null = null;
    for (let index = 0; index < DUELS_DIVISIONS.length; index++) {
        const [key, name] = DUELS_DIVISIONS[index];
        const prestige = duels[`${family}_${key}_title_prestige`];
        if (typeof prestige !== "number" || prestige < 1) continue;
        found = { index, name, prestige, label: prestige > 1 ? `${name} ${roman(prestige)}` : name };
    }
    return found;
}

export interface DuelsExtra {
    key: string,
    label: string,
    value: number,
    text: string, 
    time?: boolean,
}

export interface DuelsModeStats {
    key: string,
    name: string, 
    category: string,
    variant: string,
    played: boolean,
    wins: number,
    losses: number,
    wlr: number,
    kills: number,
    deaths: number,
    kdr: number,
    roundsPlayed: number,
    bestWinstreak: number,
    currentWinstreak: number,
    meleeHits: number,
    meleeSwings: number,
    meleeAccuracy: number, 
    bowHits: number,
    bowShots: number,
    bowAccuracy: number, 
    damageDealt: number,
    healthRegenerated: number,
    blocksPlaced: number,
    goldenApplesEaten: number,
    kitWins: number,
    coins: number,
    goals: number, // bridge goals left at 0 for everything else
    bridgeKills: number,
    bridgeDeaths: number,
    bridgeKdr: number,
    extras: DuelsExtra[],
    division: DuelsDivision | null,
}

export interface DuelsStats {
    wins: number,
    losses: number,
    wlr: number,
    kills: number,
    deaths: number,
    kdr: number,
    gamesPlayed: number,
    currentWinstreak: number,
    bestWinstreak: number,
    winstreaksHidden: boolean, // player turned the winstreak api setting off, so 0 means unknown
    meleeHits: number,
    meleeSwings: number,
    meleeAccuracy: number,
    bowHits: number,
    bowShots: number,
    bowAccuracy: number,
    goals: number,
    coins: number,
    division: DuelsDivision | null,
    modes: Record<string, DuelsModeStats>, // keyed by api prefix, every mode in the table
    played: DuelsModeStats[], // only the ones with rounds on them, most wins first
    categories: DuelsCategory[], // the games with anything played, in menu order
}

export function accuracy(hits: number, attempts: number): number {
    return attempts === 0 ? 0 : Number(((hits / attempts) * 100).toFixed(1));
}

export function duration(ms: number): string {
    const total = Math.max(0, Math.round(ms / 1000));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function duelsMode(duels: Record<string, any>, mode: DuelsMode): DuelsModeStats {
    const n = (suffix: string): number => {
        const value = duels[`${mode.key}_${suffix}`];
        return typeof value === "number" && Number.isFinite(value) ? value : 0;
    };
    const streak = (...keys: string[]): number => {
        let best = 0;
        for (const key of keys) {
            const value = duels[key];
            if (typeof value === "number" && Number.isFinite(value)) best = Math.max(best, value);
        }
        return best;
    };

    const wins = n("wins");
    const losses = n("losses");
    const kills = n("kills");
    const deaths = n("deaths");
    const roundsPlayed = n("rounds_played");
    const meleeHits = n("melee_hits");
    const meleeSwings = n("melee_swings");
    const bowHits = n("bow_hits");
    const bowShots = n("bow_shots");
    const bridgeKills = mode.bridge ? n("bridge_kills") : 0;
    const bridgeDeaths = mode.bridge ? n("bridge_deaths") : 0;

    return {
        key: mode.key,
        name: mode.variant ? `${mode.category} (${mode.variant})` : mode.category,
        category: mode.category,
        variant: mode.variant,
        played: roundsPlayed > 0 || wins > 0 || losses > 0,
        wins,
        losses,
        wlr: ratio(wins, losses),
        kills,
        deaths,
        kdr: ratio(kills, deaths),
        roundsPlayed,
        bestWinstreak: streak(`best_winstreak_mode_${mode.key}`, `duels_winstreak_best_${mode.key}`),
        currentWinstreak: streak(`current_winstreak_mode_${mode.key}`, `duels_winstreak_${mode.key}`),
        meleeHits,
        meleeSwings,
        meleeAccuracy: accuracy(meleeHits, meleeSwings),
        bowHits,
        bowShots,
        bowAccuracy: accuracy(bowHits, bowShots),
        damageDealt: n("damage_dealt"),
        healthRegenerated: n("health_regenerated"),
        blocksPlaced: n("blocks_placed"),
        goldenApplesEaten: n("golden_apples_eaten"),
        kitWins: n("kit_wins"),
        coins: n("coins"),
        goals: mode.bridge ? n("goals") : 0,
        bridgeKills,
        bridgeDeaths,
        bridgeKdr: ratio(bridgeKills, bridgeDeaths),
        extras: (mode.extras ?? []).map((spec) => {
            const value = n(spec.key);
            return { key: spec.key, label: spec.label, value, text: spec.time ? duration(value) : value.toLocaleString(), time: spec.time };
        }).filter((extra) => extra.value > 0),
        division: duelsDivision(duels, mode.family),
    };
}

export interface DuelsCategory {
    name: string,
    modes: DuelsModeStats[],
    combined: DuelsModeStats,
}

function combineDuelsModes(category: string, modes: DuelsModeStats[]): DuelsModeStats {
    const sum = (pick: (m: DuelsModeStats) => number) => modes.reduce((total, m) => total + pick(m), 0);
    const best = (pick: (m: DuelsModeStats) => number) => modes.reduce((top, m) => Math.max(top, pick(m)), 0);

    const wins = sum((m) => m.wins);
    const losses = sum((m) => m.losses);
    const kills = sum((m) => m.kills);
    const deaths = sum((m) => m.deaths);
    const meleeHits = sum((m) => m.meleeHits);
    const meleeSwings = sum((m) => m.meleeSwings);
    const bowHits = sum((m) => m.bowHits);
    const bowShots = sum((m) => m.bowShots);
    const bridgeKills = sum((m) => m.bridgeKills);
    const bridgeDeaths = sum((m) => m.bridgeDeaths);

    const extras: DuelsExtra[] = [];
    for (const extra of modes.flatMap((m) => m.extras)) {
        const seen = extras.find((e) => e.key === extra.key);
        if (!seen) { extras.push({ ...extra }); continue; }
        seen.value = extra.time ? Math.min(seen.value, extra.value) : seen.value + extra.value;
        seen.text = extra.time ? duration(seen.value) : seen.value.toLocaleString();
    }

    return {
        key: category.toLowerCase().replace(/\s/g, ""),
        name: category,
        category,
        variant: "",
        played: modes.some((m) => m.played),
        wins,
        losses,
        wlr: ratio(wins, losses),
        kills,
        deaths,
        kdr: ratio(kills, deaths),
        roundsPlayed: sum((m) => m.roundsPlayed),
        bestWinstreak: best((m) => m.bestWinstreak),
        currentWinstreak: best((m) => m.currentWinstreak),
        meleeHits,
        meleeSwings,
        meleeAccuracy: accuracy(meleeHits, meleeSwings),
        bowHits,
        bowShots,
        bowAccuracy: accuracy(bowHits, bowShots),
        damageDealt: sum((m) => m.damageDealt),
        healthRegenerated: sum((m) => m.healthRegenerated),
        blocksPlaced: sum((m) => m.blocksPlaced),
        goldenApplesEaten: sum((m) => m.goldenApplesEaten),
        kitWins: sum((m) => m.kitWins),
        coins: sum((m) => m.coins),
        goals: sum((m) => m.goals),
        bridgeKills,
        bridgeDeaths,
        bridgeKdr: ratio(bridgeKills, bridgeDeaths),
        extras,
        division: modes.find((m) => m.division)?.division ?? null,
    };
}


export type DuelsTarget =
    { kind: "category", category: string }
  | { kind: "mode", mode: DuelsMode };

export function findDuelsTarget(query: string): DuelsTarget | undefined {
    const want = query.toLowerCase().replace(/[\s_'-]/g, "");
    const categories = Object.entries(DUELS_CATEGORY_ALIASES);
    const catNames = ([name, aliases]: [string, string[]]) => [name.toLowerCase().replace(/\s/g, ""), ...aliases];
    const modeNames = (mode: DuelsMode) => [mode.key.replace(/_/g, ""), ...mode.aliases];

    const exactCat = categories.find((entry) => catNames(entry).includes(want));
    if (exactCat) return { kind: "category", category: exactCat[0] };
    const exactMode = DUELS_MODES.find((mode) => modeNames(mode).includes(want));
    if (exactMode) return { kind: "mode", mode: exactMode };

    const nearCat = categories.find((entry) => catNames(entry).some((name) => name.startsWith(want)));
    if (nearCat) return { kind: "category", category: nearCat[0] };
    const nearMode = DUELS_MODES.find((mode) => modeNames(mode).some((name) => name.startsWith(want)));
    return nearMode ? { kind: "mode", mode: nearMode } : undefined;
}

export function duelsCategoryStats(stats: DuelsStats, category: string): DuelsCategory {
    const all = DUELS_MODES.filter((mode) => mode.category === category).map((mode) => stats.modes[mode.key]);
    return { name: category, modes: all.filter((m) => m.played), combined: combineDuelsModes(category, all) };
}

const WINSTREAK_KEYS = ["current_winstreak", "best_overall_winstreak", "best_all_modes_winstreak"];

export function duelsStats(player: HypixelPlayer): DuelsStats {
    const duels = player.stats?.Duels ?? {};
    const n = (key: string): number => {
        const value = duels[key];
        return typeof value === "number" && Number.isFinite(value) ? value : 0;
    };

    const modes: Record<string, DuelsModeStats> = {};
    for (const mode of DUELS_MODES) modes[mode.key] = duelsMode(duels, mode);

    const categories: DuelsCategory[] = [];
    for (const name of new Set(DUELS_MODES.map((mode) => mode.category))) {
        const played = DUELS_MODES.filter((mode) => mode.category === name).map((mode) => modes[mode.key]).filter((m) => m.played);
        if (played.length > 0) categories.push({ name, modes: played, combined: combineDuelsModes(name, played) });
    }

    const wins = n("wins");
    const losses = n("losses");
    const kills = n("kills");
    const deaths = n("deaths");
    const meleeHits = n("melee_hits");
    const meleeSwings = n("melee_swings");
    const bowHits = n("bow_hits");
    const bowShots = n("bow_shots");

    return {
        wins,
        losses,
        wlr: ratio(wins, losses),
        kills,
        deaths,
        kdr: ratio(kills, deaths),
        gamesPlayed: n("games_played_duels") || n("rounds_played"),
        currentWinstreak: n("current_winstreak"),
        bestWinstreak: Math.max(n("best_overall_winstreak"), n("best_all_modes_winstreak")),
        winstreaksHidden: !WINSTREAK_KEYS.some((key) => key in duels),
        meleeHits,
        meleeSwings,
        meleeAccuracy: accuracy(meleeHits, meleeSwings),
        bowHits,
        bowShots,
        bowAccuracy: accuracy(bowHits, bowShots),
        goals: n("goals"),
        coins: n("coins"),
        division: duelsDivision(duels, "all_modes"),
        modes,
        played: Object.values(modes).filter((mode) => mode.played).sort((a, b) => b.wins - a.wins),
        categories,
    };
}


export interface FishingStats {
    totalCatches: number,
    fishCaught: number,
    treasureCaught: number,
    junkCaught: number,
    plantsCaught: number,
    creaturesCaught: number,
    mythicalCaught: number,
    mythicalCaughtIndividual: Record<string, number>,
    mythicalWeight: Record<string, number>,
    specialCaught: number
    areas: Record<string, AreaFishingStats>
}

export interface AreaFishingStats {
    totalCatches: number,
    fishCaught: number,
    treasureCaught: number,
    junkCaught: number,
    plantsCaught: number,
    creaturesCaught: number
}

// lobby fishing is cancer because its stored so far down in the stats tree
// its stored under stats.MainLobby.fishing.stats.permanent, and the permanent object has a key for each area
// this also stores stats for each season, but we can implement that later
const FISHING_AREAS = ["water", "lava", "ice"] as const;

export const MYTHICAL_ORBS = ["helios", "selene", "nyx", "aphrodite", "zeus", "demeter", "hades", "archimedes"] as const;
export const MYTHICAL_FANCY_NAMES: Record<string, string> = {
    helios: "Ember of Helios",
    selene: "Dust of Selene",
    nyx: "Shadow of Nyx",
    zeus: "Spark of Zeus",
    demeter: "Spirit of Demeter",
    aphrodite: "Heart of Aphrodite",
    hades: "Wrath of Hades",
    archimedes: "Automaton of Daedalus",
};

// weight rolls
export const MYTHICAL_ORB_WEIGHTS: Record<string, [min: number, max: number]> = {
    helios: [1, 15],
    selene: [1, 15],
    nyx: [10, 25],
    aphrodite: [10, 25],
    zeus: [20, 40],
    demeter: [20, 40],
    hades: [30, 50],
    archimedes: [30, 50],
}

export function fishingStats(player: HypixelPlayer): FishingStats | null {
    const fishing = player.stats?.MainLobby?.fishing;
    if (!fishing) return null;
    const permanent = fishing.stats?.permanent ?? {};

    const areas: Record<string, AreaFishingStats> = {};
    for (const name of FISHING_AREAS) {
        const raw = permanent[name] ?? {};
        const area: AreaFishingStats = {
            fishCaught: raw.fish ?? 0,
            treasureCaught: raw.treasure ?? 0,
            junkCaught: raw.junk ?? 0,
            plantsCaught: raw.plant ?? 0,
            creaturesCaught: raw.creature ?? 0,
            totalCatches: 0,
        };
        area.totalCatches = area.fishCaught + area.treasureCaught + area.junkCaught + area.plantsCaught + area.creaturesCaught;
        if (area.totalCatches > 0) areas[name] = area;
    }

    const sum = (pick: (area: AreaFishingStats) => number) =>
        Object.values(areas).reduce((total, area) => total + pick(area), 0);

    // hypixel exposes no mythical counter, also its still called orbs
    // looped over properly now
    // counts sit on fishing.orbs, not under permanent, and the weights are a
    // sub-object of that same orbs record rather than a sibling key
    let mythical = 0;
    let weight: Record<string, number> = {};
    let mythicalIndividual: Record<string, number> = {};
    const orbs = fishing.orbs ?? {};
    for (const orb of MYTHICAL_ORBS) {
        const count = orbs[orb] ?? 0;
        if (count > 0) {
            mythical += count;
            weight[orb] = orbs.weight?.[orb] ?? 0;
            mythicalIndividual[orb] = count;
        }
    }

    return {
        totalCatches: sum((a) => a.totalCatches) + mythical,
        fishCaught: sum((a) => a.fishCaught),
        treasureCaught: sum((a) => a.treasureCaught),
        junkCaught: sum((a) => a.junkCaught),
        plantsCaught: sum((a) => a.plantsCaught),
        creaturesCaught: sum((a) => a.creaturesCaught),
        mythicalCaught: mythical,
        mythicalCaughtIndividual: mythicalIndividual,
        mythicalWeight: weight,
        specialCaught: Object.keys(fishing.special_fish ?? {}).length,
        areas,
    }
}
