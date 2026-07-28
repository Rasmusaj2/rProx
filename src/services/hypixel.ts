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

export class HypixelService {
    private cache = new Map<string, { expires: number; result: PlayerFetch }>();


    constructor(private http: HttpClient, private readonly apiKey: string, private readonly ttl = 300_000) {}
    get enabled(): boolean { return this.apiKey.length > 0; }

    async fetchPlayer(player: PlayerRef): Promise<PlayerFetch> {
        if (!this.enabled) return { status: "no_key" };
        const dashed = player.uuid ? dashUuid(player.uuid) : undefined;
        if (!dashed) return { status: "unresolved" };
        const cacheKey = `hypixel:${dashed}`;
        const cached = this.cache.get(cacheKey);
        if (cached && cached.expires > Date.now()) return cached.result;

        const res = await this.http.send<HypixelResponse>(
            `https://api.hypixel.net/player?uuid=${dashed}`,
            "GET", 
            { headers: { "API-Key": this.apiKey }, timeout: 5000 }
        );
        let result: PlayerFetch;
        if (res.status === 403) result = { status: "invalid_key" };
        else if (res.status === 429) result = { status: "ratelimited" };
        else if (!res.ok || !res.data) result = { status: "error", cause: "No response data" };
        else if (!res.data.success) result = { status: "error", cause: res.data.cause };
        else if (res.data?.success && res.data.player) result = { status: "ok", player: res.data.player };
        else result = { status: "no_data" };

        const cacheMs = (result.status === "ok" ? this.ttl : 10_000);
        this.cache.set(cacheKey, { expires: Date.now() + cacheMs, result });
        return result;

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
        level: (player.achievements?.bedwars_level ?? 1) - 1, // bedwars stars in ap is +1 for some reason
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

// duels stats
export interface DuelsStats {
    wins: number,
    losses: number,
    wlr: number,
    kills: number,
    deaths: number,
    kdr: number,
    winstreak: number,
    gamemodes?: Record<string, DuelsStats>
}

export function duelsStats(player: HypixelPlayer): DuelsStats {
    const duels = player.stats?.Duels ?? {};
    const gamemodes: Record<string, DuelsStats> = {};
    for (const key in duels) {
        let value = duels[key];
        if (key.endsWith("_duel_wins"))  {
            const mode = key.replace("_duel_wins", "");
            gamemodes[mode] = {
                wins: value ?? 0,
                losses: duels[`${mode}_duel_losses`] ?? 0,
                wlr: ratio(value ?? 0, duels[`${mode}_duel_losses`] ?? 0),
                kills: duels[`${mode}_duel_kills`] ?? 0,
                deaths: duels[`${mode}_duel_deaths`] ?? 0,
                kdr: ratio(duels[`${mode}_duel_kills`] ?? 0, duels[`${mode}_duel_deaths`] ?? 0),
                winstreak: duels[`${mode}_winstreak`] ?? 0,
            }
        }
    }
    return {
        wins: duels.wins ?? 0,
        losses: duels.losses ?? 0,
        wlr: ratio(duels.wins ?? 0, duels.losses ?? 0),
        kills: duels.kills ?? 0,
        deaths: duels.deaths ?? 0,
        kdr: ratio(duels.kills ?? 0, duels.deaths ?? 0),
        winstreak: duels.winstreak ?? 0,
        gamemodes,
    }
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
