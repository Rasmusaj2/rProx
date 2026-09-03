// interface api for inventories and chest guis
// Allows you to create custom GUI interfaces, or override Hypixels own

// FUNCTIONS
// createWindowApi(host, options) - a client to send at in, a WindowApi out
// item(spec) - an ItemSpec into a protocol slot, on its own if you want one outside a window
// readItem(slot) - a protocol slot back into id/name/lore, for reading hypixels items
//
// PLUMBING
// WindowApi.handleServerPacket(name, data) - feed every server packet through here, returns whether it was one we care about
// WindowApi.handleClientPacket(name, data) - feed every client packet through here BEFORE forwarding it. true means it was for a window of ours and must not go upstream
// WindowApi.dispose() - drop every window and rule, for session end
//
// OUR OWN CHESTS
// WindowApi.chest(spec) - open a chest that exists only on the client, returns a Chest
// WindowApi.menu(spec) - a paged Chest with a 4x7 grid, a back button and page arrows
// WindowApi.current() - the window of ours the client is looking at, if any
// WindowApi.closeAll() - shut every window of ours
//
// Chest.set(slot, item) / setAll(items) / fill(item, slots?) / border(item) / row(index, items) / clear()
// Chest.item(slot) - what we last drew there
// Chest.setTitle(text) / setRows(rows) - a 1.8 client cannot be told a new title, so these reopen the window with the contents kept
// Chest.onClick(handler) / onClose(handler) / refresh() / close() / isOpen()
//
// HYPIXELS CHESTS
// WindowApi.server() - the hypixel window that is open, as a ServerWindow
// WindowApi.rewrite(rule) - rename, relore, replace or blank slots in hypixels windows, re-applied whenever they resend. returns a function that removes it
// WindowApi.onServerWindow(listener) - fires whenever hypixel opens or refills one
// ServerWindow.items() / item(slot) / find(match) / setItem(slot, item) - read it, or write over the top of it
// ServerWindow.click(slot, options?) / close() - press a button in it, or shut it, upstream. needs host.sendServerPacket

import { componentToLegacy } from "../core/chat";
import {
    CHEST,
    CHEST_COLUMNS,
    EMPTY,
    MAX_CHEST_ROWS,
    OUTSIDE,
    PLAYER_SLOTS,
    PLAYER_WINDOW,
    WindowInjector,
    readItem,
    slotPosition,
    toSlot,
    type ItemInfo,
    type ItemSpec,
    type ServerWindowInfo,
    type Slot,
} from "../core/window";
import { stripColorCodes } from "../util/mcColors";

export {
    CHEST,
    CHEST_COLUMNS,
    DYE,
    EMPTY,
    ITEM_IDS,
    MAX_CHEST_ROWS,
    PLAYER_SLOTS,
    WOOL,
    itemId,
    readItem,
    toSlot as item,
    type ItemInfo,
    type ItemSpec,
    type Slot,
} from "../core/window";

// 28 slots for a 4x7 grid
// you can do 6x9, this makes it nicer for ie. the config menu
export const CONTENT_SLOTS: readonly number[] = Object.freeze([
    10, 11, 12, 13, 14, 15, 16,
    19, 20, 21, 22, 23, 24, 25,
    28, 29, 30, 31, 32, 33, 34,
    37, 38, 39, 40, 41, 42, 43,
]);

export const NAV_PREV = 45; // bottom left
export const NAV_BACK = 49; // bottom middle
export const NAV_NEXT = 53; // bottom right

export interface WindowHost {
    sendPacket(name: string, data: unknown): void; // to client
    sendServerPacket?(name: string, data: unknown): void; // to hypixel
}

export interface WindowApiOptions {
    version?: string; // for decoding hypixels window titles, "1.8.9"
    onError?: (error: unknown) => void;
    // close hypixels window upstream when we put one of ours over it, so it does
    // not sit open on their side for the rest of the session. on by default
    closeServerWindows?: boolean;
}

