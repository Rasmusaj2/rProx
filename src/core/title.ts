import { stripColorCodes } from "../util/mcColors";

export type TitleText = string | readonly unknown[] | Readonly<Record<string, unknown>>;

export interface TitleTimes {
    fadeIn: number;
    stay: number;
    fadeOut: number;
}

export type TitleTimeOptions = Partial<TitleTimes>;

export interface TitleInjectorOptions {
    version?: string;
    sendPacket(name: string, data: unknown): void;
}

export const DEFAULT_TITLE_TIMES: Readonly<TitleTimes> = Object.freeze({
    fadeIn: 10,
    stay: 70,
    fadeOut: 10,
});

function isTitleText(value: unknown): value is TitleText {
    return typeof value === "string" || Array.isArray(value) || (value !== null && typeof value === "object");
}

function versionParts(version: string): [number, number, number] {
    const match = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(version);
    if (!match) return [1, 8, 0];
    return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
}

function usesNewTitlePackets(version: string): boolean {
    const [major, minor, patch] = versionParts(version);
    return major > 1 || (major === 1 && (minor > 17 || (minor === 17 && patch >= 1)));
}

function usesNbtTitleComponents(version: string): boolean {
    const [major, minor, patch] = versionParts(version);
    return major > 1 || (major === 1 && (minor > 20 || (minor === 20 && patch >= 3)));
}

function parsedComponent(value: string): unknown {
    const trimmed = value.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return undefined;
    try {
        return JSON.parse(trimmed);
    } catch {
        return undefined;
    }
}

export function titleComponent(value: TitleText, version: string): TitleText {
    const raw: unknown = typeof value === "string" ? parsedComponent(value) ?? value : value;
    if (usesNbtTitleComponents(version)) {
        if (typeof raw === "string") return { text: raw };
        if (isTitleText(raw)) return raw;
    }
    if (typeof raw === "string") return JSON.stringify({ text: raw });
    return JSON.stringify(raw);
}

export function textComponent(text: string): Record<string, string> {
    return { text };
}

// flatten an encoded title value - a json string on 1.8, a component object or
// array on newer versions - down to the plain text a player would read. never
// throws and returns "" for anything empty, so callers dont have to null-check
export function plainTitleText(value: TitleText | null | undefined): string {
    if (value === undefined || value === null) return "";
    const raw: unknown = typeof value === "string" ? parsedComponent(value) ?? value : value;
    return stripColorCodes(flattenTitle(raw));
}

function flattenTitle(node: unknown): string {
    if (typeof node === "string") return node;
    if (Array.isArray(node)) return node.map(flattenTitle).join("");
    if (node !== null && typeof node === "object") {
        const record = node as Record<string, unknown>;
        let out = typeof record.text === "string" ? record.text : "";
        if (record.extra !== undefined) out += flattenTitle(record.extra);
        return out;
    }
    return "";
}

function wireEquals(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    try {
        return JSON.stringify(a) === JSON.stringify(b);
    } catch {
        return false;
    }
}

function sameTimes(a: TitleTimes, b: TitleTimes): boolean {
    return a.fadeIn === b.fadeIn && a.stay === b.stay && a.fadeOut === b.fadeOut;
}

function normaliseTimes(times: TitleTimeOptions = {}): TitleTimes {
    return {
        fadeIn: Math.max(0, Math.floor(times.fadeIn ?? DEFAULT_TITLE_TIMES.fadeIn)),
        stay: Math.max(0, Math.floor(times.stay ?? DEFAULT_TITLE_TIMES.stay)),
        fadeOut: Math.max(0, Math.floor(times.fadeOut ?? DEFAULT_TITLE_TIMES.fadeOut)),
    };
}

export class TitleInjector {
    private readonly version: string;
    private readonly sendPacket: (name: string, data: unknown) => void;
    private readonly newPackets: boolean;
    private title?: TitleText;
    private subtitle?: TitleText;
    private actionBar?: TitleText;
    private ownTitle?: TitleText;
    private ownSubtitle?: TitleText;
    private ownActionBar?: TitleText;
    private serverTimes?: TitleTimes;
    private ownTimes?: TitleTimes;
    private times: TitleTimes = { ...DEFAULT_TITLE_TIMES };

    constructor(options: TitleInjectorOptions) {
        this.version = options.version ?? "1.8.9";
        this.sendPacket = options.sendPacket;
        this.newPackets = usesNewTitlePackets(this.version);
    }

    setTitle(text: TitleText): void {
        const next = this.encode(text);
        if (wireEquals(this.ownTitle, next)) return;
        this.ownTitle = next;
        this.title = next;
        this.writeTitle("title", next);
    }

    setSubtitle(text: TitleText): void {
        const next = this.encode(text);
        if (wireEquals(this.ownSubtitle, next)) return;
        this.ownSubtitle = next;
        this.subtitle = next;
        this.writeTitle("subtitle", next);
    }

    setActionBar(text: TitleText): void {
        const next = this.encode(text);
        if (wireEquals(this.ownActionBar, next)) return;
        this.ownActionBar = next;
        this.actionBar = next;
        this.writeActionBar(next);
    }

    setTimes(times: TitleTimeOptions): void {
        const next = normaliseTimes(times);
        if (this.ownTimes && sameTimes(this.ownTimes, next)) return;
        this.ownTimes = next;
        this.times = next;
        this.writeTimes(next);
    }

    show(title?: TitleText, subtitle?: TitleText, times?: TitleTimeOptions): void {
        if (times) this.setTimes(times);
        if (title !== undefined) this.setTitle(title);
        if (subtitle !== undefined) this.setSubtitle(subtitle);
    }

