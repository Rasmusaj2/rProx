import type { HttpClient } from '../util/http';
import type { PlayerRef } from '../core/types';
import { dashUuid } from '../services/microsoft';


export interface HypixelPlayer {
    [key: string]: unknown;
    displayname?: string;
    uuid?: string;
    achievements?: Record<string, number>;
    stats: {
        Bedwars?: Record<string, any>;
        SkyWars?: Record<string, any>;
        Duels?: Record<string, any>;
        Raw?: Record<string, any>;
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
    level: number,
    wins: number,
    losses: number,
    wlr: number,
    kills: number,
    deaths: number,
    kdr: number,
}
const SW_XP = [0, 20, 70, 150, 250, 500, 1000, 2000, 3500, 6000, 10000, 15000]
export function skywarsLevel(xp: number): number {
    let level = 0;
    if (xp >= 15000) return 12 + Math.floor((xp - 15000) / 10000);
    for (let i = 0; i < SW_XP.length; i++) {
        if (xp >= SW_XP[i]) level = i;
    }
    return level;
}

export function skywarsStats(player: HypixelPlayer): SkywarsStats {
    const sw = player.stats?.SkyWars ?? {};
    const xp = sw.skywars_experience ?? 0;
    return {
        level: skywarsLevel(xp),
        wins: sw.wins ?? 0,
        losses: sw.losses ?? 0,
        wlr: ratio(sw.wins ?? 0, sw.losses ?? 0),
        kills: sw.kills ?? 0,
        deaths: sw.deaths ?? 0,
        kdr: ratio(sw.kills ?? 0, sw.deaths ?? 0),
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