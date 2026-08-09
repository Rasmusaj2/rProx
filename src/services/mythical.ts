// mythical catching service for boss bar in lobbyFishing plugin
// data here is used to calculate the boss bar for the mythical "fight"
// A lot of data used here is from sharkey300's FishingUtils ChatTriggers module
export const ORB_SKINS: Record<string, string> = {
    "c0102be6756274719b7f625830ea7ef5051c7d95dc01fe8359b4186378a0c263": "helios",
    "64a1fd9df8ad1d0e216ac347a39b47e797f4a3de7de4df073b065cb69f705baf": "selene",
    "d56123b334c5c18a4df9c1d6aff25046f5e06a7ea8f60b80b91ae48ac7f9830d": "nyx",
    "fc084765c62c03f3479e759208ca1e7fa99f674d0c8be78a3f10f5b1e866ca24": "aphrodite",
    "bb42db182471da05bc2e3d04ea08b7069004f5c066c0aacca1f18c40ee3049cf": "zeus",
    "856d0644baae91c340dd5fa1f41a24c100f47706e54c37683d1764ffedcaa322": "demeter",
    "a92dca1e8218b18b0759fc5baedc7e054067b1ec2f97b10c8c3fca8f923a0a6a": "archimedes",
    "a46fa2c5492722bd510cf546cde1b6b6c689e7640a99606ed49930fe54def0d": "hades",
};

// reels it takes to land one. rarity based
// common 25, uncommon 38, rare 50, ultrarare 63
export const MYTHICAL_CLICKS: Record<string, number> = {
    helios: 25,
    selene: 25,
    nyx: 38,
    aphrodite: 38,
    zeus: 50,
    demeter: 50,
    archimedes: 63,
    hades: 63,
};

export interface HeatModel {
    perClick: number; 
    decayPerSecond: number; 
    max: number; 
    safe: number; // when its "safe" to click
}

export const DEFAULT_HEAT: HeatModel = {
    perClick: 10,
    decayPerSecond: 15, // 0.75 decay/tick
    max: 100,
    safe: 40,
};

export type Phase = "green" | "red";

export interface HealthBar {
    phase: Phase;
    filled: number;
    total: number;
}

// fish boss bar identification
const BAR = /§([ac])(\|*)/;
const BARS = /\|/g;
const MIN_BAR = 3; 

export function parseHealthBar(name: string): HealthBar | null {
    const total = (name.match(BARS) ?? []).length;
    if (total < MIN_BAR) return null;
    const match = BAR.exec(name);
    if (!match) return null;
    return { phase: match[1] === "a" ? "green" : "red", filled: match[2].length, total };
}

// prismarine hands every nbt tag over as {type, value}, and a list nests one
// more level than you would expect. unwrap until there is a plain value left
function nbt(node: unknown): any {
    let current: any = node;
    while (current && typeof current === "object" && !Array.isArray(current) && "type" in current && "value" in current) {
        current = current.value;
    }
    return current;
}

// the skin hash off a player head item, which is what says which mythical it is
export function skullTexture(item: unknown): string | undefined {
    const root = nbt((item as { nbtData?: unknown } | undefined)?.nbtData);
    const owner = nbt(root?.SkullOwner);
    const properties = nbt(owner?.Properties);
    const textures = nbt(properties?.textures);
    const encoded = nbt(Array.isArray(textures) ? nbt(textures[0])?.Value : undefined);
    if (typeof encoded !== "string") return undefined;
    try {
        const decoded = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
        const url: unknown = decoded?.textures?.SKIN?.url;
        return typeof url === "string" ? url.split("/texture/")[1] : undefined;
    } catch {
        return undefined;
    }
}

export function orbFromSkull(item: unknown): string | undefined {
    const texture = skullTexture(item);
    return texture ? ORB_SKINS[texture] : undefined;
}

export interface FightState {
    orb?: string; // which mythical
    maxClicks?: number; // reels it takes - not entirely accurate rn since i think i miss some right clicks during green phase
    clicks: number;
    phase: Phase;
    heat: number; // 0..model.max
    bar?: HealthBar;
    secondsLeft: number;
}

const FIGHT_SECONDS = 60; 
const FIGHT_MS = (FIGHT_SECONDS + 2) * 1000; 
const LOCK_MS = 5_000; 
const LOCK_RANGE = 40; // range to consider a stand a candidate for our fish, in blocks
const STAND_TTL_MS = 8_000; 
const STAND_CAP = 64; 
const CLICK_GAP_MS = 30; // one right click can arrive as two packets (for some reason? minecraft networking is ass), needs tweaking cause this misses a click sometimes
const ORB_MATCH = 2.5; // how close a skull has to be to a stand to count as the same mythical

interface Stand {
    x: number;
    y: number;
    z: number;
    seenAt: number;
    orb?: string;
}

// one fight at a time, which is all hypixel gives you
export class MythicalFight {
    private stands = new Map<number, Stand>(); // armor stands that could still turn out to be ours
    private at = { x: 0, y: 0, z: 0 };
    private armedAt = 0; // when the "emerges from the depths" title landed
    private fish?: number; // entity id, set means a fight is on
    private fishAt?: Stand; // where it surfaced, for pairing a skull to it
    private range = Infinity; // how far away it was when we locked on
    private startedAt = 0;
    private heat = 0;
    private heatAt = 0;
    private clicks = 0;
    private clickAt = 0;
    private orb?: string;
    private bar?: HealthBar;

    constructor(private readonly model: HeatModel = DEFAULT_HEAT) {}

    get active(): boolean {
        return this.fish !== undefined;
    }

    get orbName(): string | undefined {
        return this.orb;
    }

    setPlayerPosition(x: number, y: number, z: number): void {
        this.at = { x, y, z };
    }

