// interface api for sounds the client hears
// SoundInjector in core decodes sound packets, tracks where the player stands, and holds the active blocks.
// this api lets plugins mute hypixels sounds, react to them, or play their own on the player.

// FUNCTIONS
// createSoundApi(host, options) - session host and options in, a SoundApi out
// parseSoundPacket(name, data, version) - decode a named_sound_effect, undefined for anything else
// soundMatches(sound, match) - test a decoded sound against a name, pattern, or predicate
//
// PLUMBING
// SoundApi.handleServerPacket(name, data) - feed every decoded server packet through here. true means the packet must NOT be forwarded to the client
// SoundApi.handleClientPacket(name, data) - feed every client packet through here, keeps the player position current
// SoundApi.clearServerState() - forget the last server sound
// SoundApi.dispose() - drop every block and listener for session cleanup
//
// PROPERTIES
// SoundApi.lastSound - the last sound hypixel played, blocked or not
// SoundApi.position - where the player last stood, undefined until the first position packet
//
// METHODS
// SoundApi.play(name, options?) - play a sound on the client, at the player unless x/y/z are given
// SoundApi.block(match, options?) - swallow matching hypixel sounds, returns a function that removes the block
//     options.once lets go after the first swallowed sound, options.timeoutMs lets go after that long
// SoundApi.onSound(listener) - fires for every hypixel sound, with whether it was blocked. returns a function that removes it
//
// SOUNDS
// sound holds every 1.8 sound name nested by its dots, so sound.random.orb is "random.orb" and sound.mob.enderdragon.growl is "mob.enderdragon.growl".
// A name that is also the start of longer names sits under _: sound.game.player.hurt._ is "game.player.hurt". SOUND_NAMES is the flat list.
// Names are version specific: "note.pling" on 1.8, "block.note.pling" on 1.9-1.12, "block.note_block.pling" after. Pitch is a float where 1 is normal, on every version.
// Only named sounds are covered, which is every sound up to 1.19.2.

import {
    SoundInjector,
    createSoundInjector,
    parseSoundPacket,
    soundMatches,
    type Position,
    type ServerSound,
    type SoundBlockOptions,
    type SoundCategory,
    type SoundMatch,
    type SoundOptions,
} from "../core/sound";
import { SOUND_NAMES, sound, type SoundName } from "../core/soundNames";

export { SOUND_NAMES, SoundInjector, createSoundInjector, parseSoundPacket, sound, soundMatches };
export type { Position, ServerSound, SoundBlockOptions, SoundCategory, SoundMatch, SoundName, SoundOptions };

export interface SoundHost {
    sendPacket(name: string, data: unknown): void;
}

export interface SoundApiOptions {
    version?: string;
    onError?: (error: unknown) => void;
}

export type SoundListener = (sound: ServerSound, blocked: boolean) => void;

export interface SoundApi {
    readonly lastSound: ServerSound | undefined;
    readonly position: Position | undefined;
    handleServerPacket(name: string, data: unknown): boolean;
    handleClientPacket(name: string, data: unknown): void;
    clearServerState(): void;
    play(name: string, options?: SoundOptions): SoundApi;
    block(match: SoundMatch, options?: SoundBlockOptions): () => void;
    onSound(listener: SoundListener): () => void;
    dispose(): void;
}

class SoundApiImpl implements SoundApi {
    private readonly injector: SoundInjector;
    private readonly listeners = new Set<SoundListener>();

    constructor(host: SoundHost, private readonly options: SoundApiOptions = {}) {
        this.injector = new SoundInjector({
            version: options.version,
            sendPacket: (name, data) => {
                try {
                    host.sendPacket(name, data);
                } catch (error) {
                    options.onError?.(error);
                }
            },
        });
    }

    handleServerPacket(name: string, data: unknown): boolean {
        if (name === "login" || name === "respawn") {
            this.injector.clearServerState();
            return false;
        }
        const { sound: heard, blocked } = this.injector.applyServerPacket(name, data);
        if (!heard) return false;
        for (const listener of this.listeners) {
            try {
                listener(heard, blocked);
            } catch (error) {
                this.options.onError?.(error);
            }
        }
        return blocked;
    }

    handleClientPacket(name: string, data: unknown): void {
        this.injector.applyClientPacket(name, data);
    }

    clearServerState(): void {
        this.injector.clearServerState();
    }

    play(name: string, options?: SoundOptions): SoundApi {
        this.injector.play(name, options);
        return this;
    }

    block(match: SoundMatch, options?: SoundBlockOptions): () => void {
        return this.injector.block(match, options);
    }

    onSound(listener: SoundListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    dispose(): void {
        this.listeners.clear();
        this.injector.dispose();
    }

    get lastSound(): ServerSound | undefined {
        return this.injector.lastSound;
    }

    get position(): Position | undefined {
        return this.injector.currentPosition;
    }
}

export function createSoundApi(host: SoundHost, options?: SoundApiOptions): SoundApi {
    return new SoundApiImpl(host, options);
}
