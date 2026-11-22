// customizable Bedwars Diamond Shop (Upgrades & Traps) using the window/chest API
import { saveConfig } from "../../config";
import { PREFIX } from "../../core/chat";
import type { PluginApi, Session } from "../../core/types";
import {
    CHEST_COLUMNS,
    DYE,
    ITEM_IDS,
    MAX_CHEST_ROWS,
    WOOL,
    type Chest,
    type ClickEvent,
    type ItemInfo,
    type ItemSpec,
    type Menu,
    type MenuEntry,
    type ServerWindow,
    type Slot,
} from "../../interface/windowApi";

export interface DiamondShopConfig {
    enabled?: boolean;
    rows?: number;
    title?: string;
    filler?: string;
    showEditButton?: boolean;
    showUnmapped?: boolean;
    layout?: Record<string, string>;
}

interface ShopCatalogItem {
    key: string;
    label: string;
    category: "Upgrade" | "Trap" | "Queue";
    description: string;
    icon: ItemSpec;
    match: RegExp;
}

const DIAMOND_SHOP_TITLE = /^(?:Upgrades\s*&\s*Traps|Team\s+Upgrades)$/i;

const SHOP_ITEMS: readonly ShopCatalogItem[] = [
    {
        key: "sharpness",
        label: "Sharpened Swords",
        category: "Upgrade",
        description: "Permanent Sharpness I on all swords.",
        icon: { id: "iron_sword" },
        match: /^Sharpened Swords?\b/i,
    },
    {
        key: "protection",
        label: "Reinforced Armor",
        category: "Upgrade",
        description: "Permanent Protection I-IV on all armor.",
        icon: { id: "iron_chestplate" },
        match: /^Reinforced Armor\b/i,
    },
    {
        key: "haste",
        label: "Maniac Miner",
        category: "Upgrade",
        description: "Permanent Haste I-II for your team.",
        icon: { id: "golden_pickaxe" },
        match: /^Maniac Miner\b/i,
    },
    {
        key: "forge",
        label: "Forge",
        category: "Upgrade",
        description: "Iron, Golden, Emerald & Molten Forge.",
        icon: { id: "furnace" },
        match: /^(?:Iron|Golden|Emerald|Molten) Forge\b/i,
    },
    {
        key: "heal_pool",
        label: "Heal Pool",
        category: "Upgrade",
        description: "Regeneration field around your base.",
        icon: { id: "beacon" },
        match: /^Heal Pool\b/i,
    },
    {
        key: "feather_falling",
        label: "Cushioned Boots",
        category: "Upgrade",
        description: "Permanent Feather Falling I-II for your team.",
        icon: { id: "diamond_boots" },
        match: /^Cushioned Boots\b/i,
    },
    {
        key: "trap_blindness",
        label: "Blindness Trap",
        category: "Trap",
        description: "Inflicts Blindness and Slowness for 8 seconds.",
        icon: { id: "tripwire_hook" },
        match: /^Blindness Trap?/i,
    },
    {
        key: "trap_counter",
        label: "Counter-Offensive Trap",
        category: "Trap",
        description: "Grants Speed II and Jump Boost II for 15 seconds.",
        icon: { id: "feather" },
        match: /^Counter-Offensive Trap\b/i,
    },
    {
        key: "trap_reveal",
        label: "Reveal Trap",
        category: "Trap",
        description: "Reveals invisible enemies entering base.",
        icon: { id: "redstone_torch" },
        match: /^Reveal Trap\b/i,
    },
    {
        key: "trap_fatigue",
        label: "Miner Fatigue Trap",
        category: "Trap",
        description: "Inflicts Mining Fatigue on enemies for 8 seconds.",
        icon: { id: "iron_pickaxe" },
        match: /^Miner Fatigue Trap\b/i,
    },
    {
        key: "queue_1",
        label: "Trap #1",
        category: "Queue",
        description: "Displays the first queued trap.",
        icon: { id: "stained_glass", damage: WOOL.light_gray },
        match: /^Trap #1\b/i,
    },
    {
        key: "queue_2",
        label: "Trap #2",
        category: "Queue",
        description: "Displays the second queued trap.",
        icon: { id: "stained_glass", damage: WOOL.light_gray },
        match: /^Trap #2\b/i,
    },
    {
        key: "queue_3",
        label: "Trap #3",
        category: "Queue",
        description: "Displays the third queued trap.",
        icon: { id: "stained_glass", damage: WOOL.light_gray },
        match: /^Trap #3\b/i,
    },
];

