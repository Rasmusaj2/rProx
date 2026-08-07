// boss bar injector to draw custom text (and progress) on the top of the screen
// 1.8.9 client only draws 1 bossbar at a time, and hypixel typically uses its own (specifically in the main lobby where this is gonna be used the most for fishing)
// 3 modes to use:
// replace: make our own entity, hide hypixels, and overwrite to what we need
// adopt: write our text onto hypixels boss and keep rewriting it
// own: make our own entity and keep it up, but do not hide hypixels bosses - will flicker between boss bars or randomly choose one sometimes idk dont use this

// ids for mobs
const WITHER = 64; 
const DRAGON = 63;

export type BossEntity = "dragon" | "wither";
export type BossBarMode = "replace" | "adopt" | "own";

const ENTITY_TYPE: Record<BossEntity, number> = { dragon: DRAGON, wither: WITHER };

// what the client gives a boss it was never sent attributes for
const DEFAULT_MAX_HEALTH: Record<number, number> = { [WITHER]: 300, [DRAGON]: 200 };

// magic bullshit for datawatching
const META_FLAGS = 0; // byte, 0x20 is invisible
const META_NAME = 2; // string, the bar title
const META_NAME_VISIBLE = 3; // byte, floating nametag on/off
const META_SILENT = 4; // byte, and a dragon that is not silent flaps its wings at you
const META_HEALTH = 6; // float, the fill
const TYPE_BYTE = 0;
const TYPE_FLOAT = 3;
const TYPE_STRING = 4;
const INVISIBLE = 0x20;

// give our entity a unique id hypixel will never overwrite
const FAKE_ID = 0x7000_0001;

const MIN_HEALTH = 0.05; // 0 hp is a dead boss that the client will remove so we clamp a min

// frostum culling on bossbar
const AIM_RANGE = 24;
const AIM_LIFT = 6;
const EYE_HEIGHT = 1.62;
const SLACK = 1.5;

const MAX_TITLE = 96; // char max

export interface BossBar {
    title: string; // legacy §-string
    progress: number; // 0..1, clamped
}

export interface BossBarOptions {
    mode?: BossBarMode;
    entity?: BossEntity;
}

type Send = (name: string, data: unknown) => void;

interface MetaItem {
    key: number;
    type: number;
    value: unknown;
}

// everything it would take to put one of hypixels bosses back exactly as it was
interface Boss {
    type: number;
    meta: Map<number, MetaItem>; // every datawatcher value we have seen for it
    maxHealth: number;
    x: number; // wire units, 32nds of a block, so a restore is byte exact
    y: number;
    z: number;
    yaw: number;
    pitch: number;
    headYaw: number;
    hidden: boolean;
}

interface Point {
    x: number;
    y: number;
    z: number;
}

function fixed(value: number): number {
    return Math.round(value * 32);
}

function clampTitle(title: string): string {
    const cut = title.length <= MAX_TITLE ? title : title.slice(0, MAX_TITLE);
    return cut.endsWith("§") ? cut.slice(0, -1) : cut; // avoid having clamped off a color code which would make the boss bar render the § associated with it
}

function metaList(metadata: unknown): MetaItem[] {
    return Array.isArray(metadata) ? (metadata as MetaItem[]).filter((item) => item && typeof item.key === "number") : [];
}

export class BossBarInjector {
    private bosses = new Map<number, Boss>(); // hypixel boss bars in order of spawning, usually only one
    private wanted?: BossBar; // what we want to be showing
    private owned?: { id: number; mine: boolean }; // the entity currently carrying our bar
    private pushed?: BossBar; // what we last wrote to the bossbar
    private at: Point = { x: 0, y: 0, z: 0 }; // player location
    private yaw = 0; // rotation
    private pitch = 0;
    private placed?: Point; // entity position
    private mode: BossBarMode;
    private entity: BossEntity;

    constructor(options: BossBarOptions = {}) {
        this.mode = options.mode ?? "replace";
        this.entity = options.entity ?? "dragon";
    }

    // what kind of bar we are currently hosting, if any
    // own and adopted only differ in if we spawned or hypixel did
    // if hypixel did, we dont need to clean up
    get hosting(): "none" | "own" | "adopted" {
        if (!this.owned) return "none";
        return this.owned.mine ? "own" : "adopted";
    }

    // both of these take effect on the next flush
    setMode(mode: BossBarMode, send: Send): void {
        if (mode === this.mode) return;
        this.stop(send); 
        this.mode = mode;
    }

    setEntity(entity: BossEntity, send: Send): void {
        if (entity === this.entity) return;
        if (this.owned?.mine) this.release(send);
        this.entity = entity;
    }

