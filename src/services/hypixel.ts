import type { HttpClient } from '../util/http';
import type { PlayerRef } from '../core/types';
import { dashUuid } from '../services/microsoft';


export interface HypixelPlayer {
    username?: string;
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
        if (cached) return cached.result;

        const res = await this.http.send<HypixelResponse>(
            `https://api.hypixel.net/player?key=&uuid=${dashed}`,
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