const CATALOG_BY_KEY = new Map<string, ShopCatalogItem>(SHOP_ITEMS.map((entry) => [entry.key, entry]));

const FILLER_CHOICES = [
    "gray",
    "black",
    "light_gray",
    "blue",
    "light_blue",
    "cyan",
    "purple",
    "red",
    "lime",
    "white",
    "none",
] as const;

// layout is intentionally omitted from DIAMOND_SHOP_DEFAULTS it doesnt autofill again on startup, only when missing entirely
// otherwise weird things ahppen on restarts
export const DIAMOND_SHOP_DEFAULTS: Omit<Required<DiamondShopConfig>, "layout"> = {
    enabled: true,
    rows: 5,
    title: "§bTeam Upgrades",
    filler: "gray",
    showEditButton: true,
    showUnmapped: true,
};

interface LiveShopState {
    serverId: number;
    chest: Chest;
    slotMap: Map<number, number>; // custom slot to real slot map
    editSlot?: number;
    closingFromServer?: boolean;
}

interface EditorState {
    chest?: Chest;
    menu?: Menu;
    selectedSlot?: number;
    switching?: boolean;
}

interface SessionState {
    unsubWindow: () => void;
    unsubClose: () => void;
    live?: LiveShopState;
    editor: EditorState;
}

function clampRows(rows: unknown): number {
    const num = Number(rows);
    if (!Number.isFinite(num)) return DIAMOND_SHOP_DEFAULTS.rows;
    return Math.max(1, Math.min(MAX_CHEST_ROWS, Math.floor(num)));
}

function fillerName(raw: unknown): string {
    const value = String(raw ?? DIAMOND_SHOP_DEFAULTS.filler).trim().toLowerCase();
    if (value === "none" || value === "off" || value === "empty") return "none";
    return value in WOOL ? value : DIAMOND_SHOP_DEFAULTS.filler;
}

function fillerItem(filler: string): ItemSpec | null {
    if (filler === "none") return null;
    const damage = WOOL[filler] ?? WOOL.gray;
    return { id: "stained_glass_pane", damage, name: " " };
}

function editorEmptyItem(filler: string, slot: number, selectedLabel?: string): ItemSpec {
    const damage = filler === "none" ? WOOL.light_gray : (WOOL[filler] ?? WOOL.gray);
    return {
        id: filler === "none" ? "glass_pane" : "stained_glass_pane",
        damage,
        name: `§8Empty Slot §7(#${slot})`,
        lore: selectedLabel
            ? [`§aClick §7to move §f${selectedLabel} §7here`]
            : ["§eClick §7to place an item here"],
    };
}

function matchCatalogItem(item: ItemInfo | undefined): ShopCatalogItem | undefined {
    const plain = item?.plain?.trim();
    if (!plain) return undefined;
    for (const entry of SHOP_ITEMS) {
        if (entry.match.test(plain)) return entry;
    }
    return undefined;
}

function isDecorativeGlass(item: ItemInfo): boolean {
    if (item.id !== ITEM_IDS.stained_glass_pane) return false;
    const plain = item.plain?.trim() ?? "";
    return plain === "" || plain === " ";
}

function categoryColor(category: ShopCatalogItem["category"]): string {
    if (category === "Upgrade") return "§b";
    if (category === "Trap") return "§e";
    return "§7";
}

function preferredFreeSlots(size: number, occupied: Set<number>): number[] {
    const rows = Math.floor(size / CHEST_COLUMNS);
    const inner: number[] = [];
    const outer: number[] = [];
    for (let slot = 0; slot < size; slot++) {
        if (occupied.has(slot)) continue;
        const row = Math.floor(slot / CHEST_COLUMNS);
        const col = slot % CHEST_COLUMNS;
        const isInner = rows >= 3 && row > 0 && row < rows - 1 && col > 0 && col < CHEST_COLUMNS - 1;
        if (isInner) inner.push(slot);
        else outer.push(slot);
    }
    return [...inner, ...outer];
}

function pickEditButtonSlot(size: number, occupied: Set<number>): number | undefined {
    const lastRowStart = size - CHEST_COLUMNS;
    for (let slot = size - 1; slot >= Math.max(0, lastRowStart); slot--) {
        if (!occupied.has(slot)) return slot;
    }
    return undefined;
}