    applySpawnLiving(packet: { entityId: number; type: number; metadata?: unknown; x: number; y: number; z: number; yaw?: number; pitch?: number; headPitch?: number }): void {
        if (packet.type !== WITHER && packet.type !== DRAGON) return;
        const boss: Boss = {
            type: packet.type,
            meta: new Map(),
            maxHealth: DEFAULT_MAX_HEALTH[packet.type],
            x: packet.x,
            y: packet.y,
            z: packet.z,
            yaw: packet.yaw ?? 0,
            pitch: packet.pitch ?? 0,
            headYaw: packet.headPitch ?? 0, // the spawn packet calls the head yaw a pitch
            hidden: false,
        };
        for (const item of metaList(packet.metadata)) boss.meta.set(item.key, item);
        this.bosses.set(packet.entityId, boss);
    }

    applyMetadata(packet: { entityId: number; metadata?: unknown }): void {
        const boss = this.bosses.get(packet.entityId);
        if (!boss) return;
        for (const item of metaList(packet.metadata)) boss.meta.set(item.key, item);
        if (this.owned && !this.owned.mine && this.owned.id === packet.entityId) this.pushed = undefined;
    }

    applyAttributes(packet: { entityId: number; properties?: Array<{ key: string; value: number }> }): void {
        const boss = this.bosses.get(packet.entityId);
        if (!boss) return;
        for (const property of packet.properties ?? []) {
            if (property.key === "generic.maxHealth" && property.value > 0) boss.maxHealth = property.value;
        }
    }

    applyMove(name: string, packet: any): void {
        const boss = this.bosses.get(packet.entityId);
        if (!boss) return;
        if (name === "entity_teleport") {
            boss.x = packet.x;
            boss.y = packet.y;
            boss.z = packet.z;
        } else if (name === "rel_entity_move" || name === "entity_move_look") {
            boss.x += packet.dX ?? 0;
            boss.y += packet.dY ?? 0;
            boss.z += packet.dZ ?? 0;
        }
        if (typeof packet.yaw === "number") boss.yaw = packet.yaw;
        if (typeof packet.pitch === "number") boss.pitch = packet.pitch;
    }

    applyHeadRotation(packet: { entityId: number; headYaw?: number }): void {
        const boss = this.bosses.get(packet.entityId);
        if (boss && typeof packet.headYaw === "number") boss.headYaw = packet.headYaw;
    }

    applyDestroy(packet: { entityIds?: number[] }): void {
        for (const id of packet.entityIds ?? []) {
            this.bosses.delete(id);
            if (this.owned && !this.owned.mine && this.owned.id === id) {
                this.owned = undefined;
                this.pushed = undefined;
            }
        }
    }

    setPlayerPosition(x: number, y: number, z: number): void {
        this.at = { x, y, z };
    }

    setPlayerLook(yaw: number, pitch: number): void {
        this.yaw = yaw;
        this.pitch = pitch;
    }

    clear(): void {
        this.bosses.clear();
        this.owned = undefined;
        this.pushed = undefined;
        this.placed = undefined;
    }

    set(bar: BossBar | null): void { // pass it back to hypixel on null
        this.wanted = bar ?? undefined;
    }

    flush(send: Send): void {
        const wanted = this.wanted;
        if (!wanted) {
            this.stop(send);
            return;
        }

        const owned = this.acquire(send);
        if (!owned) return;
        if (owned.mine) this.tether(send);
        if (this.pushed && same(this.pushed, wanted)) return;

        const maxHealth = owned.mine
            ? DEFAULT_MAX_HEALTH[ENTITY_TYPE[this.entity]]
            : (this.bosses.get(owned.id)?.maxHealth ?? DEFAULT_MAX_HEALTH[WITHER]);
        send("entity_metadata", {
            entityId: owned.id,
            metadata: [
                { key: META_NAME, type: TYPE_STRING, value: clampTitle(wanted.title) },
                { key: META_HEALTH, type: TYPE_FLOAT, value: healthFor(wanted.progress, maxHealth) },
            ],
        });
        this.pushed = { ...wanted };
    }

    // what the //bossbar command prints, debug stuff mostly
    describe(): string[] {
        const lines = [
            `mode ${this.mode}, entity ${this.entity}, hosting ${this.hosting}`,
            `player ${point(this.at)} looking ${this.yaw.toFixed(0)}/${this.pitch.toFixed(0)}`,
            this.placed ? `ours at ${point(this.placed)} (${away(this.at, this.placed).toFixed(1)} blocks away)` : "ours not spawned",
        ];
        if (!this.bosses.size) lines.push("no hypixel boss entities seen");
        for (const [id, boss] of this.bosses) {
            const name = boss.meta.get(META_NAME)?.value;
            const health = boss.meta.get(META_HEALTH)?.value;
            const kind = boss.type === DRAGON ? "dragon" : "wither";
            lines.push(
                `#${id} ${kind} ${boss.hidden ? "hidden " : ""}hp ${health ?? "?"}/${boss.maxHealth} at ${point({ x: boss.x / 32, y: boss.y / 32, z: boss.z / 32 })} ${JSON.stringify(name ?? "")}`,
            );
        }
        return lines;
    }