    clear(): void {
        const empty = this.encode("");
        this.ownTitle = empty;
        this.ownSubtitle = empty;
        this.ownActionBar = empty;
        this.title = empty;
        this.subtitle = empty;
        this.actionBar = empty;
        if (this.newPackets) {
            this.sendPacket("clear_titles", { reset: false });
        } else {
            this.sendPacket("title", { action: 0, text: empty });
            this.sendPacket("title", { action: 1, text: empty });
        }
        this.writeActionBar(empty);
    }

    reset(): void {
        this.ownTitle = undefined;
        this.ownSubtitle = undefined;
        this.ownActionBar = undefined;
        this.ownTimes = undefined;
        this.title = undefined;
        this.subtitle = undefined;
        this.actionBar = undefined;
        this.times = { ...DEFAULT_TITLE_TIMES };
        if (this.newPackets) {
            this.sendPacket("clear_titles", { reset: true });
            this.sendPacket("action_bar", { text: this.encode("") });
            return;
        }
        const empty = this.encode("");
        this.sendPacket("title", { action: 0, text: empty });
        this.sendPacket("title", { action: 1, text: empty });
        this.writeActionBar(empty);
        this.writeTimes({ ...DEFAULT_TITLE_TIMES });
    }

    applyPacket(name: string, data: unknown): boolean {
        const packet = data as Record<string, unknown>;
        if (name === "title") {
            if (Number(packet?.action) === 0 && isTitleText(packet.text)) return this.applyServerText("title", packet.text);
            if (Number(packet?.action) === 1 && isTitleText(packet.text)) return this.applyServerText("subtitle", packet.text);
            if (Number(packet?.action) === 2) return this.applyTimes(packet);
            return false;
        }
        if (name === "set_title_text") {
            return isTitleText(packet?.text) && this.applyServerText("title", packet.text);
        }
        if (name === "set_title_subtitle") {
            return isTitleText(packet?.text) && this.applyServerText("subtitle", packet.text);
        }
        if (name === "set_title_time") return this.applyTimes(packet);
        if (name === "action_bar") {
            return isTitleText(packet?.text) && this.applyServerText("actionBar", packet.text);
        }
        if (name === "chat" && Number(packet?.position) === 2) {
            return isTitleText(packet?.message) && this.applyServerText("actionBar", packet.message);
        }
        if (name === "clear_titles") {
            this.clearServerState();
            return true;
        }
        return false;
    }

    clearServerState(): void {
        this.title = undefined;
        this.subtitle = undefined;
        this.actionBar = undefined;
        this.serverTimes = undefined;
        this.times = { ...DEFAULT_TITLE_TIMES };
    }

    flush(): void {
        if (this.ownTitle !== undefined && !wireEquals(this.title, this.ownTitle)) {
            this.title = this.ownTitle;
            this.writeTitle("title", this.ownTitle);
        }
        if (this.ownSubtitle !== undefined && !wireEquals(this.subtitle, this.ownSubtitle)) {
            this.subtitle = this.ownSubtitle;
            this.writeTitle("subtitle", this.ownSubtitle);
        }
        if (this.ownActionBar !== undefined && !wireEquals(this.actionBar, this.ownActionBar)) {
            this.actionBar = this.ownActionBar;
            this.writeActionBar(this.ownActionBar);
        }
        if (this.ownTimes && !sameTimes(this.ownTimes, this.times)) {
            this.times = this.ownTimes;
            this.writeTimes(this.ownTimes);
        }
    }

    dispose(): void {
        this.clear();
    }

    get currentTitle(): TitleText | undefined {
        return this.title;
    }

    get currentSubtitle(): TitleText | undefined {
        return this.subtitle;
    }

    get currentActionBar(): TitleText | undefined {
        return this.actionBar;
    }

    get currentTimes(): TitleTimes {
        return { ...this.times };
    }

    private encode(value: TitleText): TitleText {
        return titleComponent(value, this.version);
    }

    private applyServerText(slot: "title" | "subtitle" | "actionBar", value: TitleText): true {
        if (slot === "title") this.title = value;
        else if (slot === "subtitle") this.subtitle = value;
        else this.actionBar = value;
        return true;
    }

    private applyTimes(packet: Record<string, unknown>): boolean {
        if (![packet.fadeIn, packet.stay, packet.fadeOut].every(
            (value) => typeof value === "number" && Number.isFinite(value),
        )) return false;
        const next = normaliseTimes({
            fadeIn: packet.fadeIn as number,
            stay: packet.stay as number,
            fadeOut: packet.fadeOut as number,
        });
        this.serverTimes = next;
        this.times = next;
        return true;
    }

    private writeTitle(slot: "title" | "subtitle", value: TitleText): void {
        if (!this.newPackets) {
            this.sendPacket("title", { action: slot === "title" ? 0 : 1, text: value });
            return;
        }
        this.sendPacket(slot === "title" ? "set_title_text" : "set_title_subtitle", { text: value });
    }

    private writeActionBar(value: TitleText): void {
        if (this.newPackets) this.sendPacket("action_bar", { text: value });
        else this.sendPacket("chat", { message: value, position: 2 });
    }

    private writeTimes(times: TitleTimes): void {
        if (this.newPackets) this.sendPacket("set_title_time", times);
        else this.sendPacket("title", { action: 2, ...times });
    }
}

export function createTitleInjector(options: TitleInjectorOptions): TitleInjector {
    return new TitleInjector(options);
}
