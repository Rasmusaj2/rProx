// nickbook handler for /nick
import { PREFIX } from "../../core/chat";
import type { PluginApi, Session } from "../../core/types";
import { stripColorCodes } from "../../util/mcColors";

const BOOK_CHANNEL = "MC|BOpen";

const HOTBAR_FIRST = 36; 
const HOTBAR_LAST = 44;
const HOTBAR_SIZE = 9;

const ANNOUNCE_FALLBACK_MS = 500; 
const DECOY_TTL_MS = 1_000; 

const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;
const GENERATED_RE = /username for you:?\s*([A-Za-z0-9_]{3,16})/i;

interface NickbookConfig {
    enabled?: boolean;
    restoreHeldItem?: boolean;
    rerollCooldownMs?: number;
    useLabels?: string[];
    rerollLabels?: string[];
    trace?: boolean;
}

interface Span {
    text: string;
    command?: string;
}

interface PageComponent {
    text?: unknown;
    extra?: unknown;
    clickEvent?: { action?: string; value?: unknown };
}

interface SlotItem {
    blockId?: number;
    nbtData?: unknown;
}

interface NickBook {
    name: string; // rolled name
    use: string; 
    reroll: string;
    reachable?: boolean;
    expected?: boolean;
    slot?: number;
}

interface NickbookState {
    pending: NickBook | null; 
    pendingTimer: NodeJS.Timeout | null;
    current: NickBook | null;
    lastRerollAt: number;
    rerollTimer: NodeJS.Timeout | null;
    hotbar: Map<number, SlotItem>; 
    heldSlot: number; // where hypiixel thinks hand is
    decoy: { slot: number; restore: number } | null;
    decoyTimer: NodeJS.Timeout | null;
    at: { x: number; y: number; z: number };
}


function nbt(node: unknown): unknown {
    let current = node;
    while (current && typeof current === "object" && !Array.isArray(current) && "type" in current && "value" in current) {
        current = (current as Record<string, unknown>).value;
    }
    return current;
}

function bookPages(item: SlotItem | null | undefined): string[] | null {
    const root = nbt(item?.nbtData);
    if (!root || typeof root !== "object" || Array.isArray(root)) return null;
    const pages = nbt((root as Record<string, unknown>).pages);
    if (!Array.isArray(pages)) return null;
    const strings = pages.map((page) => nbt(page)).filter((page): page is string => typeof page === "string");
    return strings.length > 0 ? strings : null;
}

function collect(node: unknown, out: Span[], inherited: string | undefined): void {
    if (node === null || node === undefined) return;
    if (typeof node === "string") {
        if (node) out.push({ text: node, command: inherited });
        return;
    }
    if (Array.isArray(node)) {
        for (const child of node) collect(child, out, inherited);
        return;
    }
    const component = node as PageComponent;
    const click = component.clickEvent;
    const command =
        click && click.action === "run_command" && typeof click.value === "string" ? click.value : inherited;
    if (typeof component.text === "string" && component.text) out.push({ text: component.text, command });
    collect(component.extra, out, command);
}

function squash(text: string): string {
    return stripColorCodes(text).replace(/\s+/g, " ").trim();
}

function flatten(text: string): string {
    return squash(text).toUpperCase();
}

function generatedName(text: string, useCommand: string): string | undefined {
    const match = GENERATED_RE.exec(squash(text));
    if (match) return match[1];
    const tail = stripColorCodes(useCommand).trim().split(/\s+/).pop();
    return tail && NAME_RE.test(tail) ? tail : undefined;
}

// is this the reroll book, and if so what does it say and what do its buttons run
function parseNickBook(pages: string[], useLabels: string[], rerollLabels: string[]): NickBook | null {
    const spans: Span[] = [];
    for (const page of pages) {
        let parsed: unknown;
        try {
            parsed = JSON.parse(page);
        } catch {
            parsed = { text: page }; // a page can be a bare string
        }
        collect(parsed, spans, undefined);
    }
    if (spans.length === 0) return null;

    const buttons = new Map<string, string>();
    for (const span of spans) {
        if (!span.command) continue;
        buttons.set(span.command, (buttons.get(span.command) ?? "") + span.text);
    }

    const commandFor = (labels: string[]): string | undefined => {
        for (const [command, text] of buttons) {
            const label = flatten(text);
            if (labels.some((wanted) => label.includes(wanted))) return command;
        }
        return undefined;
    };

    const use = commandFor(useLabels);
    const reroll = commandFor(rerollLabels);
    if (!use || !reroll || use === reroll) return null; // some other book, leave it alone

    const name = generatedName(spans.map((span) => span.text).join(" "), use);
    return name ? { name, use, reroll } : null;
}