    private acquire(send: Send): { id: number; mine: boolean } | undefined {
        if (this.mode === "adopt") {
            const host = this.firstBoss();
            if (host !== undefined) {
                if (this.owned && (this.owned.mine || this.owned.id !== host)) this.release(send);
                if (!this.owned) this.owned = { id: host, mine: false };
                return this.owned;
            }
        }
        // one boss rendering at a time or the client draws whichever went last so it'll fliccker
        if (this.mode === "replace") this.hideServerBosses(send);
        if (this.owned && !this.owned.mine) this.release(send);
        if (!this.owned) this.spawn(send);
        return this.owned;
    }

    private firstBoss(): number | undefined {
        for (const [id, boss] of this.bosses) {
            if (!boss.hidden) return id;
        }
        return undefined;
    }

    private spawn(send: Send): void {
        const position = this.want();
        send("spawn_entity_living", { // need to make this properly invis
            entityId: FAKE_ID,
            type: ENTITY_TYPE[this.entity],
            x: fixed(position.x),
            y: fixed(position.y),
            z: fixed(position.z),
            yaw: 0,
            pitch: 0,
            headPitch: 0,
            velocity: { x: 0, y: 0, z: 0 },
            metadata: [
                { key: META_FLAGS, type: TYPE_BYTE, value: INVISIBLE },
                { key: META_NAME, type: TYPE_STRING, value: "" },
                { key: META_NAME_VISIBLE, type: TYPE_BYTE, value: 0 },
                { key: META_SILENT, type: TYPE_BYTE, value: 1 },
                { key: META_HEALTH, type: TYPE_FLOAT, value: MIN_HEALTH },
            ],
        });
        this.placed = position;
        this.owned = { id: FAKE_ID, mine: true };
        this.pushed = undefined;
    }

    // where our entity wants to be right now: on the crosshair and a little above it
    private want(): Point {
        const yaw = (this.yaw * Math.PI) / 180;
        const pitch = (this.pitch * Math.PI) / 180;
        const flat = Math.cos(pitch);
        return {
            x: this.at.x - Math.sin(yaw) * flat * AIM_RANGE,
            y: this.at.y + EYE_HEIGHT - Math.sin(pitch) * AIM_RANGE + AIM_LIFT,
            z: this.at.z + Math.cos(yaw) * flat * AIM_RANGE,
        };
    }

    private tether(send: Send): void { // thtered to player crosshair
        const placed = this.placed;
        if (!placed) return;
        const wanted = this.want();
        if (away(wanted, placed) < SLACK) return;
        send("entity_teleport", {
            entityId: FAKE_ID,
            x: fixed(wanted.x),
            y: fixed(wanted.y),
            z: fixed(wanted.z),
            yaw: 0,
            pitch: 0,
            onGround: false,
        });
        this.placed = wanted;
    }

    // kill hypixels bosses
    private hideServerBosses(send: Send): void {
        for (const [id, boss] of this.bosses) {
            if (boss.hidden) continue;
            boss.hidden = true;
            send("entity_destroy", { entityIds: [id] });
        }
    }

    private showServerBosses(send: Send): void {
        for (const [id, boss] of this.bosses) {
            if (!boss.hidden) continue;
            boss.hidden = false;
            send("spawn_entity_living", {
                entityId: id,
                type: boss.type,
                x: boss.x,
                y: boss.y,
                z: boss.z,
                yaw: boss.yaw,
                pitch: boss.pitch,
                headPitch: boss.headYaw,
                velocity: { x: 0, y: 0, z: 0 },
                metadata: [...boss.meta.values()],
            });
        }
    }

    // cancel everything we're doing
    private stop(send: Send): void {
        this.release(send);
        this.showServerBosses(send);
    }

    private release(send: Send): void {
        const owned = this.owned;
        this.owned = undefined;
        this.pushed = undefined;
        if (!owned) return;
        if (owned.mine) {
            send("entity_destroy", { entityIds: [FAKE_ID] });
            this.placed = undefined;
            return;
        }
        const boss = this.bosses.get(owned.id);
        if (!boss) return;
        const name = boss.meta.get(META_NAME) ?? { key: META_NAME, type: TYPE_STRING, value: "" };
        const health = boss.meta.get(META_HEALTH) ?? { key: META_HEALTH, type: TYPE_FLOAT, value: boss.maxHealth };
        send("entity_metadata", { entityId: owned.id, metadata: [name, health] });
    }
}

function healthFor(progress: number, maxHealth: number): number {
    const clamped = Math.min(1, Math.max(0, progress));
    return Math.max(MIN_HEALTH, clamped * maxHealth);
}

// a bar redrawn 20 times a second only needs a packet when it actually moved, and
// half a percent is under one pixel of the 182 the client draws it in
function same(a: BossBar, b: BossBar): boolean {
    return a.title === b.title && Math.abs(a.progress - b.progress) < 0.005;
}

function away(a: Point, b: Point): number {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function point(p: Point): string {
    return `${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}`;
}
