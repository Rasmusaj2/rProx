// inventory / window injector core
//
// used to put up an inventory interface on the players screen clientside, or to modify hypixels chests and menus
import { stripColorCodes } from "../util/mcColors";

export const CHEST_COLUMNS = 9;
export const MAX_CHEST_ROWS = 6;
export const PLAYER_SLOTS = 36;
export const OUTSIDE = -999;

export const PLAYER_WINDOW = 0;
const PLAYER_INVENTORY_FIRST = 9;
const PLAYER_HOTBAR_FIRST = 36;

const OUR_FIRST = 101;
const OUR_LAST = 120;

export const CHEST = "minecraft:chest";

export type Send = (name: string, data: unknown) => void;

// prismarine slot. blockId -1 is an empty slot and carries nothing else
export interface Slot {
    blockId: number;
    itemCount?: number;
    itemDamage?: number;
    nbtData?: unknown;
}

export const EMPTY: Slot = { blockId: -1 };

// what a caller asks for, before it becomes a Slot
export interface ItemSpec {
    id?: number | string; // 351, "ink_sack" or "minecraft:ink_sack"
    count?: number; // 1
    damage?: number; // data value / metadata (ie recoloring wool, durability on tools)
    name?: string; // display name, §-codes honored
    lore?: string | string[]; // a string is split on newlines
    glow?: boolean; // should show enchant glimmer without enchants
    hideFlags?: number; // 63 hides every tooltip extra, on by default when glowing
    nbt?: Record<string, unknown>; // extra nbt tags
}

export interface ItemInfo {
    id: number;
    count: number;
    damage: number;
    name?: string; // display name with §-codes
    plain?: string; // display name with the colors stripped
    lore: string[];
    slot: Slot;
}

// STATIC DATA FOR COMMON INFO
// useful items to put into a chest or gui
export const ITEM_IDS: Record<string, number> = {
    air: 0,
    stone: 1,
    grass: 2,
    dirt: 3,
    cobblestone: 4,
    planks: 5,
    bedrock: 7,
    sand: 12,
    log: 17,
    leaves: 18,
    sponge: 19,
    glass: 20,
    lapis_block: 22,
    dispenser: 23,
    sandstone: 24,
    noteblock: 25,
    web: 30,
    wool: 35,
    gold_block: 41,
    iron_block: 42,
    brick_block: 45,
    tnt: 46,
    bookshelf: 47,
    obsidian: 49,
    torch: 50,
    chest: 54,
    workbench: 58,
    furnace: 61,
    ladder: 65,
    lever: 69,
    ice: 79,
    snow_block: 80,
    clay: 82,
    pumpkin: 86,
    netherrack: 87,
    soul_sand: 88,
    glowstone: 89,
    lit_pumpkin: 91,
    stained_glass: 95,
    iron_bars: 101,
    glass_pane: 102,
    melon_block: 103,
    vine: 106,
    mycelium: 110,
    nether_brick: 112,
    enchanting_table: 116,
    end_stone: 121,
    redstone_lamp: 123,
    emerald_block: 133,
    command_block: 137,
    beacon: 138,
    anvil: 145,
    trapped_chest: 146,
    ender_chest: 130,
    daylight_detector: 151,
    redstone_block: 152,
    hopper: 154,
    quartz_block: 155,
    stained_glass_pane: 160,
    slime_block: 165,
    barrier: 166,
    prismarine: 168,
    sea_lantern: 169,
    hay_block: 170,
    carpet: 171,
    coal_block: 173,
    packed_ice: 174,
    flint_and_steel: 259,
    apple: 260,
    bow: 261,
    arrow: 262,
    coal: 263,
    diamond: 264,
    iron_ingot: 265,
    gold_ingot: 266,
    iron_sword: 267,
    diamond_sword: 276,
    diamond_pickaxe: 278,
    string: 287,
    feather: 288,
    gunpowder: 289,
    bread: 297,
    flint: 318,
    painting: 321,
    golden_apple: 322,
    sign: 323,
    bucket: 325,
    water_bucket: 326,
    lava_bucket: 327,
    minecart: 328,
    saddle: 329,
    redstone: 331,
    snowball: 332,
    boat: 333,
    milk_bucket: 335,
    paper: 339,
    book: 340,
    slime_ball: 341,
    egg: 344,
    compass: 345,
    fishing_rod: 346,
    clock: 347,
    glowstone_dust: 348,
    dye: 351,
    ink_sack: 351, // same item, "dye" is the friendlier name
    bone: 352,
    sugar: 353,
    cake: 354,
    bed: 355,
    repeater: 356,
    cookie: 357,
    map: 358,
    shears: 359,
    melon: 360,
    rotten_flesh: 367,
    ender_pearl: 368,
    blaze_rod: 369,
    ghast_tear: 370,
    nether_wart: 372,
    potion: 373,
    glass_bottle: 374,
    spider_eye: 375,
    magma_cream: 378,
    brewing_stand: 379,
    cauldron: 380,
    ender_eye: 381,
    experience_bottle: 384,
    writable_book: 386,
    written_book: 387,
    emerald: 388,
    item_frame: 389,
    empty_map: 395,
    skull: 397,
    nether_star: 399,
    comparator: 404,
    quartz: 406,
    prismarine_shard: 409,
    prismarine_crystals: 410,
    lead: 420,
    name_tag: 421,
    armor_stand: 416,
    record_13: 2256,
};


