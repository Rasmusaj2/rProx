// interface api for interacting with the bossbar at a higher level than in core
// BossBarInjector in core thinks in entities, metadata and packet diffs.
// this api owns an injector, routes packets into it, and coalesces updates into flushes.
// a bar is a legacy §-string title plus a progress value between 0 and 1.

// FUNCTIONS
// createBossBarApi(host, options) - session & options in, a BossBarApi out
// BossBarApi.handleServerPacket(name, data) - feed every server packet through here, returns whether it was one we care about
// BossBarApi.handleClientPacket(name, data) - feed every client movement packet through here, returns whether it was one we care about
// BossBarApi.set(bar) - draw a bar, null hands the screen back to hypixel
// BossBarApi.flush() - render and send now instead of waiting for the coalesced flush
// BossBarApi.clear() - drop our bar and put hypixels back
// BossBarApi.setMode(mode) - switch between replace, adopt, and own
// BossBarApi.setEntity(entity) - choose the entity for a bar we spawned
// BossBarApi.describe() - debug lines for the //bossbar command
// BossBarApi.dispose() - drop pending work without restoring hypixels bar

// PROPERTIES
// BossBarApi.bar - the bar we are drawing, a copy, null when we are not drawing one
// BossBarApi.hosting - none, own, or adopted, whether we currently have a bar on screen
// BossBarApi.mode - the mode in effect
// BossBarApi.entity - the entity in effect

// MODES
// replace: make our own entity, hide hypixels, and overwrite to what we need
// adopt: write our text onto hypixels boss and keep rewriting it
// own: make our own entity and keep it up, but do not hide hypixels bosses - will flicker between boss bars

import {
    BossBarInjector,
    type BossBar,
    type BossBarMode,
    type BossBarOptions,
    type BossEntity,
} from "../core/bossbar";

export type { BossBar, BossBarMode, BossBarOptions, BossEntity } from "../core/bossbar";

export interface BossBarHost {
    sendPacket(name: string, data: unknown): void;
}

export interface BossBarApiOptions extends BossBarOptions {
    autoFlush?: boolean;
    onError?: (error: unknown) => void;
}

const BOSS_BAR_MODES: readonly BossBarMode[] = ["replace", "adopt", "own"];
const BOSS_ENTITIES: readonly BossEntity[] = ["dragon", "wither"];

export class BossBarApi {
    private readonly injector: BossBarInjector;
    private readonly autoFlush: boolean;
    private readonly send: (name: string, data: unknown) => void;
    private current: BossBar | null = null;
    private pending?: NodeJS.Immediate;
    private bossMode: BossBarMode;
    private entityType: BossEntity;

    constructor(
        private readonly host: BossBarHost,
        private readonly options: BossBarApiOptions = {},
    ) {
        const mode = options.mode ?? "replace";
        const entity = options.entity ?? "dragon";
        this.bossMode = BOSS_BAR_MODES.includes(mode) ? mode : "replace";
        this.entityType = BOSS_ENTITIES.includes(entity) ? entity : "dragon";
        this.autoFlush = options.autoFlush !== false;
        this.injector = new BossBarInjector({ mode: this.bossMode, entity: this.entityType });
        this.send = (name, data) => this.host.sendPacket(name, data);
    }

    get bar(): BossBar | null {
        return this.current ? { ...this.current } : null;
    }

    get hosting(): "none" | "own" | "adopted" {
        return this.injector.hosting;
    }

    get mode(): BossBarMode {
        return this.bossMode;
    }

    get entity(): BossEntity {
        return this.entityType;
    }

    handleServerPacket(name: string, data: any): boolean {
        try {
            switch (name) {
                case "spawn_entity_living":
                    this.injector.applySpawnLiving(data);
                    break;
                case "entity_metadata":
                    this.injector.applyMetadata(data);
                    break;
                case "update_attributes":
                    this.injector.applyAttributes(data);
                    break;
                case "entity_teleport":
                case "rel_entity_move":
                case "entity_move_look":
                case "entity_look":
                    this.injector.applyMove(name, data);
                    break;
                case "entity_head_rotation":
                    this.injector.applyHeadRotation(data);
                    break;
                case "entity_destroy":
                    this.injector.applyDestroy(data);
                    break;
                case "position":
                    if (!data?.flags) {
                        this.injector.setPlayerPosition(data.x, data.y, data.z);
                        if (typeof data.yaw === "number" && typeof data.pitch === "number") {
                            this.injector.setPlayerLook(data.yaw, data.pitch);
                        }
                    }
                    break;
                case "login":
                case "respawn":
                    this.cancel();
                    this.current = null;
                    this.injector.set(null);
                    this.injector.clear();
                    return true;
                default:
                    return false;
            }
        } catch (error) {
            this.fail(error);
            return true;
        }
        this.schedule();
        return true;
    }

    handleClientPacket(name: string, data: any): boolean {
        try {
            switch (name) {
                case "position":
                case "position_look":
                    this.injector.setPlayerPosition(data.x, data.y, data.z);
                    break;
                case "look":
                    this.injector.setPlayerLook(data.yaw, data.pitch);
                    break;
                default:
                    return false;
            }
        } catch (error) {
            this.fail(error);
            return true;
        }
        this.schedule();
        return true;
    }

    set(bar: BossBar | null): void {
        this.current = bar ? { title: bar.title, progress: bar.progress } : null;
        this.injector.set(this.current);
        this.schedule();
    }

    flush(): void {
        this.cancel();
        try {
            this.injector.flush(this.send);
        } catch (error) {
            this.fail(error);
        }
    }

    clear(): void {
        this.set(null);
        this.flush();
    }

    setMode(mode: BossBarMode): void {
        if (!BOSS_BAR_MODES.includes(mode)) {
            this.fail(new TypeError(`Invalid boss bar mode: ${String(mode)}`));
            return;
        }
        if (mode === this.bossMode) return;
        try {
            this.injector.setMode(mode, this.send);
            this.bossMode = mode;
            this.schedule();
        } catch (error) {
            this.fail(error);
        }
    }

    setEntity(entity: BossEntity): void {
        if (!BOSS_ENTITIES.includes(entity)) {
            this.fail(new TypeError(`Invalid boss bar entity: ${String(entity)}`));
            return;
        }
        if (entity === this.entityType) return;
        try {
            this.injector.setEntity(entity, this.send);
            this.entityType = entity;
            this.schedule();
        } catch (error) {
            this.fail(error);
        }
    }

    describe(): string[] {
        return this.injector.describe();
    }

    dispose(): void {
        this.cancel();
    }

    private schedule(): void {
        if (!this.autoFlush || !this.current || this.pending) return;
        this.pending = setImmediate(() => {
            this.pending = undefined;
            this.flush();
        });
    }

    private cancel(): void {
        if (!this.pending) return;
        clearImmediate(this.pending);
        this.pending = undefined;
    }

    private fail(error: unknown): void {
        this.options.onError?.(error);
    }
}

export function createBossBarApi(host: BossBarHost, options?: BossBarApiOptions): BossBarApi {
    return new BossBarApi(host, options);
}