export interface ClickEvent {
    chest: Chest;
    slot: number; // raw protocol slot, -999 for a click off the window
    container: boolean; // inside the chest half, not the player inventory under it
    row: number; // inside the chest half only, -1 otherwise
    column: number;
    button: number; // 0 left, 1 right, 2 middle
    mode: number; // 0 click, 1 shift, 2 number key, 3 middle, 4 drop, 5 drag, 6 double
    left: boolean;
    right: boolean;
    middle: boolean;
    shift: boolean;
    outside: boolean;
    item?: ItemInfo; // what we had drawn in that slot
}

export type ClickHandler = (event: ClickEvent) => void;
export type CloseHandler = (chest: Chest) => void;

export interface ChestSpec {
    title?: string; // §-codes honored, ~32 chars fit on screen
    rows?: number; // 1-6, 6 (a double chest) by default
    items?: Record<number, ItemSpec | Slot | null> | Array<ItemSpec | Slot | null>;
    onClick?: ClickHandler;
    onClose?: CloseHandler;
    type?: string; // "minecraft:chest" unless you want a hopper or a dispenser
    size?: number; // container slots, overrides rows for non-chest types
}

export interface Chest {
    readonly id: number;
    readonly rows: number;
    readonly size: number; // player inventory not counted
    readonly title: string;
    isOpen(): boolean;
    set(slot: number, item: ItemSpec | Slot | null): Chest;
    setAll(items: Record<number, ItemSpec | Slot | null> | Array<ItemSpec | Slot | null>): Chest;
    fill(item: ItemSpec | Slot | null, slots?: Iterable<number>): Chest;
    border(item: ItemSpec | Slot | null): Chest; // the outer ring of the chest half
    row(index: number, items: Array<ItemSpec | Slot | null>): Chest;
    clear(): Chest;
    item(slot: number): ItemInfo | undefined;
    setTitle(title: string): Chest; // reopens, a 1.8 client cannot retitle a live window
    setRows(rows: number): Chest; // same
    onClick(handler: ClickHandler | undefined): Chest;
    onClose(handler: CloseHandler | undefined): Chest;
    refresh(): Chest; // redraw the whole thing now
    close(): void;
}

export interface ServerWindow {
    readonly id: number;
    readonly size: number;
    readonly rows: number;
    readonly title: string;
    readonly plain: string;
    items(): Array<ItemInfo | undefined>;
    item(slot: number): ItemInfo | undefined;
    all(): Array<ItemInfo | undefined>;
    find(match: ItemMatcher): number;
    findAll(match: ItemMatcher): number[];
    setItem(slot: number, item: ItemSpec | Slot | null): void;// override hypixels content
    click(slot: number, options?: { button?: number; mode?: number }): boolean; // send click upstream
    close(): boolean; // close upstream
}

export type ItemMatcher = string | RegExp | ((item: ItemInfo | undefined, slot: number) => boolean);

export type ItemRewrite = (
    item: ItemInfo | undefined,
    slot: number,
    window: ServerWindow,
) => ItemSpec | Slot | null | undefined | void;

export interface WindowRewrite {
    title?: string | RegExp | ((window: ServerWindow) => boolean);
    slots?: Iterable<number>;
    items?: ItemRewrite;
    hide?: ItemMatcher;
    rename?: (name: string | undefined, item: ItemInfo | undefined, slot: number) => string | undefined | void;
    lore?: (lore: string[], item: ItemInfo | undefined, slot: number) => string[] | undefined | void;
    once?: boolean;
}

export type ServerWindowListener = (window: ServerWindow) => void;

function clampRows(rows: number | undefined): number {
    return Math.max(1, Math.min(MAX_CHEST_ROWS, Math.floor(rows ?? MAX_CHEST_ROWS)));
}