// dye data values
export const DYE: Record<string, number> = {
    black: 0,
    red: 1,
    green: 2,
    brown: 3,
    blue: 4,
    purple: 5,
    cyan: 6,
    light_gray: 7,
    gray: 8,
    pink: 9,
    lime: 10,
    yellow: 11,
    light_blue: 12,
    magenta: 13,
    orange: 14,
    white: 15,
};

// wool, carpet, stained glass and panes all share these
// do not ask why these have different damage values than dyes idfk
export const WOOL: Record<string, number> = {
    white: 0,
    orange: 1,
    magenta: 2,
    light_blue: 3,
    yellow: 4,
    lime: 5,
    pink: 6,
    gray: 7,
    light_gray: 8,
    cyan: 9,
    purple: 10,
    blue: 11,
    brown: 12,
    green: 13,
    red: 14,
    black: 15,
};

export function itemId(id: number | string | undefined): number {
    if (typeof id === "number") return id;
    if (!id) return ITEM_IDS.stone;
    const key = id.replace(/^minecraft:/, "").toLowerCase();
    const hit = ITEM_IDS[key];
    if (hit !== undefined) return hit;
    const numeric = Number(key);
    return Number.isFinite(numeric) ? numeric : ITEM_IDS.stone;
}

// nbt bullshit
export type NbtTag = { type: string; name?: string; value: unknown };

export function nbtString(value: string): NbtTag {
    return { type: "string", value };
}

export function nbtByte(value: number): NbtTag {
    return { type: "byte", value };
}

export function nbtShort(value: number): NbtTag {
    return { type: "short", value };
}

export function nbtInt(value: number): NbtTag {
    return { type: "int", value };
}

export function nbtStringList(values: string[]): NbtTag {
    return { type: "list", value: { type: "string", value: values } };
}

export function nbtCompound(value: Record<string, unknown>, name?: string): NbtTag {
    return name === undefined ? { type: "compound", value } : { type: "compound", name, value };
}

// unwrap until there is a plain javascript value left
export function unwrapNbt(node: unknown): unknown {
    let current = node;
    while (
        current &&
        typeof current === "object" &&
        !Array.isArray(current) &&
        "type" in (current as object) &&
        "value" in (current as object)
    ) {
        current = (current as NbtTag).value;
    }
    return current;
}

function loreLines(lore: string | string[] | undefined): string[] | undefined {
    if (lore === undefined) return undefined;
    const lines = Array.isArray(lore) ? lore : lore.split("\n");
    return lines.map((line) => String(line));
}

// an enchantment list with a level the client never draws, which is all it takes
// to get the shimmer. HideFlags 1 keeps the enchantment itself off the tooltip
const GLOW = { type: "list", value: { type: "compound", value: [{ id: nbtShort(0), lvl: nbtShort(1) }] } };

export function toSlot(spec: ItemSpec | Slot | null | undefined): Slot {
    if (!spec) return { ...EMPTY };
    // already a slot, hand it straight back
    if ("blockId" in spec) return spec as Slot;

    const id = itemId(spec.id);
    if (id <= 0) return { ...EMPTY };

    const display: Record<string, unknown> = {};
    if (spec.name !== undefined) display.Name = nbtString(spec.name);
    const lore = loreLines(spec.lore);
    if (lore) display.Lore = nbtStringList(lore);

    const tags: Record<string, unknown> = {};
    if (Object.keys(display).length) tags.display = nbtCompound(display);
    if (spec.glow) tags.ench = GLOW;
    const flags = spec.hideFlags ?? (spec.glow ? 1 : undefined);
    if (flags !== undefined) tags.HideFlags = nbtInt(flags);
    if (spec.nbt) Object.assign(tags, spec.nbt);

    const slot: Slot = {
        blockId: id,
        itemCount: Math.max(0, Math.min(127, Math.round(spec.count ?? 1))),
        itemDamage: Math.round(spec.damage ?? 0),
    };
    if (Object.keys(tags).length) slot.nbtData = nbtCompound(tags, "");
    return slot;
}

