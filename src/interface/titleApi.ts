// interface api for Minecraft titles, subtitles, and action bars
// TitleInjector in core tracks title packets and version-specific wire formats.
// this api provides a fluent interface for plugins while keeping custom text in effect when Hypixel updates its own overlays.

// FUNCTIONS
// createTitleApi(host, options) - session host and options in, a TitleApi out
// titleComponent(value, version) - encode plain text, JSON, or a chat component for the target protocol
// textComponent(text) - a simple chat component containing text
//
// PLUMBING
// TitleApi.handlePacket(name, data) - feed every decoded server packet through here before forwarding it
// TitleApi.flush() - reapply custom values after Hypixel's packet reaches the client
// TitleApi.clearServerState() - forget the current server overlay without changing custom values
// TitleApi.dispose() - clear owned values for session cleanup
//
// PROPERTIES
// TitleApi.title / subtitle / actionBar - the current encoded values, ours when overridden
// TitleApi.times - the current fade-in, stay, and fade-out durations
//
// METHODS
// TitleApi.setTitle(text) - set the main title
// TitleApi.setSubtitle(text) - set the title subtitle
// TitleApi.setActionBar(text) - set the text above the hotbar
// TitleApi.setTimes(times) - set fadeIn, stay, and fadeOut in game ticks
// TitleApi.show(title?, subtitle?, times?) - set any combination; omitted values remain unchanged
// TitleApi.clear() - display empty values and keep them owned so Hypixel cannot replace them
// TitleApi.reset() - drop all custom values and reset or clear Hypixel's overlay
//
// TEXT
// Methods accept plain strings, JSON component strings, component objects, or component arrays.
// Plain strings and JSON are encoded for 1.8-style clients; modern clients receive native components.
// 1.8 sends all overlays through the legacy title and chat packets, while newer versions use dedicated title packets.

import {
    DEFAULT_TITLE_TIMES,
    TitleInjector,
    createTitleInjector,
    textComponent,
    titleComponent,
    type TitleText,
    type TitleTimeOptions,
    type TitleTimes,
} from "../core/title";

export {
    DEFAULT_TITLE_TIMES,
    TitleInjector,
    createTitleInjector,
    textComponent,
    titleComponent,
};
export type { TitleText, TitleTimeOptions, TitleTimes };

export interface TitleHost {
    sendPacket(name: string, data: unknown): void;
}

export interface TitleApiOptions {
    version?: string;
    onError?: (error: unknown) => void;
}

export interface TitleApi {
    readonly title: TitleText | undefined;
    readonly subtitle: TitleText | undefined;
    readonly actionBar: TitleText | undefined;
    readonly times: TitleTimes;
    handlePacket(name: string, data: unknown): boolean;
    clearServerState(): void;
    flush(): void;
    setTitle(text: TitleText): TitleApi;
    setSubtitle(text: TitleText): TitleApi;
    setActionBar(text: TitleText): TitleApi;
    setTimes(times: TitleTimeOptions): TitleApi;
    show(title?: TitleText, subtitle?: TitleText, times?: TitleTimeOptions): TitleApi;
    clear(): TitleApi;
    reset(): TitleApi;
    dispose(): void;
}

class TitleApiImpl implements TitleApi {
    private readonly injector: TitleInjector;

    constructor(host: TitleHost, options: TitleApiOptions = {}) {
        this.injector = new TitleInjector({
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

    handlePacket(name: string, data: unknown): boolean {
        if (name === "login" || name === "respawn") {
            this.injector.clearServerState();
            return true;
        }
        return this.injector.applyPacket(name, data);
    }

    clearServerState(): void {
        this.injector.clearServerState();
    }

    flush(): void {
        this.injector.flush();
    }

    setTitle(text: TitleText): TitleApi {
        this.injector.setTitle(text);
        return this;
    }

    setSubtitle(text: TitleText): TitleApi {
        this.injector.setSubtitle(text);
        return this;
    }

    setActionBar(text: TitleText): TitleApi {
        this.injector.setActionBar(text);
        return this;
    }

    setTimes(times: TitleTimeOptions): TitleApi {
        this.injector.setTimes(times);
        return this;
    }

    show(title?: TitleText, subtitle?: TitleText, times?: TitleTimeOptions): TitleApi {
        this.injector.show(title, subtitle, times);
        return this;
    }

    clear(): TitleApi {
        this.injector.clear();
        return this;
    }

    reset(): TitleApi {
        this.injector.reset();
        return this;
    }

    dispose(): void {
        this.injector.dispose();
    }

    get title(): TitleText | undefined {
        return this.injector.currentTitle;
    }

    get subtitle(): TitleText | undefined {
        return this.injector.currentSubtitle;
    }

    get actionBar(): TitleText | undefined {
        return this.injector.currentActionBar;
    }

    get times(): TitleTimes {
        return this.injector.currentTimes;
    }
}

export function createTitleApi(host: TitleHost, options?: TitleApiOptions): TitleApi {
    return new TitleApiImpl(host, options);
}