function escapeRegex(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchesItem(match: ItemMatcher, item: ItemInfo | undefined, slot: number): boolean {
    if (typeof match === "function") return match(item, slot);
    const text = item?.plain ?? "";
    if (match instanceof RegExp) return match.test(text);
    return text.toLowerCase().includes(match.toLowerCase());
}

// clientside chest
class OwnChest implements Chest {
    readonly id: number;
    rows: number;
    size: number;
    title: string;

    private container: Array<Slot | null>;
    private dirty = false;
    private pending?: NodeJS.Immediate;
    private click?: ClickHandler;
    private closed?: CloseHandler;
    private alive = true;
    private type: string;

    constructor(
        private readonly api: WindowApiImpl,
        private readonly injector: WindowInjector,
        id: number,
        spec: ChestSpec,
    ) {
        this.id = id;
        this.rows = clampRows(spec.rows);
        this.type = spec.type ?? CHEST;
        this.size = spec.size ?? this.rows * CHEST_COLUMNS;
        this.title = spec.title ?? "";
        this.container = new Array(this.size).fill(null);
        this.click = spec.onClick;
        this.closed = spec.onClose;
        if (spec.items) this.setAll(spec.items);
        this.injector.open(this.id, { title: this.title, size: this.size, type: this.type }, this.container);
        this.dirty = false;
    }

    isOpen(): boolean {
        return this.alive && this.injector.owns(this.id);
    }

    set(slot: number, item: ItemSpec | Slot | null): Chest {
        if (slot < 0 || slot >= this.size) return this;
        this.container[slot] = item === null ? { ...EMPTY } : toSlot(item);
        this.schedule();
        return this;
    }

    setAll(items: Record<number, ItemSpec | Slot | null> | Array<ItemSpec | Slot | null>): Chest {
        if (Array.isArray(items)) items.forEach((item, slot) => this.set(slot, item ?? null));
        else for (const [key, item] of Object.entries(items)) this.set(Number(key), item ?? null);
        return this;
    }

    fill(item: ItemSpec | Slot | null, slots?: Iterable<number>): Chest {
        const targets = slots ?? range(this.size);
        for (const slot of targets) this.set(slot, item);
        return this;
    }

    border(item: ItemSpec | Slot | null): Chest {
        const last = this.rows - 1;
        for (let row = 0; row < this.rows; row++) {
            for (let column = 0; column < CHEST_COLUMNS; column++) {
                const edge = row === 0 || row === last || column === 0 || column === CHEST_COLUMNS - 1;
                if (edge) this.set(row * CHEST_COLUMNS + column, item);
            }
        }
        return this;
    }

    row(index: number, items: Array<ItemSpec | Slot | null>): Chest {
        const base = index * CHEST_COLUMNS;
        items.slice(0, CHEST_COLUMNS).forEach((item, column) => this.set(base + column, item ?? null));
        return this;
    }

    clear(): Chest {
        this.container = new Array(this.size).fill(null);
        this.schedule();
        return this;
    }

    item(slot: number): ItemInfo | undefined {
        return readItem(this.container[slot] ?? undefined);
    }

    setTitle(title: string): Chest {
        if (title === this.title) return this;
        this.title = title;
        return this.reopen();
    }

    setRows(rows: number): Chest {
        const next = clampRows(rows);
        if (next === this.rows) return this;
        const kept = this.container.slice();
        this.rows = next;
        this.size = next * CHEST_COLUMNS;
        this.container = new Array(this.size).fill(null);
        for (let slot = 0; slot < Math.min(kept.length, this.size); slot++) this.container[slot] = kept[slot];
        return this.reopen();
    }

    onClick(handler: ClickHandler | undefined): Chest {
        this.click = handler;
        return this;
    }

    onClose(handler: CloseHandler | undefined): Chest {
        this.closed = handler;
        return this;
    }

    refresh(): Chest {
        this.flushNow();
        if (this.isOpen()) this.injector.refresh(this.id);
        return this;
    }

    close(): void {
        if (!this.alive) return;
        this.cancel();
        this.alive = false;
        this.injector.close(this.id);
        this.api.forget(this.id);
        this.fireClose();
    }

    // internals
    private reopen(): Chest {
        if (!this.isOpen()) return this;
        this.cancel();
        this.injector.forget(this.id);
        this.injector.open(this.id, { title: this.title, size: this.size, type: this.type }, this.container);
        this.dirty = false;
        return this;
    }

    // close reason
    kill(reason: "client" | "displaced"): void {
        if (!this.alive) return;
        this.cancel();
        this.alive = false;
        if (reason === "client") this.injector.forget(this.id);
        this.fireClose();
    }

    handleClick(data: { slot: number; mouseButton: number; mode: number; action: number }): void {
        this.injector.confirm(this.id, data.action);
        const slot = Number(data.slot);
        const inside = slot >= 0 && slot < this.size;
        const position = slotPosition(slot, this.size);
        const event: ClickEvent = {
            chest: this,
            slot,
            container: inside,
            row: position.row,
            column: position.column,
            button: Number(data.mouseButton),
            mode: Number(data.mode),
            left: Number(data.mouseButton) === 0,
            right: Number(data.mouseButton) === 1,
            middle: Number(data.mouseButton) === 2,
            shift: Number(data.mode) === 1,
            outside: slot === OUTSIDE,
            item: inside ? this.item(slot) : readItem(this.injector.drawn(this.id, slot)),
        };
        try {
            this.click?.(event);
        } catch (error) {
            this.api.fail(error);
        }
        if (this.isOpen()) this.refresh();
    }

    private fireClose(): void {
        try {
            this.closed?.(this);
        } catch (error) {
            this.api.fail(error);
        }
    }

    private schedule(): void {
        this.dirty = true;
        if (this.pending) return;
        this.pending = setImmediate(() => {
            this.pending = undefined;
            this.flushNow();
        });
    }

    private flushNow(): void {
        this.cancel();
        if (!this.dirty || !this.isOpen()) return;
        this.dirty = false;
        try {
            this.injector.write(this.id, this.container);
        } catch (error) {
            this.api.fail(error);
        }
    }

    private cancel(): void {
        if (this.pending) clearImmediate(this.pending);
        this.pending = undefined;
    }
}

function* range(count: number): Generator<number> {
    for (let index = 0; index < count; index++) yield index;
}

// paged menus
export interface MenuEntry {
    item: ItemSpec | Slot;
    onClick?: (event: MenuClick) => void;
    [key: string]: unknown; // hang whatever the caller needs off it
}

export interface MenuClick extends ClickEvent {
    menu: Menu;
    entry?: MenuEntry;
    index?: number;
}

export interface MenuSpec {
    title?: string | ((page: number, pages: number) => string);
    entries?: MenuEntry[] | (() => MenuEntry[]);
    rows?: number; // 6
    slots?: readonly number[]; // where entries go, the 4x7 centre by default
    filler?: ItemSpec | Slot | null; // background filler for the 9x6 area
    fixed?: Record<number, MenuEntry> | (() => Record<number, MenuEntry>);
    onBack?: (() => void) | null; // set it and a back button is drawn at NAV_BACK
    back?: ItemSpec | (() => ItemSpec | null);
    prev?: ItemSpec | (() => ItemSpec | null);
    next?: ItemSpec | (() => ItemSpec | null);
    page?: number;
    onClick?: (event: MenuClick) => void; // clicks that were not an entry or a nav button
    onClose?: CloseHandler;
}

export interface Menu {
    readonly chest: Chest;
    readonly page: number;
    readonly pages: number;
    readonly perPage: number;
    entries(): MenuEntry[];
    setEntries(entries: MenuEntry[] | (() => MenuEntry[])): Menu;
    setTitle(title: string | ((page: number, pages: number) => string)): Menu;
    goto(page: number): Menu;
    next(): Menu;
    prev(): Menu;
    render(): Menu; // redraw, picking up a changed entry list
    close(): void;
}

const DEFAULT_FILLER: ItemSpec = { id: "stained_glass_pane", damage: 15, name: " " }; // default filler item, damage 15 means nbt 15 "black"

function icon(value: ItemSpec | (() => ItemSpec | null) | undefined, fallback: ItemSpec): ItemSpec | null {
    if (value === undefined) return fallback;
    return typeof value === "function" ? value() : value;
}

class PagedMenu implements Menu {
    readonly chest: Chest;
    page = 0;
    perPage: number;

    private list: MenuEntry[] | (() => MenuEntry[]);
    private slots: readonly number[];
    private titleOf: string | ((page: number, pages: number) => string);
    private drawn = new Map<number, MenuEntry>();
    private indexed = new Map<number, number>();

    constructor(
        private readonly api: WindowApiImpl,
        private readonly spec: MenuSpec,
    ) {
        this.list = spec.entries ?? [];
        this.slots = spec.slots ?? CONTENT_SLOTS;
        this.perPage = this.slots.length;
        this.titleOf = spec.title ?? "";
        this.page = Math.max(0, Math.floor(spec.page ?? 0));
        this.chest = api.chest({
            title: this.renderTitle(),
            rows: spec.rows ?? MAX_CHEST_ROWS,
            onClose: spec.onClose,
            onClick: (event) => this.onClick(event),
        });
        this.render();
    }

    entries(): MenuEntry[] {
        return typeof this.list === "function" ? this.list() : this.list;
    }

    get pages(): number {
        return Math.max(1, Math.ceil(this.entries().length / this.perPage));
    }

    setEntries(entries: MenuEntry[] | (() => MenuEntry[])): Menu {
        this.list = entries;
        return this.render();
    }

    setTitle(title: string | ((page: number, pages: number) => string)): Menu {
        this.titleOf = title;
        this.chest.setTitle(this.renderTitle());
        return this;
    }

    goto(page: number): Menu {
        const pages = this.pages;
        this.page = Math.max(0, Math.min(pages - 1, Math.floor(page)));
        return this.render();
    }

    next(): Menu {
        return this.goto(this.page + 1);
    }

    prev(): Menu {
        return this.goto(this.page - 1);
    }

    render(): Menu {
        const entries = this.entries();
        const pages = Math.max(1, Math.ceil(entries.length / this.perPage));
        if (this.page >= pages) this.page = pages - 1;

        this.drawn.clear();
        this.indexed.clear();
        this.chest.clear();

        const filler = this.spec.filler === undefined ? DEFAULT_FILLER : this.spec.filler;
        if (filler) this.chest.fill(filler);

        const start = this.page * this.perPage;
        this.slots.forEach((slot, offset) => {
            const index = start + offset;
            const entry = entries[index];
            if (!entry) {
                this.chest.set(slot, null);
                return;
            }
            this.chest.set(slot, entry.item);
            this.drawn.set(slot, entry);
            this.indexed.set(slot, index);
        });

        const fixed = typeof this.spec.fixed === "function" ? this.spec.fixed() : (this.spec.fixed ?? {});
        for (const [slot, entry] of Object.entries(fixed)) {
            const at = Number(slot);
            this.chest.set(at, entry.item);
            this.drawn.set(at, entry);
        }

        if (this.spec.onBack) {
            const back = icon(this.spec.back, { id: "arrow", name: "§c« Back", lore: ["§8up one level"] });
            if (back) this.chest.set(NAV_BACK, back);
        }
        if (this.page > 0) {
            const prev = icon(this.spec.prev, {
                id: "arrow",
                name: "§e« Previous",
                lore: [`§8page ${this.page} of ${pages}`],
            });
            if (prev) this.chest.set(NAV_PREV, prev);
        }
        if (this.page < pages - 1) {
            const next = icon(this.spec.next, {
                id: "arrow",
                name: "§eNext »",
                lore: [`§8page ${this.page + 2} of ${pages}`],
            });
            if (next) this.chest.set(NAV_NEXT, next);
        }

        this.chest.setTitle(this.renderTitle());
        return this;
    }

    close(): void {
        this.chest.close();
    }

    private renderTitle(): string {
        const pages = Math.max(1, Math.ceil(this.entries().length / this.perPage));
        const base = typeof this.titleOf === "function" ? this.titleOf(this.page, pages) : this.titleOf;
        return pages > 1 ? `${base} §8(${this.page + 1}/${pages})` : base;
    }

    private onClick(event: ClickEvent): void {
        const menuEvent: MenuClick = { ...event, menu: this };
        if (!event.container) {
            this.spec.onClick?.(menuEvent);
            return;
        }
        if (event.slot === NAV_PREV && this.page > 0) {
            this.prev();
            return;
        }
        if (event.slot === NAV_NEXT && this.page < this.pages - 1) {
            this.next();
            return;
        }
        if (event.slot === NAV_BACK && this.spec.onBack) {
            this.spec.onBack();
            return;
        }
        const entry = this.drawn.get(event.slot);
        if (!entry) {
            this.spec.onClick?.(menuEvent);
            return;
        }
        menuEvent.entry = entry;
        menuEvent.index = this.indexed.get(event.slot);
        if (entry.onClick) entry.onClick(menuEvent);
        else this.spec.onClick?.(menuEvent);
    }
}

// hypixel window
class ServerWindowView implements ServerWindow {
    constructor(
        private readonly api: WindowApiImpl,
        private readonly info: ServerWindowInfo,
        readonly title: string,
    ) {}

    get id(): number {
        return this.info.id;
    }

    get size(): number {
        return this.info.size;
    }

    get rows(): number {
        return Math.ceil(this.info.size / CHEST_COLUMNS);
    }

    get plain(): string {
        return stripColorCodes(this.title);
    }

    items(): Array<ItemInfo | undefined> {
        return this.info.slots.slice(0, this.info.size).map((slot) => readItem(slot));
    }

    all(): Array<ItemInfo | undefined> {
        return this.info.slots.map((slot) => readItem(slot));
    }

    item(slot: number): ItemInfo | undefined {
        return readItem(this.info.slots[slot]);
    }

    find(match: ItemMatcher): number {
        return this.items().findIndex((item, slot) => matchesItem(match, item, slot));
    }

    findAll(match: ItemMatcher): number[] {
        const out: number[] = [];
        this.items().forEach((item, slot) => {
            if (matchesItem(match, item, slot)) out.push(slot);
        });
        return out;
    }

    setItem(slot: number, item: ItemSpec | Slot | null): void {
        const next = item === null ? { ...EMPTY } : toSlot(item);
        this.info.slots[slot] = next;
        this.api.host.sendPacket("set_slot", { windowId: this.info.id, slot, item: next });
    }

    click(slot: number, options: { button?: number; mode?: number } = {}): boolean {
        const send = this.api.host.sendServerPacket;
        if (!send) return false;
        send("window_click", {
            windowId: this.info.id,
            slot,
            mouseButton: options.button ?? 0,
            action: this.api.nextAction(),
            mode: options.mode ?? 0,
            item: this.info.slots[slot] ?? { ...EMPTY },
        });
        return true;
    }

    close(): boolean {
        const send = this.api.host.sendServerPacket;
        if (!send) return false;
        send("close_window", { windowId: this.info.id });
        return true;
    }
}

// api interface
export interface WindowApi {
    handleServerPacket(name: string, data: any): boolean;
    handleClientPacket(name: string, data: any): boolean;
    dispose(): void;

    chest(spec: ChestSpec): Chest;
    menu(spec: MenuSpec): Menu;
    current(): Chest | undefined;
    closeAll(): void;

    server(): ServerWindow | undefined;
    rewrite(rule: WindowRewrite): () => void;
    onServerWindow(listener: ServerWindowListener): () => void;

    readonly injector: WindowInjector;
}

class WindowApiImpl implements WindowApi {
    readonly injector: WindowInjector;
    private chests = new Map<number, OwnChest>();
    private rules: WindowRewrite[] = [];
    private listeners = new Set<ServerWindowListener>();
    private action = 1;
    private pendingRewrite = new Set<number>();

    constructor(
        readonly host: WindowHost,
        private readonly options: WindowApiOptions = {},
    ) {
        this.injector = new WindowInjector((name, data) => host.sendPacket(name, data));
    }

    nextAction(): number {
        this.action = (this.action + 1) % 30000;
        return this.action;
    }

    fail(error: unknown): void {
        this.options.onError?.(error);
    }

    forget(id: number): void {
        this.chests.delete(id);
    }

    // cleanup mostly

    handleServerPacket(name: string, data: any): boolean {
        try {
            switch (name) {
                case "open_window":
                    // replace ours if hypixel sends anything
                    this.displace();
                    this.injector.applyServerOpen(data);
                    this.queueRewrite(data.windowId);
                    this.announce(data.windowId);
                    return true;
                case "window_items":
                    this.injector.applyServerItems(data);
                    if (data.windowId !== PLAYER_WINDOW) {
                        this.queueRewrite(data.windowId);
                        this.announce(data.windowId);
                    } else {
                        for (const chest of this.chests.values()) chest.refresh();
                    }
                    return true;
                case "set_slot":
                    this.injector.applyServerSetSlot(data);
                    if (data.windowId !== PLAYER_WINDOW) this.queueRewrite(data.windowId);
                    return true;
                case "close_window":
                    for (const id of this.injector.applyServerClose(data.windowId)) {
                        this.chests.get(id)?.kill("displaced");
                        this.chests.delete(id);
                    }
                    return true;
                case "login":
                    this.closeAll();
                    return true;
                default:
                    return false;
            }
        } catch (error) {
            this.fail(error);
            return true;
        }
    }

    // true means it was for a window of ours and must not get sent to hypixel
    handleClientPacket(name: string, data: any): boolean {
        try {
            switch (name) {
                case "window_click": {
                    const chest = this.chests.get(Number(data.windowId));
                    if (!chest) return false;
                    chest.handleClick(data);
                    return true;
                }
                case "close_window": {
                    const id = Number(data.windowId);
                    const chest = this.chests.get(id);
                    if (!chest) return false;
                    this.chests.delete(id);
                    chest.kill("client");
                    return true;
                }
                case "transaction": {
                    return this.injector.owns(Number(data.windowId));
                }
                default:
                    return false;
            }
        } catch (error) {
            this.fail(error);
            return false;
        }
    }

    dispose(): void {
        this.closeAll();
        this.rules = [];
        this.listeners.clear();
    }

    // our chests
    chest(spec: ChestSpec): Chest {
        const id = this.injector.allocate();
        if (id === undefined) throw new Error("no free window id, close a window of yours first");
        if (this.options.closeServerWindows !== false) this.closeServerWindows();
        const chest = new OwnChest(this, this.injector, id, spec);
        this.chests.set(id, chest);
        return chest;
    }

    menu(spec: MenuSpec): Menu {
        return new PagedMenu(this, spec);
    }

    current(): Chest | undefined {
        let latest: OwnChest | undefined;
        for (const chest of this.chests.values()) if (chest.isOpen()) latest = chest;
        return latest;
    }

    closeAll(): void {
        for (const chest of [...this.chests.values()]) chest.close();
        this.chests.clear();
    }

    private displace(): void {
        for (const id of this.injector.displaced()) {
            this.chests.get(id)?.kill("displaced");
            this.chests.delete(id);
        }
    }

    private closeServerWindows(): void {
        const send = this.host.sendServerPacket;
        if (!send) return;
        for (const id of this.injector.openServerIds()) {
            if (id === PLAYER_WINDOW) continue;
            send("close_window", { windowId: id });
            this.injector.forgetServer(id);
        }
    }

    // hypixel chests
    server(): ServerWindow | undefined {
        const ids = this.injector.openServerIds().filter((id) => id !== PLAYER_WINDOW);
        const id = ids[ids.length - 1];
        if (id === undefined) return undefined;
        return this.view(id);
    }

    rewrite(rule: WindowRewrite): () => void {
        this.rules.push(rule);
        for (const id of this.injector.openServerIds()) this.queueRewrite(id);
        return () => {
            const index = this.rules.indexOf(rule);
            if (index >= 0) this.rules.splice(index, 1);
        };
    }

    onServerWindow(listener: ServerWindowListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private view(id: number): ServerWindowView | undefined {
        const info = this.injector.serverWindow(id);
        if (!info) return undefined;
        return new ServerWindowView(this, info, componentToLegacy(this.options.version ?? "1.8.9", info.title));
    }

    private announce(id: number): void {
        if (!this.listeners.size) return;
        const window = this.view(id);
        if (!window) return;
        for (const listener of this.listeners) {
            try {
                listener(window);
            } catch (error) {
                this.fail(error);
            }
        }
    }

    private queueRewrite(id: number): void {
        if (id === PLAYER_WINDOW || !this.rules.length) return;
        if (this.pendingRewrite.has(id)) return;
        this.pendingRewrite.add(id);
        const timer = setImmediate(() => {
            this.pendingRewrite.delete(id);
            try {
                this.applyRewrites(id);
            } catch (error) {
                this.fail(error);
            }
        });
        timer.unref?.();
    }

    private applyRewrites(id: number): void {
        const window = this.view(id);
        if (!window) return;
        const spent: WindowRewrite[] = [];

        for (const rule of this.rules) {
            if (!this.applies(rule, window)) continue;
            const slots = rule.slots ? [...rule.slots] : [...Array(window.size).keys()];
            let hit = false;

            for (const slot of slots) {
                if (slot < 0 || slot >= window.size) continue;
                const item = window.item(slot);

                if (rule.hide && matchesItem(rule.hide, item, slot)) {
                    window.setItem(slot, null);
                    hit = true;
                    continue;
                }

                let replacement: ItemSpec | Slot | null | undefined;
                if (rule.items) replacement = rule.items(item, slot, window) as typeof replacement;

                if (replacement === null) {
                    window.setItem(slot, null);
                    hit = true;
                    continue;
                }
                if (replacement !== undefined) {
                    window.setItem(slot, replacement);
                    hit = true;
                    continue;
                }

                if (!item || (!rule.rename && !rule.lore)) continue;
                const name = rule.rename ? (rule.rename(item.name, item, slot) as string | undefined) : undefined;
                const lore = rule.lore ? (rule.lore(item.lore, item, slot) as string[] | undefined) : undefined;
                if (name === undefined && lore === undefined) continue;
                window.setItem(slot, {
                    id: item.id,
                    count: item.count,
                    damage: item.damage,
                    name: name ?? item.name,
                    lore: lore ?? item.lore,
                });
                hit = true;
            }

            if (hit && rule.once) spent.push(rule);
        }

        for (const rule of spent) {
            const index = this.rules.indexOf(rule);
            if (index >= 0) this.rules.splice(index, 1);
        }
    }

    private applies(rule: WindowRewrite, window: ServerWindow): boolean {
        const { title } = rule;
        if (title === undefined) return true;
        if (typeof title === "function") return title(window);
        if (title instanceof RegExp) return title.test(window.plain);
        return window.plain.toLowerCase().includes(title.toLowerCase());
    }
}

export function createWindowApi(host: WindowHost, options?: WindowApiOptions): WindowApi {
    return new WindowApiImpl(host, options);
}

export function exactTitle(title: string): RegExp {
    return new RegExp(`^${escapeRegex(title)}$`, "i");
}