// read a slot back out - name, lore and all - for looking at hypixels items
export function readItem(slot: Slot | null | undefined): ItemInfo | undefined {
    if (!slot || slot.blockId === undefined || slot.blockId < 0) return undefined;
    const root = unwrapNbt(slot.nbtData);
    const display = isBlock(root) ? unwrapNbt(root.display) : undefined;
    const name = isBlock(display) ? unwrapNbt(display.Name) : undefined;
    const rawLore = isBlock(display) ? unwrapNbt(display.Lore) : undefined;
    const lore = Array.isArray(rawLore)
        ? rawLore.map((line) => unwrapNbt(line)).filter((line): line is string => typeof line === "string")
        : [];
    return {
        id: slot.blockId,
        count: slot.itemCount ?? 1,
        damage: slot.itemDamage ?? 0,
        name: typeof name === "string" ? name : undefined,
        plain: typeof name === "string" ? stripColorCodes(name) : undefined,
        lore,
        slot,
    };
}

function isBlock(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

// two slots the client would draw identically
export function sameSlot(a: Slot | null | undefined, b: Slot | null | undefined): boolean {
    const left = a ?? EMPTY;
    const right = b ?? EMPTY;
    if (left.blockId !== right.blockId) return false;
    if (left.blockId < 0) return true;
    return (
        (left.itemCount ?? 1) === (right.itemCount ?? 1) &&
        (left.itemDamage ?? 0) === (right.itemDamage ?? 0) &&
        JSON.stringify(left.nbtData ?? null) === JSON.stringify(right.nbtData ?? null)
    );
}


export interface OwnWindowSpec {
    title: string; // legacy §-string, wrapped into a chat component on the way out
    size: number; // container slots only, 54 for a double chest
    type?: string; // inventory type, "minecraft:chest" unless you want a hopper
    entityId?: number; // only EntityHorse wants one
}

interface OwnWindow extends OwnWindowSpec {
    id: number;
    slots: Slot[]; // size + PLAYER_SLOTS, exactly what the client is holding
    container: Slot[]; // the container half as the owner set it, ours to redraw from
}

export interface ServerWindowInfo {
    id: number;
    type: string;
    title: string; // the raw windowTitle string hypixel sent, json or not
    size: number;
    slots: Array<Slot | null>;
}

export class WindowInjector {
    private ours = new Map<number, OwnWindow>();
    private server = new Map<number, ServerWindowInfo>();
    private player: Array<Slot | null> = new Array(45).fill(null); // window 0
    private cursor = OUR_LAST; // where the id pool last stopped

    constructor(private readonly send: Send) {}

    // mirror hypixels windows

    applyServerOpen(data: { windowId: number; inventoryType?: string; windowTitle?: string; slotCount?: number }): void {
        const size = Math.max(0, Number(data.slotCount ?? 0));
        this.server.set(data.windowId, {
            id: data.windowId,
            type: String(data.inventoryType ?? CHEST),
            title: String(data.windowTitle ?? ""),
            size,
            slots: new Array(size + PLAYER_SLOTS).fill(null),
        });
    }

    applyServerItems(data: { windowId: number; items?: Array<Slot | null> }): void {
        const items = data.items ?? [];
        if (data.windowId === PLAYER_WINDOW) {
            this.player = items.slice();
            return;
        }
        const window = this.server.get(data.windowId);
        if (!window) return;
        window.slots = items.slice();
    }

    applyServerSetSlot(data: { windowId: number; slot: number; item?: Slot | null }): void {
        const { slot } = data;
        if (slot < 0) return; // the cursor stack, nothing we mirror
        if (data.windowId === PLAYER_WINDOW) {
            this.player[slot] = data.item ?? null;
            return;
        }
        const window = this.server.get(data.windowId);
        if (!window || slot >= window.slots.length) return;
        window.slots[slot] = data.item ?? null;
    }

    // clientbound close
    applyServerClose(windowId: number): number[] {
        this.server.delete(windowId);
        return this.forgetAllOurs();
    }

    // we told hypixel to close one of theirs, so stop mirroring it
    forgetServer(windowId: number): void {
        this.server.delete(windowId);
    }

    // hypixel opening something of its own puts its screen over ours
    displaced(): number[] {
        return this.forgetAllOurs();
    }

    private forgetAllOurs(): number[] {
        const ids = [...this.ours.keys()];
        this.ours.clear();
        return ids;
    }

    serverWindow(id: number): ServerWindowInfo | undefined {
        return this.server.get(id);
    }

    openServerIds(): number[] {
        return [...this.server.keys()];
    }

    // window 0 as the client is holding it, so a window of ours can draw the
    // real inventory under it instead of 36 empty slots
    playerSlots(): Array<Slot | null> {
        return this.player;
    }

    // the 36 slots a container window appends, in container order
    playerTail(): Slot[] {
        const tail: Slot[] = [];
        for (let i = 0; i < 27; i++) tail.push(this.player[PLAYER_INVENTORY_FIRST + i] ?? { ...EMPTY });
        for (let i = 0; i < 9; i++) tail.push(this.player[PLAYER_HOTBAR_FIRST + i] ?? { ...EMPTY });
        return tail;
    }

    // our windows
    allocate(): number | undefined {
        for (let step = 0; step < OUR_LAST - OUR_FIRST + 1; step++) {
            this.cursor = this.cursor >= OUR_LAST ? OUR_FIRST : this.cursor + 1;
            if (!this.ours.has(this.cursor) && !this.server.has(this.cursor)) return this.cursor;
        }
        return undefined;
    }

    owns(id: number): boolean {
        return this.ours.has(id);
    }

    ownIds(): number[] {
        return [...this.ours.keys()];
    }

    sizeOf(id: number): number | undefined {
        return this.ours.get(id)?.size;
    }

    // open a window of ours at the client. container is the chest half, the
    // player inventory underneath is filled in from window 0
    open(id: number, spec: OwnWindowSpec, container: Array<Slot | null>): void {
        const window: OwnWindow = {
            ...spec,
            id,
            type: spec.type ?? CHEST,
            slots: [],
            container: new Array(spec.size).fill(null).map((_, index) => container[index] ?? { ...EMPTY }),
        };
        this.ours.set(id, window);
        this.send("open_window", {
            windowId: id,
            inventoryType: window.type,
            windowTitle: titleComponent(window.title),
            slotCount: window.size,
            ...(spec.entityId !== undefined ? { entityId: spec.entityId } : {}),
        });
        this.refresh(id);
    }

    // the whole window in one packet. cheap, and the only thing that reliably
    // undoes a shift-click the client already applied to its own copy
    refresh(id: number): void {
        const window = this.ours.get(id);
        if (!window) return;
        window.slots = window.container.concat(this.playerTail());
        this.send("window_items", { windowId: id, items: window.slots });
        this.clearCursor();
    }

    // set the container half and send only the slots that actually changed
    write(id: number, container: Array<Slot | null>): void {
        const window = this.ours.get(id);
        if (!window) return;
        for (let slot = 0; slot < window.size; slot++) {
            const next = container[slot] ?? { ...EMPTY };
            if (sameSlot(window.container[slot], next)) continue;
            window.container[slot] = next;
            window.slots[slot] = next;
            this.send("set_slot", { windowId: id, slot, item: next });
        }
    }

    // what we last drew in a slot of ours, container or player half
    drawn(id: number, slot: number): Slot | undefined {
        const window = this.ours.get(id);
        if (!window || slot < 0) return undefined;
        return window.slots[slot];
    }

    // 1.8 applies a click optimistically and waits for this. without it the
    // client eventually decides it is out of sync and starts resending
    confirm(windowId: number, action: number): void {
        this.send("transaction", { windowId, action, accepted: true });
    }

    // windowId -1 slot -1 is the stack on the cursor. emptying it is how you undo
    // a pickup the client already drew
    clearCursor(): void {
        this.send("set_slot", { windowId: -1, slot: -1, item: { ...EMPTY } });
    }

    // close a window of ours at the client
    close(id: number): boolean {
        if (!this.ours.delete(id)) return false;
        this.send("close_window", { windowId: id });
        return true;
    }

    // the client told us it closed one of ours, nothing to send back
    forget(id: number): boolean {
        return this.ours.delete(id);
    }
}

// 1.8 wants the window title as a chat component, and hypixel sends json here
// too. a legacy §-string goes in as a plain text component
export function titleComponent(title: string): string {
    if (title.startsWith("{") || title.startsWith("[")) return title;
    return JSON.stringify({ text: title });
}

// container slot -> row/column inside a chest, or -1/-1 for the player half
export function slotPosition(slot: number, size: number): { row: number; column: number } {
    if (slot < 0 || slot >= size) return { row: -1, column: -1 };
    return { row: Math.floor(slot / CHEST_COLUMNS), column: slot % CHEST_COLUMNS };
}