    // is this entity one we are still hoping turns out to be a fish. only used to
    // decide whether a name is worth putting in the log
    watching(id: number, now: number): boolean {
        return this.fish === undefined && now - this.armedAt <= LOCK_MS && this.stands.has(id);
    }

    // what //bossbar info prints for the fight half of this
    describe(now: number): string[] {
        const state = this.sample(now);
        if (!state) {
            const waiting = now - this.armedAt <= LOCK_MS;
            return [`no mythical (${waiting ? "armed, waiting for the fish" : "not armed"}), ${this.stands.size} stands tracked`];
        }
        return [
            `fish #${this.fish} ${state.orb ?? "unknown orb"} ${state.phase} phase, ${state.secondsLeft}s left`,
            `heat ${state.heat.toFixed(1)}/${this.model.max}, ${state.clicks} reels${state.maxClicks ? ` of ${state.maxClicks}` : ""}`,
            `bar ${state.bar ? `${state.bar.filled}/${state.bar.total}` : "unread"}, locked at ${this.range.toFixed(1)} blocks`,
        ];
    }

    // the title hypixel shows you, and the only proof that the next fish to
    // surface is yours rather than the person fishing next to you
    arm(now: number): void {
        this.armedAt = now;
        this.sweep(now);
    }

    // the fish can be in the world before the title lands, so stands are kept on
    // spec rather than only while armed. a lobby is full of holograms though, so
    // only the ones close enough to be a cast of ours, and only for a few seconds
    trackStand(id: number, x: number, y: number, z: number, now: number): void {
        if (distance(this.at, { x, y, z }) > LOCK_RANGE) return;
        if (this.stands.size > STAND_CAP) this.sweep(now);
        this.stands.set(id, { x, y, z, seenAt: now, orb: undefined });
    }

    // custom name off an entity_metadata, which is how the fish reports its phase
    trackName(id: number, name: string, now: number): boolean {
        const bar = parseHealthBar(name);
        if (!bar) return false;
        if (this.fish === id) {
            this.bar = bar;
            return true;
        }
        if (this.fish !== undefined && this.clicks > 0) return false; // already committed to one
        const stand = this.stands.get(id);
        if (!stand) return false;
        if (now - this.armedAt > LOCK_MS) return false;
        // two mythicals can surface within a second of each other, so during the
        // window the closest one wins and can still be taken over by a closer one
        const range = distance(this.at, stand);
        if (this.fish !== undefined && range >= this.range) return false;
        this.lock(id, stand, range, bar, now);
        return true;
    }

    // the skull it wears, which is the only thing that says which mythical it is.
    // it can land either side of the name, so both paths have to take it
    trackHead(id: number, orb: string | undefined): void {
        if (!orb) return;
        const stand = this.stands.get(id);
        if (stand) stand.orb = orb;
        if (this.fish === id) this.orb = orb;
        else if (this.fish !== undefined && !this.orb && stand && this.fishAt) {
            if (distance(this.fishAt, stand) <= ORB_MATCH) this.orb = orb;
        }
    }

    remove(ids: number[]): void {
        for (const id of ids) {
            this.stands.delete(id);
            if (this.fish === id) this.end(); // reeled in, escaped or despawned
        }
    }

    // a reel. clicks count toward landing it whatever the phase, red ones cost heat
    click(now: number): void {
        if (this.fish === undefined) return;
        if (now - this.clickAt < CLICK_GAP_MS) return;
        this.clickAt = now;
        this.cool(now);
        this.clicks++;
        if (this.bar?.phase === "red") this.heat = Math.min(this.model.max, this.heat + this.model.perClick);
    }

    // where the fight is right now, or null when there is not one
    sample(now: number): FightState | null {
        if (this.fish === undefined) return null;
        if (now - this.startedAt > FIGHT_MS) {
            this.end();
            return null;
        }
        this.cool(now);
        return {
            orb: this.orb,
            maxClicks: this.orb ? MYTHICAL_CLICKS[this.orb] : undefined,
            clicks: this.clicks,
            phase: this.bar?.phase ?? "red",
            heat: this.heat,
            bar: this.bar,
            secondsLeft: Math.max(0, Math.ceil(FIGHT_SECONDS - (now - this.startedAt) / 1000)),
        };
    }

    end(): void {
        this.fish = undefined;
        this.fishAt = undefined;
        this.range = Infinity;
        this.heat = 0;
        this.clicks = 0;
        this.orb = undefined;
        this.bar = undefined;
        this.armedAt = 0;
        this.stands.clear();
    }

    private lock(id: number, stand: Stand, range: number, bar: HealthBar, now: number): void {
        this.fish = id;
        this.fishAt = stand;
        this.range = range;
        this.startedAt = now;
        this.heat = 0;
        this.heatAt = now;
        this.clicks = 0;
        this.orb = stand.orb ?? this.nearbyOrb(stand);
        this.bar = bar;
    }

    // the skull may have gone to a stand of its own, in which case it is the one
    // sitting in the same spot as the bar we just locked onto
    private nearbyOrb(fish: Stand): string | undefined {
        for (const stand of this.stands.values()) {
            if (stand.orb && stand !== fish && distance(fish, stand) <= ORB_MATCH) return stand.orb;
        }
        return undefined;
    }

    private cool(now: number): void {
        const elapsed = Math.max(0, now - this.heatAt);
        this.heatAt = now;
        this.heat = Math.max(0, this.heat - (this.model.decayPerSecond * elapsed) / 1000);
    }

    private sweep(now: number): void {
        for (const [id, stand] of this.stands) {
            if (now - stand.seenAt > STAND_TTL_MS) this.stands.delete(id);
        }
    }
}

function distance(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
