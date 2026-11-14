export interface Position {
    x: number;
    y: number;
    z: number;
}

export interface ServerSound extends Position {
    name: string; 
    volume: number;
    pitch: number; // 1 is normal speed, whatever the wire format was
    category?: SoundCategory; // undefined for 1.8 we dont care
}

export type SoundCategory =
    | "master"
    | "music"
    | "record"
    | "weather"
    | "block"
    | "hostile"
    | "neutral"
    | "player"
    | "ambient"
    | "voice";

export interface SoundOptions extends Partial<Position> {
    volume?: number;
    pitch?: number;
    category?: SoundCategory;
}

// a sound name, a pattern, or a predicate over the decoded sound
export type SoundMatch = string | RegExp | ((sound: ServerSound) => boolean);

export interface SoundBlockOptions {
    once?: boolean; // let go after swallowing a single sound
    timeoutMs?: number; // let go after this long, even if nothing matched
}

export interface SoundInjectorOptions {
    version?: string;
    sendPacket(name: string, data: unknown): void;
}

const CATEGORIES: readonly SoundCategory[] = [
    "master",
    "music",
    "record",
    "weather",
    "block",
    "hostile",
    "neutral",
    "player",
    "ambient",
    "voice",
];

// sound positions go over the wire as fixed point, eighths of a block
const POSITION_SCALE = 8;
// 1.8 sends pitch as a byte where 63 is normal speed
const LEGACY_PITCH_SCALE = 63;

function versionParts(version: string): [number, number, number] {
    const match = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(version);
    if (!match) return [1, 8, 0];
    return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
}

function usesLegacySoundPacket(version: string): boolean {
    const [major, minor] = versionParts(version);
    return major === 1 && minor < 9;
}

function finite(value: unknown, fallback = 0): number {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

export function soundMatches(sound: ServerSound, match: SoundMatch): boolean {
    if (typeof match === "string") return sound.name === match;
    if (match instanceof RegExp) {
        match.lastIndex = 0; // a /g pattern would otherwise skip every other sound
        return match.test(sound.name);
    }
    return match(sound);
}

// decode a named_sound_effect, undefined for anything else
export function parseSoundPacket(name: string, data: unknown, version = "1.8.9"): ServerSound | undefined {
    if (name !== "named_sound_effect") return undefined;
    const packet = data as Record<string, unknown> | undefined;
    if (typeof packet?.soundName !== "string") return undefined;
    const legacy = usesLegacySoundPacket(version);
    const sound: ServerSound = {
        name: packet.soundName,
        x: finite(packet.x) / POSITION_SCALE,
        y: finite(packet.y) / POSITION_SCALE,
        z: finite(packet.z) / POSITION_SCALE,
        volume: finite(packet.volume, 1),
        pitch: legacy ? finite(packet.pitch, LEGACY_PITCH_SCALE) / LEGACY_PITCH_SCALE : finite(packet.pitch, 1),
    };
    if (!legacy) sound.category = CATEGORIES[finite(packet.soundCategory)] ?? "master";
    return sound;
}

interface Blocker {
    match: SoundMatch;
    once: boolean;
    expiresAt: number;
}

export class SoundInjector {
    private readonly version: string;
    private readonly sendPacket: (name: string, data: unknown) => void;
    private readonly legacy: boolean;
    private readonly blockers = new Set<Blocker>();
    private position?: Position;
    private last?: ServerSound;

    constructor(options: SoundInjectorOptions) {
        this.version = options.version ?? "1.8.9";
        this.sendPacket = options.sendPacket;
        this.legacy = usesLegacySoundPacket(this.version);
    }

    // returns the decoded sound and whether a blocker swallowed it
    applyServerPacket(name: string, data: unknown): { sound?: ServerSound; blocked: boolean } {
        if (name === "position") {
            this.applyServerPosition(data as Record<string, unknown>);
            return { blocked: false };
        }
        const sound = parseSoundPacket(name, data, this.version);
        if (!sound) return { blocked: false };
        this.last = sound;
        return { sound, blocked: this.consume(sound) };
    }

    // the client reports where it walked, so a sound of ours can play on the player
    applyClientPacket(name: string, data: unknown): void {
        if (name !== "position" && name !== "position_look") return;
        const packet = data as Record<string, unknown>;
        if (![packet?.x, packet?.y, packet?.z].every((value) => typeof value === "number")) return;
        this.position = { x: packet.x as number, y: packet.y as number, z: packet.z as number };
    }

    block(match: SoundMatch, options: SoundBlockOptions = {}): () => void {
        const blocker: Blocker = {
            match,
            once: options.once ?? false,
            expiresAt: options.timeoutMs === undefined ? Infinity : Date.now() + Math.max(0, options.timeoutMs),
        };
        this.blockers.add(blocker);
        return () => {
            this.blockers.delete(blocker);
        };
    }

    play(name: string, options: SoundOptions = {}): void {
        const at = this.position ?? { x: 0, y: 0, z: 0 };
        const position = {
            x: Math.round(finite(options.x, at.x) * POSITION_SCALE),
            y: Math.round(finite(options.y, at.y) * POSITION_SCALE),
            z: Math.round(finite(options.z, at.z) * POSITION_SCALE),
        };
        const volume = Math.max(0, finite(options.volume, 1));
        const pitch = finite(options.pitch, 1);
        if (this.legacy) {
            this.sendPacket("named_sound_effect", {
                soundName: name,
                ...position,
                volume,
                pitch: clamp(Math.round(pitch * LEGACY_PITCH_SCALE), 0, 255),
            });
            return;
        }
        this.sendPacket("named_sound_effect", {
            soundName: name,
            soundCategory: CATEGORIES.indexOf(options.category ?? "master"),
            ...position,
            volume,
            pitch,
        });
    }

    clearServerState(): void {
        this.last = undefined;
    }

    dispose(): void {
        this.blockers.clear();
        this.position = undefined;
        this.last = undefined;
    }

    get currentPosition(): Position | undefined {
        return this.position && { ...this.position };
    }

    get lastSound(): ServerSound | undefined {
        return this.last;
    }

    private consume(sound: ServerSound): boolean {
        const now = Date.now();
        let blocked = false;
        for (const blocker of this.blockers) {
            if (blocker.expiresAt <= now) {
                this.blockers.delete(blocker);
                continue;
            }
            if (blocked || !soundMatches(sound, blocker.match)) continue;
            blocked = true;
            if (blocker.once) this.blockers.delete(blocker);
        }
        return blocked;
    }

    // bit set in flags means that axis is relative to where the player already was
    private applyServerPosition(packet: Record<string, unknown>): void {
        if (![packet?.x, packet?.y, packet?.z].every((value) => typeof value === "number")) return;
        const flags = finite(packet.flags);
        const from = this.position ?? { x: 0, y: 0, z: 0 };
        this.position = {
            x: (flags & 0x01 ? from.x : 0) + (packet.x as number),
            y: (flags & 0x02 ? from.y : 0) + (packet.y as number),
            z: (flags & 0x04 ? from.z : 0) + (packet.z as number),
        };
    }
}

export function createSoundInjector(options: SoundInjectorOptions): SoundInjector {
    return new SoundInjector(options);
}