export function registerDiamondShop(api: PluginApi): void {
    const rawBlock = api.pluginConfig.diamondShop;
    const config: DiamondShopConfig =
        rawBlock && typeof rawBlock === "object" && !Array.isArray(rawBlock)
            ? (rawBlock as DiamondShopConfig)
            : {};
    api.pluginConfig.diamondShop = config;

    const ensureLayout = (): Record<string, string> => {
        if (!config.layout || typeof config.layout !== "object" || Array.isArray(config.layout)) {
            config.layout = {};
        }
        return config.layout;
    };

    const persist = (): void => {
        try {
            saveConfig(api.config);
        } catch (error) {
            api.log.warn(`diamondShop could not save config: ${error}`);
        }
    };

    const sessions = new Map<string, SessionState>();

    const isDiamondShopWindow = (session: Session, win: ServerWindow): boolean => {
        if (config.enabled === false) return false;
        if (session.game !== "bedwars" && session.game !== "unknown") return false;
        return DIAMOND_SHOP_TITLE.test(win.plain.trim());
    };

    const closeLive = (state: SessionState, closeServer: boolean): void => {
        const live = state.live;
        if (!live) return;
        state.live = undefined;
        live.closingFromServer = !closeServer;
        if (live.chest.isOpen()) live.chest.close();
    };

    // render live Hypixel items into the player's custom Diamond Shop chest
    const renderLiveShop = (session: Session, state: SessionState, win: ServerWindow): void => {
        const live = state.live;
        if (!live || !live.chest.isOpen()) return;

        const rows = clampRows(config.rows);
        const size = rows * CHEST_COLUMNS;
        if (live.chest.rows !== rows) live.chest.setRows(rows);

        const title = String(config.title || DIAMOND_SHOP_DEFAULTS.title);
        if (live.chest.title !== title) live.chest.setTitle(title);

        const serverItems = win.items();
        const realByKey = new Map<string, { slot: number; raw: Slot; info: ItemInfo }>();
        const unmapped: Array<{ slot: number; raw: Slot; info: ItemInfo }> = [];

        for (let slot = 0; slot < serverItems.length; slot++) {
            const info = serverItems[slot];
            if (!info) continue;
            const catalog = matchCatalogItem(info);
            if (catalog) {
                if (!realByKey.has(catalog.key)) realByKey.set(catalog.key, { slot, raw: info.slot, info });
            } else if (!isDecorativeGlass(info)) {
                unmapped.push({ slot, raw: info.slot, info });
            }
        }

        const filler = fillerItem(fillerName(config.filler));
        const layout = ensureLayout();
        const occupied = new Set<number>();
        const nextSlotMap = new Map<number, number>();
        const container: Array<ItemSpec | Slot | null> = new Array(size).fill(filler);

        for (const [slotKey, itemKey] of Object.entries(layout)) {
            const targetSlot = Number(slotKey);
            if (!Number.isInteger(targetSlot) || targetSlot < 0 || targetSlot >= size) continue;
            occupied.add(targetSlot);
            const found = realByKey.get(itemKey);
            if (!found) continue;
            container[targetSlot] = found.raw;
            nextSlotMap.set(targetSlot, found.slot);
        }

        // reserve edit button slot before placing unmapped items so the button stays reachable
        let editSlot: number | undefined;
        if (config.showEditButton !== false) {
            editSlot = pickEditButtonSlot(size, occupied);
            if (editSlot !== undefined) {
                occupied.add(editSlot);
                container[editSlot] = {
                    id: "nether_star",
                    name: "§bCustomize Diamond Shop",
                    lore: [
                        "§7Rearrange upgrades, traps, rows & filler",
                        "",
                        "§eClick §7to open the layout editor",
                        `§8Or run ${api.config.commandPrefix}dshop anytime`,
                    ],
                };
            }
        }

        // keep any extra / Dream-mode Hypixel upgrades reachable
        if (config.showUnmapped !== false && unmapped.length > 0) {
            const free = preferredFreeSlots(size, occupied);
            for (let i = 0; i < unmapped.length && i < free.length; i++) {
                const targetSlot = free[i];
                const extra = unmapped[i];
                container[targetSlot] = extra.raw;
                nextSlotMap.set(targetSlot, extra.slot);
                occupied.add(targetSlot);
            }
        }

        live.slotMap = nextSlotMap;
        live.editSlot = editSlot;
        for (let slot = 0; slot < size; slot++) {
            live.chest.set(slot, container[slot]);
        }
    };

    // no saved layout yet: adopt Hypixel's normal arrangement (catalog slots as the server sends them) as the default
    const captureNativeLayout = (win: ServerWindow): void => {
        if (Object.keys(ensureLayout()).length > 0) return;
        const items = win.items();
        const layout: Record<string, string> = {};
        const taken = new Set<string>();
        for (let slot = 0; slot < items.length; slot++) {
            const info = items[slot];
            const catalog = info ? matchCatalogItem(info) : undefined;
            if (!catalog || taken.has(catalog.key)) continue;
            layout[String(slot)] = catalog.key;
            taken.add(catalog.key);
        }
        if (Object.keys(layout).length === 0) return;
        config.layout = layout;
        config.rows = win.rows;
        persist();
    };

    const onServerWindow = (session: Session, state: SessionState, win: ServerWindow): void => {
        if (!isDiamondShopWindow(session, win)) return;
        win.suppress();
        captureNativeLayout(win);

        // if Hypixel re-opened Upgrades & Traps with a new windowId, rebind in place so the mouse stays put
        if (state.live && state.live.chest.isOpen()) {
            state.live.serverId = win.id;
            renderLiveShop(session, state, win);
            return;
        }

        const rows = clampRows(config.rows);
        const title = String(config.title || DIAMOND_SHOP_DEFAULTS.title);
        const filler = fillerItem(fillerName(config.filler));
        const liveState: LiveShopState = {
            serverId: win.id,
            slotMap: new Map(),
            chest: null as unknown as Chest,
        };

        const chest = session.windows.chest({
            title,
            rows,
            keepServerWindow: true,
            onClick: (event) => {
                if (!event.container) return;
                if (liveState.editSlot !== undefined && event.slot === liveState.editSlot) {
                    const serverWin = session.windows.server();
                    if (serverWin && serverWin.id === liveState.serverId) serverWin.close();
                    liveState.closingFromServer = true;
                    state.live = undefined;
                    openEditor(session);
                    return;
                }
                const realSlot = liveState.slotMap.get(event.slot);
                if (realSlot === undefined) return;
                const serverWin = session.windows.server();
                if (!serverWin || serverWin.id !== liveState.serverId) return;
                serverWin.click(realSlot, { button: 0, mode: 0 });
            },
            onClose: () => {
                if (state.live === liveState) state.live = undefined;
                if (liveState.closingFromServer) return;
                const serverWin = session.windows.server();
                if (serverWin && serverWin.id === liveState.serverId) serverWin.close();
            },
        });

        liveState.chest = chest;
        state.live = liveState;
        if (filler) chest.fill(filler);
        renderLiveShop(session, state, win);
    };

    const onServerClose = (state: SessionState, windowId: number): void => {
        if (state.live && state.live.serverId === windowId) {
            closeLive(state, false);
        }
    };

    const attach = (session: Session): SessionState => {
        const existing = sessions.get(session.id);
        if (existing) return existing;
        const state: SessionState = {
            unsubWindow: () => {},
            unsubClose: () => {},
            editor: {},
        };
        state.unsubWindow = session.windows.onServerWindow((win) => onServerWindow(session, state, win));
        state.unsubClose = session.windows.onServerClose((windowId) => onServerClose(state, windowId));
        sessions.set(session.id, state);
        return state;
    };

    const detach = (sessionId: string): void => {
        const state = sessions.get(sessionId);
        if (!state) return;
        state.unsubWindow();
        state.unsubClose();
        closeLive(state, false);
        state.editor.chest?.close();
        state.editor.menu?.close();
        sessions.delete(sessionId);
    };

    // ---- Layout Editor (uses session.windows.chest & session.windows.menu) ----

    const slotsUsingKey = (key: string, maxSlot: number): number[] => {
        const layout = ensureLayout();
        const out: number[] = [];
        for (const [slotStr, itemKey] of Object.entries(layout)) {
            const slot = Number(slotStr);
            if (itemKey === key && Number.isInteger(slot) && slot >= 0 && slot < maxSlot) out.push(slot);
        }
        return out.sort((a, b) => a - b);
    };

    const firstFreeCanvasSlot = (size: number): number | undefined => {
        const layout = ensureLayout();
        const occupied = new Set(Object.keys(layout).map(Number));
        return preferredFreeSlots(size, occupied)[0];
    };

    const cycleFiller = (delta: number): string => {
        const current = fillerName(config.filler);
        const index = FILLER_CHOICES.indexOf(current as (typeof FILLER_CHOICES)[number]);
        const next = FILLER_CHOICES[(index + delta + FILLER_CHOICES.length) % FILLER_CHOICES.length];
        config.filler = next;
        persist();
        return next;
    };

    const resetDefaults = (): void => {
        config.rows = DIAMOND_SHOP_DEFAULTS.rows;
        config.filler = DIAMOND_SHOP_DEFAULTS.filler;
        config.showEditButton = DIAMOND_SHOP_DEFAULTS.showEditButton;
        config.showUnmapped = DIAMOND_SHOP_DEFAULTS.showUnmapped;
        config.layout = {};
        persist();
    };

    const openItemPicker = (session: Session, targetSlot?: number): void => {
        const state = attach(session);
        const rows = clampRows(config.rows);
        const canvasSize = rows * CHEST_COLUMNS;
        const layout = ensureLayout();

        const entries: MenuEntry[] = SHOP_ITEMS.map((entry) => {
            const used = slotsUsingKey(entry.key, canvasSize);
            const isPlaced = used.length > 0;
            const color = categoryColor(entry.category);
            return {
                item: {
                    ...entry.icon,
                    name: `${color}${entry.label}`,
                    glow: isPlaced,
                    lore: [
                        `§8${entry.category}`,
                        `§7${entry.description}`,
                        "",
                        isPlaced ? `§aPlaced in slot(s): §f${used.join(", ")}` : "§8Not currently placed",
                        targetSlot !== undefined
                            ? `§eClick §7to place in slot §f#${targetSlot}`
                            : "§eClick §7to place in the next open slot",
                    ],
                },
                onClick: () => {
                    const slot = targetSlot ?? firstFreeCanvasSlot(canvasSize);
                    if (slot === undefined) {
                        session.chat.text(`${PREFIX} §cNo empty slots left! Remove an item or increase rows first.`);
                        openEditor(session);
                        return;
                    }
                    layout[String(slot)] = entry.key;
                    persist();
                    state.editor.selectedSlot = undefined;
                    openEditor(session);
                },
            };
        });

        if (targetSlot !== undefined && layout[String(targetSlot)]) {
            entries.push({
                item: {
                    id: "barrier",
                    name: "§cClear Slot",
                    lore: [`§7Remove the item from slot §f#${targetSlot}`],
                },
                onClick: () => {
                    delete layout[String(targetSlot)];
                    persist();
                    state.editor.selectedSlot = undefined;
                    openEditor(session);
                },
            });
        }

        state.editor.switching = true;
        state.editor.menu = session.windows.menu({
            title: targetSlot !== undefined ? `§bPick Item §8(slot #${targetSlot})` : "§bPlace Diamond Shop Item",
            entries,
            onBack: () => openEditor(session),
            onClose: () => {
                if (state.editor.switching) return;
                state.editor.menu = undefined;
            },
        });
        state.editor.switching = false;
    };

    const openSettingsMenu = (session: Session): void => {
        const state = attach(session);
        const buildEntries = (): MenuEntry[] => {
            const rows = clampRows(config.rows);
            const filler = fillerName(config.filler);
            const enabled = config.enabled !== false;
            const showEdit = config.showEditButton !== false;
            const showUnmapped = config.showUnmapped !== false;

            return [
                {
                    item: {
                        id: "ladder",
                        count: rows,
                        name: `§eShop Rows: §f${rows}`,
                        lore: [
                            `§7Shop size: §f${rows}x9 §8(${rows * CHEST_COLUMNS} slots)`,
                            "",
                            "§eLeft-click §7to add a row",
                            "§eRight-click §7to remove a row",
                        ],
                    },
                    onClick: (event) => {
                        config.rows = clampRows(rows + (event.right ? -1 : 1));
                        persist();
                        event.menu.render();
                    },
                },
                {
                    item: {
                        id: filler === "none" ? "glass_pane" : "stained_glass_pane",
                        damage: filler === "none" ? 0 : (WOOL[filler] ?? WOOL.gray),
                        name: `§eFiller Glass: §f${filler}`,
                        lore: [
                            "§7Background panes for empty slots",
                            "",
                            "§eLeft-click §7for next color",
                            "§eRight-click §7for previous color",
                        ],
                    },
                    onClick: (event) => {
                        cycleFiller(event.right ? -1 : 1);
                        event.menu.render();
                    },
                },
                {
                    item: {
                        id: "nether_star",
                        glow: showEdit,
                        name: `§eIn-Shop Edit Button: ${showEdit ? "§aON" : "§cOFF"}`,
                        lore: [
                            "§7Shows a Customize button in the",
                            "§7bottom-right of the Diamond Shop",
                            "",
                            "§eClick §7to toggle",
                        ],
                    },
                    onClick: (event) => {
                        config.showEditButton = !showEdit;
                        persist();
                        event.menu.render();
                    },
                },
                {
                    item: {
                        id: "hopper",
                        glow: showUnmapped,
                        name: `§eAuto-Show Extra Items: ${showUnmapped ? "§aON" : "§cOFF"}`,
                        lore: [
                            "§7Automatically shows Dream-mode or",
                            "§7extra upgrades not in your layout",
                            "",
                            "§eClick §7to toggle",
                        ],
                    },
                    onClick: (event) => {
                        config.showUnmapped = !showUnmapped;
                        persist();
                        event.menu.render();
                    },
                },
                {
                    item: {
                        id: "dye",
                        damage: enabled ? DYE.lime : DYE.gray,
                        name: `§eCustom Diamond Shop: ${enabled ? "§aENABLED" : "§cDISABLED"}`,
                        lore: ["§7Toggle overriding Hypixel's Diamond Shop", "", "§eClick §7to toggle"],
                    },
                    onClick: (event) => {
                        config.enabled = !enabled;
                        persist();
                        event.menu.render();
                    },
                },
                {
                    item: {
                        id: "barrier",
                        name: "§cReset to Default Layout",
                        lore: [
                            "§7Restores the normal Hypixel",
                            "§7Upgrades & Traps layout",
                            "",
                            "§cShift-click §7to confirm reset",
                        ],
                    },
                    onClick: (event) => {
                        if (!event.shift) {
                            session.chat.text(`${PREFIX} §7Shift-click §cReset §7to confirm resetting your layout.`);
                            return;
                        }
                        resetDefaults();
                        session.chat.text(`${PREFIX} §aReset Diamond Shop layout to defaults.`);
                        openEditor(session);
                    },
                },
            ];
        };

        state.editor.switching = true;
        state.editor.menu = session.windows.menu({
            title: "§bDiamond Shop Settings",
            entries: buildEntries,
            onBack: () => openEditor(session),
            onClose: () => {
                if (state.editor.switching) return;
                state.editor.menu = undefined;
            },
        });
        state.editor.switching = false;
    };

    const drawEditor = (session: Session, state: SessionState, chest: Chest): void => {
        const rows = clampRows(config.rows);
        const hasToolbar = rows < MAX_CHEST_ROWS;
        const displayRows = hasToolbar ? rows + 1 : MAX_CHEST_ROWS;
        const canvasSize = rows * CHEST_COLUMNS;
        const filler = fillerName(config.filler);
        const layout = ensureLayout();

        if (state.editor.selectedSlot !== undefined && state.editor.selectedSlot >= canvasSize) {
            state.editor.selectedSlot = undefined;
        }

        const selectedKey =
            state.editor.selectedSlot !== undefined ? layout[String(state.editor.selectedSlot)] : undefined;
        const selectedLabel = selectedKey ? (CATALOG_BY_KEY.get(selectedKey)?.label ?? selectedKey) : undefined;

        const title = hasToolbar ? "§bDiamond Shop Editor" : "§bDiamond Shop §8(click out: opts)";
        if (chest.rows !== displayRows) chest.setRows(displayRows);
        if (chest.title !== title) chest.setTitle(title);

        for (let slot = 0; slot < canvasSize; slot++) {
            const key = layout[String(slot)];
            const catalog = key ? CATALOG_BY_KEY.get(key) : undefined;
            if (!catalog) {
                chest.set(slot, editorEmptyItem(filler, slot, selectedLabel));
                continue;
            }
            const isSelected = state.editor.selectedSlot === slot;
            const color = categoryColor(catalog.category);
            const lore = isSelected
                ? [
                      `§8Slot #${slot} • ${catalog.category}`,
                      "§a§lSELECTED",
                      "§7Click any slot to move or swap here",
                      "§8Click again to deselect",
                  ]
                : selectedLabel
                  ? [
                        `§8Slot #${slot} • ${catalog.category}`,
                        `§7${catalog.description}`,
                        "",
                        `§eLeft-click §7to swap with §f${selectedLabel}`,
                        "§eRight-click §7to remove",
                    ]
                  : [
                        `§8Slot #${slot} • ${catalog.category}`,
                        `§7${catalog.description}`,
                        "",
                        "§eLeft-click §7to select & move",
                        "§eRight-click §7to remove",
                        "§eShift-click §7to change item",
                    ];

            chest.set(slot, {
                ...catalog.icon,
                name: `${color}${catalog.label}`,
                glow: isSelected,
                lore,
            });
        }

        if (!hasToolbar) return;

        const bar = rows * CHEST_COLUMNS;
        const enabled = config.enabled !== false;
        const showEdit = config.showEditButton !== false;
        const showUnmapped = config.showUnmapped !== false;

        chest.set(bar + 0, {
            id: "emerald",
            name: "§a+ Place Item",
            lore: ["§7Pick an upgrade, trap, or queue", "§7slot to add to your shop"],
        });
        chest.set(bar + 1, {
            id: "ladder",
            count: rows,
            name: `§eRows: §f${rows}`,
            lore: ["§eLeft-click §7+1 row", "§eRight-click §7-1 row", "§8(1-6 rows; 6 hides toolbar)"],
        });
        chest.set(bar + 2, {
            id: filler === "none" ? "glass_pane" : "stained_glass_pane",
            damage: filler === "none" ? 0 : (WOOL[filler] ?? WOOL.gray),
            name: `§eFiller: §f${filler}`,
            lore: ["§eLeft-click §7next color", "§eRight-click §7previous color"],
        });
        chest.set(bar + 3, {
            id: "nether_star",
            glow: showEdit,
            name: `§eEdit Button: ${showEdit ? "§aON" : "§cOFF"}`,
            lore: ["§7Show Customize button inside", "§7the live Diamond Shop", "", "§eClick §7to toggle"],
        });
        chest.set(bar + 4, {
            id: "hopper",
            glow: showUnmapped,
            name: `§eExtra Items: ${showUnmapped ? "§aON" : "§cOFF"}`,
            lore: ["§7Auto-fill Dream-mode upgrades", "§7not placed in your layout", "", "§eClick §7to toggle"],
        });
        chest.set(bar + 5, {
            id: "dye",
            damage: enabled ? DYE.lime : DYE.gray,
            name: `§eShop: ${enabled ? "§aENABLED" : "§cDISABLED"}`,
            lore: ["§7Toggle custom Diamond Shop", "", "§eClick §7to toggle"],
        });
        chest.set(bar + 6, { id: "stained_glass_pane", damage: WOOL.black, name: " " });
        chest.set(bar + 7, {
            id: "barrier",
            name: "§cReset Default",
            lore: ["§7Restore the normal Hypixel layout", "", "§cShift-click §7to confirm"],
        });
        chest.set(bar + 8, {
            id: "book",
            glow: true,
            name: "§aDone",
            lore: ["§7Changes save automatically", "§7to config.json", "", "§eClick §7to close"],
        });
    };

    const handleEditorClick = (session: Session, state: SessionState, chest: Chest, event: ClickEvent): void => {
        const rows = clampRows(config.rows);
        const hasToolbar = rows < MAX_CHEST_ROWS;
        const canvasSize = rows * CHEST_COLUMNS;

        if (event.outside) {
            openSettingsMenu(session);
            return;
        }
        if (!event.container) return;

        // toolbar clicks
        if (hasToolbar && event.slot >= canvasSize) {
            const col = event.slot - canvasSize;
            switch (col) {
                case 0:
                    openItemPicker(session);
                    return;
                case 1:
                    config.rows = clampRows(rows + (event.right ? -1 : 1));
                    persist();
                    drawEditor(session, state, chest);
                    return;
                case 2:
                    cycleFiller(event.right ? -1 : 1);
                    drawEditor(session, state, chest);
                    return;
                case 3:
                    config.showEditButton = !(config.showEditButton !== false);
                    persist();
                    drawEditor(session, state, chest);
                    return;
                case 4:
                    config.showUnmapped = !(config.showUnmapped !== false);
                    persist();
                    drawEditor(session, state, chest);
                    return;
                case 5:
                    config.enabled = !(config.enabled !== false);
                    persist();
                    drawEditor(session, state, chest);
                    return;
                case 7:
                    if (!event.shift) {
                        session.chat.text(`${PREFIX} §7Shift-click §cReset Default §7to confirm.`);
                        return;
                    }
                    resetDefaults();
                    state.editor.selectedSlot = undefined;
                    session.chat.text(`${PREFIX} §aReset Diamond Shop layout to defaults.`);
                    drawEditor(session, state, chest);
                    return;
                case 8:
                    chest.close();
                    session.chat.text(`${PREFIX} §aSaved Diamond Shop layout.`);
                    return;
                default:
                    return;
            }
        }

        // canvas clicks
        const layout = ensureLayout();
        const key = layout[String(event.slot)];
        const selected = state.editor.selectedSlot;

        if (event.shift) {
            state.editor.selectedSlot = undefined;
            openItemPicker(session, event.slot);
            return;
        }

        if (event.right) {
            state.editor.selectedSlot = undefined;
            if (key) {
                delete layout[String(event.slot)];
                persist();
                drawEditor(session, state, chest);
            } else {
                openItemPicker(session, event.slot);
            }
            return;
        }

        // left-click: select, move, swap, or open item picker on empty slot
        if (selected !== undefined) {
            state.editor.selectedSlot = undefined;
            if (selected === event.slot) {
                drawEditor(session, state, chest);
                return;
            }
            const sourceKey = layout[String(selected)];
            if (sourceKey) {
                if (key) layout[String(selected)] = key;
                else delete layout[String(selected)];
                layout[String(event.slot)] = sourceKey;
                persist();
            }
            drawEditor(session, state, chest);
            return;
        }

        if (key) {
            state.editor.selectedSlot = event.slot;
            drawEditor(session, state, chest);
        } else {
            openItemPicker(session, event.slot);
        }
    };

    const openEditor = (session: Session): void => {
        const state = attach(session);
        const rows = clampRows(config.rows);
        const displayRows = rows < MAX_CHEST_ROWS ? rows + 1 : MAX_CHEST_ROWS;

        state.editor.switching = true;
        const chest = session.windows.chest({
            title: rows < MAX_CHEST_ROWS ? "§bDiamond Shop Editor" : "§bDiamond Shop §8(click out: opts)",
            rows: displayRows,
            onClick: (event) => handleEditorClick(session, state, chest, event),
            onClose: () => {
                if (state.editor.switching) return;
                state.editor.chest = undefined;
                state.editor.selectedSlot = undefined;
            },
        });
        state.editor.chest = chest;
        state.editor.switching = false;
        drawEditor(session, state, chest);
    };

    api.on("sessionStart", (session) => {
        attach(session);
    });

    // fallback attach if plugin was hot-reloaded mid-session
    api.on("serverPacket", (_name, _data, session) => {
        if (!sessions.has(session.id)) attach(session);
    });

    api.on("sessionEnd", (session) => detach(session.id));

    api.onCleanup(() => {
        for (const id of [...sessions.keys()]) detach(id);
    });

    const p = api.config.commandPrefix;
    api.registerCommand(
        "dshop",
        (args, session) => {
            const sub = args[0]?.toLowerCase();
            if (!sub || sub === "edit") {
                openEditor(session);
                return;
            }
            if (sub === "settings" || sub === "options") {
                openSettingsMenu(session);
                return;
            }
            if (sub === "toggle") {
                config.enabled = !(config.enabled !== false);
                persist();
                session.chat.text(
                    `${PREFIX} §7Custom Diamond Shop ${config.enabled ? "§aenabled" : "§cdisabled"}§7.`,
                );
                return;
            }
            if (sub === "rows") {
                const value = Number(args[1]);
                if (!Number.isInteger(value) || value < 1 || value > MAX_CHEST_ROWS) {
                    session.chat.text(`${PREFIX} §7Usage: §f${p}dshop rows <1-6> §8(currently ${clampRows(config.rows)})`);
                    return;
                }
                config.rows = value;
                persist();
                session.chat.text(`${PREFIX} §aSet Diamond Shop rows to §f${value}§a.`);
                return;
            }
            if (sub === "filler") {
                const raw = args[1]?.toLowerCase();
                if (!raw || (raw !== "none" && !(raw in WOOL))) {
                    session.chat.text(
                        `${PREFIX} §7Filler options: §f${FILLER_CHOICES.join("§7, §f")} §8(currently ${fillerName(config.filler)})`,
                    );
                    return;
                }
                config.filler = raw;
                persist();
                session.chat.text(`${PREFIX} §aSet Diamond Shop filler to §f${raw}§a.`);
                return;
            }
            if (sub === "reset") {
                resetDefaults();
                session.chat.text(`${PREFIX} §aReset Diamond Shop layout & settings to defaults.`);
                return;
            }
            session.chat.text(`${PREFIX} §7Customizable Bedwars Diamond Shop:`);
            session.chat.text(`  §f${p}dshop §8- §7open the visual layout editor`);
            session.chat.text(`  §f${p}dshop settings §8- §7open the settings menu`);
            session.chat.text(`  §f${p}dshop rows <1-6> §8- §7change shop height`);
            session.chat.text(`  §f${p}dshop filler <color|none> §8- §7change empty slot glass`);
            session.chat.text(`  §f${p}dshop toggle §8- §7enable or disable`);
            session.chat.text(`  §f${p}dshop reset §8- §7reset layout to defaults`);
        },
        "customize the Bedwars Diamond Shop layout: //dshop [edit|settings|rows|filler|toggle|reset]",
    );
}