function labelList(value: unknown, fallback: string[]): string[] {
    const list = (Array.isArray(value) ? value : [])
        .filter((entry) => typeof entry === "string")
        .map((entry) => flatten(entry))
        .filter(Boolean);
    return list.length > 0 ? list : fallback;
}

function hover(text: string) {
    return { action: "show_text", value: { text } };
}

export function registerNickbook(api: PluginApi): void {
    const config = (api.pluginConfig.nickbook ?? {}) as NickbookConfig;
    if (config.enabled === false) return; // disable this specifically
    const commandPrefix = api.config.commandPrefix;

    const settings = {
        restoreHeldItem: config.restoreHeldItem !== false,
        cooldownMs: Math.max(0, Number(config.rerollCooldownMs ?? 400)),
        useLabels: labelList(config.useLabels, ["USE NAME"]),
        rerollLabels: labelList(config.rerollLabels, ["TRY AGAIN"]),
        trace: config.trace === true,
    };

    const trace = (message: string) => {
        if (settings.trace) api.log.info(`trace: ${message}`);
    };

    // state
    const sessions = new Map<string, NickbookState>(); // session id to state

    function stateFor(session: Session): NickbookState {
        let state = sessions.get(session.id);
        if (!state) {
            state = {
                pending: null,
                pendingTimer: null,
                current: null,
                lastRerollAt: 0,
                rerollTimer: null,
                hotbar: new Map(),
                heldSlot: 0,
                decoy: null,
                decoyTimer: null,
                at: { x: 0, y: 0, z: 0 },
            };
            sessions.set(session.id, state);
        }
        return state;
    }

    function dispose(id: string): void {
        const state = sessions.get(id);
        if (!state) return;
        if (state.rerollTimer != null) clearTimeout(state.rerollTimer);
        if (state.decoyTimer != null) clearTimeout(state.decoyTimer);
        if (state.pendingTimer != null) clearTimeout(state.pendingTimer);
        sessions.delete(id);
    }

    // keep book closed
    function decoySlot(state: NickbookState, avoid: number[]): number | undefined {
        const at = (slot: number) => state.hotbar.get(HOTBAR_FIRST + slot);
        const free: number[] = [];
        for (let slot = 0; slot < HOTBAR_SIZE; slot++) {
            if (avoid.includes(slot)) continue;
            const item = at(slot);
            if (item && bookPages(item)) continue;
            free.push(slot);
        }
        if (free.length === 0) return undefined;
        const empty = (slot: number) => {
            const item = at(slot);
            return !!item && (item.blockId ?? -1) < 0;
        };
        const known = (slot: number) => state.hotbar.has(HOTBAR_FIRST + slot);
        return free.find(empty) ?? free.find(known) ?? free[0];
    }

    function arm(session: Session, state: NickbookState, bookSlot: number | undefined): boolean {
        const book = bookSlot === undefined ? state.heldSlot : bookSlot - HOTBAR_FIRST;
        const slot = decoySlot(state, [book, state.heldSlot]);
        if (slot === undefined) {
            trace("no decoy slot free, the book will open");
            return false;
        }
        state.decoy = { slot, restore: state.heldSlot };
        session.sendPacket("held_item_slot", { slot });
        trace(`-> held_item_slot ${slot} (decoy, inserted ahead of the open)`);
        if (state.decoyTimer != null) clearTimeout(state.decoyTimer);
        state.decoyTimer = setTimeout(() => disarm(session, state), DECOY_TTL_MS);
        state.decoyTimer.unref?.();
        return true;
    }

    function disarm(session: Session, state: NickbookState, silent?: boolean): void {
        const decoy = state.decoy;
        if (state.decoyTimer != null) clearTimeout(state.decoyTimer);
        state.decoyTimer = null;
        state.decoy = null;
        if (!decoy || silent) return;
        session.sendPacket("held_item_slot", { slot: decoy.restore });
        trace(`-> held_item_slot ${decoy.restore} (selection back)`);
    }

    //book handling
    function considerItem(
        session: Session,
        state: NickbookState,
        windowId: number,
        slot: number,
        item: SlotItem,
    ): void {
        const hotbar = windowId === 0 && slot >= HOTBAR_FIRST && slot <= HOTBAR_LAST;
        const pages = bookPages(item);
        const book = pages ? parseNickBook(pages, settings.useLabels, settings.rerollLabels) : null;
        if (!book) {
            if (hotbar) state.hotbar.set(slot, item);
            if (pages) trace(`book in slot ${slot} is not a nick book: ${pages.join(" | ")}`);
            return;
        }

        trace(`set_slot ${slot} is a nick book: ${book.name}`);

        book.reachable = hotbar;
        book.expected = !hotbar;
        if (hotbar) book.slot = slot;
        state.pending = book;

        if (state.pendingTimer != null) clearTimeout(state.pendingTimer);
        state.pendingTimer = setTimeout(() => takeOver(session, state, false), ANNOUNCE_FALLBACK_MS);
        state.pendingTimer.unref?.();
    }

    function onBookOpen(session: Session, state: NickbookState): void {
        const book = state.pending;
        if (!book) {
            trace("MC|BOpen (no nick book pending)");
            return;
        }
        trace(`MC|BOpen for ${book.name}`);
        if (book.reachable) book.expected = arm(session, state, book.slot);
        trace(book.expected ? "nothing opens" : "a book is opening");
        takeOver(session, state, true);
    }


    function takeOver(session: Session, state: NickbookState, opened: boolean): void {
        const book = state.pending;
        if (!book) return;
        state.pending = null;
        if (state.pendingTimer != null) clearTimeout(state.pendingTimer);
        state.pendingTimer = null;
        state.current = book;

        const finish = () => {
            try {
                if (opened && !book.expected) {
                    session.sendPacket("close_window", { windowId: 0 });
                    trace("-> close_window (a book got through)");
                }
                if (settings.restoreHeldItem) restoreSlot(session, state, book.slot);
                if (opened) disarm(session, state);
                announce(session, book);
            } catch (error) {
                api.log.debug(`takeover failed: ${error}`);
            }
        };

        // this could potentionally lead to issues on worse connections later, idk what we do here
        setImmediate(finish);
    }

    // restore slot properly, book was never in inventory
    function restoreSlot(session: Session, state: NickbookState, slot: number | undefined): void {
        if (slot === undefined || slot < HOTBAR_FIRST || slot > HOTBAR_LAST) return;
        const previous = state.hotbar.get(slot);
        if (!previous) return; // never saw it, better a stray book than a blanked slot
        session.sendPacket("set_slot", { windowId: 0, slot, item: previous });
        trace(`-> set_slot ${slot} (real item back)`);
    }

    // chat
    // one line + buttons
    function announce(session: Session, book: NickBook): void {
        session.chat.raw({
            text: "",
            extra: [
                { text: `${PREFIX} `, color: "dark_gray" },
                {
                    text: "[USE]",
                    color: "green",
                    bold: true,
                    hoverEvent: hover(`§aNick as §f${book.name}`),
                    clickEvent: { action: "run_command", value: `${commandPrefix}nickuse` },
                },
                { text: " ", color: "dark_gray" },
                {
                    text: "[REROLL]",
                    color: "yellow",
                    bold: true,
                    hoverEvent: hover("§eRoll another name"),
                    clickEvent: { action: "run_command", value: `${commandPrefix}nickreroll` },
                },
                { text: " ", color: "dark_gray" },
                {
                    text: book.name,
                    color: "white",
                    bold: true,
                    hoverEvent: hover(`§7Rolled name\n§f${book.name}\n§8click to put it in the chat box`),
                    clickEvent: { action: "suggest_command", value: book.name },
                },
            ],
        });
    }

    function pling(session: Session, state: NickbookState): void {
        const at = state.at;
        try {
            session.sendPacket("named_sound_effect", {
                soundName: "note.pling",
                x: Math.round(at.x * 8), // 1.8 sound positions are fixed point
                y: Math.round(at.y * 8),
                z: Math.round(at.z * 8),
                volume: 0.6,
                pitch: 90,
            });
        } catch (error) {
            api.log.debug(`roll sound failed: ${error}`);
        }
    }

    function noBook(session: Session): void {
        session.chat.text(`${PREFIX} §7No rolled name to act on. Run §f/nick §7and pick a random name first.`);
    }

    // ---- commands ------------------------------------------------------

    function reroll(session: Session, state: NickbookState): void {
        const book = state.current;
        if (!book) return;
        state.lastRerollAt = Date.now();
        trace(`reroll -> ${book.reroll}`);
        session.sendUpstream(book.reroll);
    }

    api.registerCommand(
        "nickuse",
        (_args, session) => {
            const state = stateFor(session);
            const book = state.current;
            if (!book) return noBook(session);
            state.current = null;
            if (state.rerollTimer != null) clearTimeout(state.rerollTimer);
            state.rerollTimer = null;
            disarm(session, state);
            session.sendUpstream(book.use);
            session.chat.text(`${PREFIX} §aNicking as §f${book.name}§a.`);
        },
        "Applies the name from the last /nick roll.",
    );

    api.registerCommand(
        "nickreroll",
        (_args, session) => {
            const state = stateFor(session);
            if (!state.current) return noBook(session);
            if (state.rerollTimer) return; // one is already queued, do not stack clicks
            const wait = state.lastRerollAt + settings.cooldownMs - Date.now();
            if (wait <= 0) {
                reroll(session, state);
                return;
            }
            state.rerollTimer = setTimeout(() => {
                state.rerollTimer = null;
                reroll(session, state);
            }, wait);
            state.rerollTimer.unref?.();
        },
        "Rolls another /nick name without reopening the book.",
    );

    api.registerCommand(
        "nickshow",
        (_args, session) => {
            const state = stateFor(session);
            if (!state.current) return noBook(session);
            announce(session, state.current); 
        },
        "Reprints the buttons for the current /nick roll.",
    );

    api.registerCommand(
        "nicktrace",
        (_args, session) => {
            settings.trace = !settings.trace;
            session.chat.text(
                `${PREFIX} §7Nick packet tracing §f${settings.trace ? "on" : "off"}`,
            );
        },
        "Logs the whole /nick packet sequence to the console, for when a book still gets through.",
    );

    // packet stuff
    api.on("sessionStart", (session) => stateFor(session));

    api.on("serverPacket", (name, data, session) => {
        const state = sessions.get(session.id);
        if (!state) return;
        try {
            if (name === "set_slot") {
                considerItem(session, state, data.windowId, data.slot, data.item);
            } else if (name === "window_items") {
                const items = data.items ?? [];
                for (let slot = 0; slot < items.length; slot++) {
                    considerItem(session, state, data.windowId, slot, items[slot]);
                }
            } else if (name === "custom_payload" && data.channel === BOOK_CHANNEL) {
                onBookOpen(session, state);
            } else if (name === "position") {
                state.at = { x: data.x, y: data.y, z: data.z };
            } else if (name === "held_item_slot") {
                const slot = Number(data.slot);
                trace(`held_item_slot ${slot} from hypixel`);
                if (slot >= 0 && slot < HOTBAR_SIZE) state.heldSlot = slot;
                // hypixel will open the book in the hand it thinks is selected
                if (state.decoy) {
                    if (state.pending) state.pending.expected = false;
                    disarm(session, state, true);
                    trace("decoy overwritten by hypixel, falling back to close_window");
                }
            }
        } catch (error) {
            api.log.debug(`${name} handling failed: ${error}`);
        }
    });

    api.on("clientPacket", (name, data, session) => {
        const state = sessions.get(session.id);
        if (!state) return;
        if (name === "position" || name === "position_look") {
            state.at = { x: data.x, y: data.y, z: data.z };
            return;
        }
        if (name !== "held_item_slot") return;

        const slot = Number(data.slotId);
        if (!(slot >= 0 && slot < HOTBAR_SIZE)) return;
        state.heldSlot = slot;

        if (state.decoy) {
            if (state.pending) state.pending.expected = false;
            disarm(session, state, true);
            trace(`player scrolled to ${slot} mid roll, decoy dropped`);
        }
    });

    api.on("sessionEnd", (session) => dispose(session.id));

    api.log.info(
        `nickbook active and rolls land in chat (${commandPrefix}nickuse, ${commandPrefix}nickreroll)`,
    );
}
