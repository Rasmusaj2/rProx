// //config handler
import { saveConfig, type Config } from "../../config";
import { PREFIX } from "../../core/chat";
import type { Session } from "../../core/types";
import { stripColorCodes } from "../../util/mcColors";
import { CONTENT_SLOTS, type ItemSpec, type Menu, type MenuEntry } from "../../interface/windowApi";
import type { Logger } from "../../util/log";

const HEADER_SLOT = 4; // top middle, above the 4x7 block
const PER_PAGE = CONTENT_SLOTS.length; // 28

// what the editor thinks a value is, which is all the typing it needs
type Kind = "object" | "array" | "boolean" | "number" | "string" | "null";

interface Pending {
    path: string[];
    back: string[]; // page to come back to
    page: number;
}

interface EditorState {
    path: string[];
    page: number;
    menu?: Menu;
    pending?: Pending;
}

export interface ConfigEditor {
    open(session: Session, path?: string[], page?: number): void;
    show(session: Session, path: string[]): void;
    assign(session: Session, path: string[], raw: string): void;
    takeChat(session: Session, message: string): boolean; // if currently editing take chat line
    editing(session: Session): boolean;
    cancel(session: Session): boolean;
    forget(sessionId: string): void;
}

function isBlock(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function kindOf(value: unknown): Kind {
    if (value === null || value === undefined) return "null";
    if (Array.isArray(value)) return "array";
    if (isBlock(value)) return "object";
    const type = typeof value;
    if (type === "boolean" || type === "number" || type === "string") return type;
    return "null";
}

function valueAt(root: unknown, path: string[]): unknown {
    let node: unknown = root;
    for (const key of path) {
        if (!isBlock(node)) return undefined;
        node = node[key];
    }
    return node;
}

function writeAt(root: Record<string, unknown>, path: string[], value: unknown): boolean {
    if (path.length === 0) return false;
    let node: unknown = root;
    for (const key of path.slice(0, -1)) {
        if (!isBlock(node)) return false;
        node = node[key];
    }
    if (!isBlock(node)) return false;
    node[path[path.length - 1]] = value;
    return true;
}

function clip(text: string, max: number): string {
    const cut = text.length <= max ? text : `${text.slice(0, max - 1)}…`;
    return cut.endsWith("§") ? cut.slice(0, -1) : cut;
}

// a value squashed onto one line, for a name or a lore row
function preview(value: unknown): string {
    switch (kindOf(value)) {
        case "object":
            return `§8{${Object.keys(value as object).length} keys}`;
        case "array": {
            const list = value as unknown[];
            return list.length === 0 ? "§8[empty]" : `§8[§f${list.length}§8] §7${clip(list.map(String).join(", "), 28)}`;
        }
        case "boolean":
            return value ? "§atrue" : "§cfalse";
        case "number":
            return `§6${value}`;
        case "string":
            return (value as string).length === 0 ? "§8(empty)" : `§f${clip(String(value), 32)}`;
        default:
            return "§8null";
    }
}

// regex to detect things that should be hidden
const SECRET_KEY = /(?:apikey|api_key|token|secret|password|cookie)$/i;
const HIDDEN_CHAR = "•";

function masked(key: string, value: unknown): boolean {
    return SECRET_KEY.test(key) && typeof value === "string" && value.length > 0;
}

function previewFor(key: string, value: unknown): string {
    return masked(key, value) ? `§8${HIDDEN_CHAR.repeat(16)} §8(hidden)` : preview(value);
}

const ICONS: Record<Kind, ItemSpec> = {
    object: { id: "chest" },
    array: { id: "book" },
    boolean: { id: "dye", damage: 10 }, // recolored per value below
    number: { id: "redstone" },
    string: { id: "name_tag" },
    null: { id: "barrier" },
};

function iconFor(key: string, value: unknown): ItemSpec {
    const kind = kindOf(value);
    if (kind === "boolean") return { id: "dye", damage: value ? 10 : 8 }; // lime / gray
    if (kind === "object") {
        // a block with an enabled flag is a plugin, colour the chest by it
        const enabled = (value as Record<string, unknown>).enabled;
        if (enabled === false) return { id: "chest", damage: 0 };
        return { id: enabled === true ? "trapped_chest" : "chest" };
    }
    return { ...ICONS[kind] };
}

function nameFor(key: string, value: unknown): string {
    const kind = kindOf(value);
    if (kind === "object") {
        const enabled = (value as Record<string, unknown>).enabled;
        if (enabled === false) return `§c${key}`;
        if (enabled === true) return `§a${key}`;
        return `§b${key}`;
    }
    if (kind === "boolean") return value ? `§a${key}` : `§7${key}`;
    return `§e${key}`;
}

// wrap a long value over several lore rows instead of cutting it off
function wrap(text: string, width: number): string[] {
    if (text.length <= width) return [text];
    const out: string[] = [];
    for (let at = 0; at < text.length; at += width) out.push(`§7${text.slice(at, at + width)}`);
    return out;
}

function dotted(path: string[]): string {
    return path.length ? path.join(".") : "config.json";
}

export interface ConfigEditorDeps {
    config: Config;
    prefix: string; // config.commandPrefix, for the clickable hints
    log: Logger;
}

export function createConfigEditor({ config, prefix, log }: ConfigEditorDeps): ConfigEditor {
    const sessions = new Map<string, EditorState>();

    function stateFor(session: Session): EditorState {
        let state = sessions.get(session.id);
        if (!state) {
            state = { path: [], page: 0 };
            sessions.set(session.id, state);
        }
        return state;
    }

    function entries(session: Session): MenuEntry[] {
        const state = stateFor(session);
        const node = valueAt(config, state.path);
        if (!isBlock(node)) return [];

        return Object.keys(node).map((key) => {
            const path = [...state.path, key];
            const value = node[key];
            const kind = kindOf(value);
            const lore: string[] = [];

            if (kind === "object") {
                const keys = Object.keys(value as object);
                lore.push(`§7${keys.length} setting${keys.length === 1 ? "" : "s"}`);
                lore.push(`§8${clip(keys.join(", "), 40)}`);
                lore.push("");
                lore.push("§eclick §7to open");
            } else {
                const shown = previewFor(key, value);
                lore.push(`§7Type: §f${kind}`);
                // short enough to sit on the type line, long enough to wrap under it
                if (stripColorCodes(shown).length <= 28) {
                    lore.push(`§7Value: ${shown}`);
                } else {
                    lore.push("§7Value:");
                    for (const line of wrap(shown, 40)) lore.push(`  ${line}`);
                }
                lore.push("");
                lore.push("§eclick §7to type a new value in chat");
                if (kind === "boolean") lore.push("§eright-click §7to toggle it now");
                if (kind === "array") lore.push("§8json, or a comma separated list");
                lore.push(`§8${dotted(path)}`);
            }

            const icon = iconFor(key, value);
            return {
                item: { ...icon, name: nameFor(key, value), lore },
                onClick: (event) => {
                    if (kind === "object") {
                        state.path = path;
                        state.page = 0;
                        event.menu.goto(0);
                        return;
                    }
                    // allow boolean toggling
                    if (kind === "boolean" && event.right) {
                        applyValue(session, path, !value, false);
                        event.menu.render();
                        return;
                    }
                    promptFor(session, path);
                },
            } satisfies MenuEntry;
        });
    }

    function header(session: Session): Record<number, MenuEntry> {
        const state = stateFor(session);
        const node = valueAt(config, state.path);
        const count = isBlock(node) ? Object.keys(node).length : 0;
        const lore = [
            `§7${count} entr${count === 1 ? "y" : "ies"}${count > PER_PAGE ? ` §8(${PER_PAGE}/page)` : ""}`,
            "",
            "§7Changes are written straight to",
            "§7config.json when you set them.",
            "§8plugins that read their settings",
            "§8once at startup want a restart",
        ];
        if (state.path.length) lore.splice(1, 0, `§8${dotted(state.path)}`);
        return {
            [HEADER_SLOT]: {
                item: {
                    id: "book",
                    name: state.path.length ? `§b${state.path[state.path.length - 1]}` : "§brProx config",
                    lore,
                    glow: true,
                },
            },
        };
    }

    function open(session: Session, path?: string[], page?: number): void {
        const state = stateFor(session);
        state.pending = undefined;
        if (path) state.path = path;
        if (page !== undefined) state.page = page;

        // one menu for the whole session - navigating just re-renders it, which
        // reopens the window in place rather than closing and opening a new one
        if (state.menu?.chest.isOpen()) {
            state.menu.goto(state.page);
            return;
        }

        state.menu = session.windows.menu({
            title: () => `§8Config §7» §f${clip(state.path[state.path.length - 1] ?? "root", 18)}`,
            entries: () => entries(session),
            fixed: () => header(session),
            page: state.page,
            // always drawn, but it is "close" at the root and "up one level" below it
            onBack: () => {
                if (state.path.length === 0) {
                    state.menu?.close();
                    return;
                }
                state.path = state.path.slice(0, -1);
                state.page = 0;
                state.menu?.goto(0);
            },
            back: () =>
                state.path.length === 0
                    ? { id: "barrier", name: "§cClose", lore: ["§8shut the config menu"] }
                    : {
                          id: "arrow",
                          name: "§c« Back",
                          lore: [`§8up to §7${dotted(state.path.slice(0, -1))}`],
                      },
            onClose: () => {
                // remember where we were, so a re-open lands in the same place
                if (state.menu) state.page = state.menu.page;
            },
        });
        state.menu.goto(state.page);
    }

    // a 1.8 client cannot type into chat with a container on screen, so the
    // window has to go before the prompt is any use
    function promptFor(session: Session, path: string[]): void {
        const state = stateFor(session);
        const current = valueAt(config, path);
        state.pending = { path, back: path.slice(0, -1), page: state.menu?.page ?? state.page };
        state.page = state.pending.page;
        state.menu?.close();

        session.chat.text(`${PREFIX} §7Editing §f${dotted(path)}`);
        session.chat.text(`  §7Current §8(${kindOf(current)})§7: ${previewFor(path[path.length - 1], current)}`);
        session.chat.raw({
            text: "",
            extra: [
                { text: "  §7Type the new value in chat" },
                { text: "  " },
                {
                    text: "[cancel]",
                    color: "red",
                    bold: true,
                    hoverEvent: { action: "show_text", value: { text: "§7leave it as it is" } },
                    clickEvent: { action: "run_command", value: `${prefix}config cancel` },
                },
            ],
        });
        const hint = hintFor(current);
        if (hint) session.chat.text(`  §8${hint}`);
    }

    function hintFor(current: unknown): string | undefined {
        switch (kindOf(current)) {
            case "boolean":
                return "true / false, or toggle";
            case "number":
                return "a number";
            case "array":
                return 'json ["a","b"], or a, b, c. "clear" empties it';
            case "string":
                return '&-codes become §-codes. "clear" empties it';
            default:
                return "json, or plain text";
        }
    }

    // turn a typed line into a value of the type the setting already had
    function coerce(current: unknown, raw: string): { value: unknown } | { error: string } {
        const text = raw.trim();
        const lower = text.toLowerCase();
        if (lower === "null") return { value: null };

        switch (kindOf(current)) {
            case "boolean": {
                if (["true", "yes", "on", "1", "enable", "enabled"].includes(lower)) return { value: true };
                if (["false", "no", "off", "0", "disable", "disabled"].includes(lower)) return { value: false };
                if (lower === "toggle") return { value: !current };
                return { error: "expected true or false" };
            }
            case "number": {
                const number = Number(text);
                if (!Number.isFinite(number)) return { error: `"${clip(text, 20)}" is not a number` };
                return { value: number };
            }
            case "array": {
                if (["clear", "empty", "[]", "none"].includes(lower)) return { value: [] };
                if (text.startsWith("[")) {
                    try {
                        const parsed = JSON.parse(text);
                        if (!Array.isArray(parsed)) return { error: "that json is not a list" };
                        return { value: parsed };
                    } catch (error) {
                        return { error: `bad json: ${(error as Error).message}` };
                    }
                }
                const parts = text
                    .split(",")
                    .map((part) => part.trim())
                    .filter((part) => part.length > 0);
                const sample = (current as unknown[])[0];
                // keep a list of numbers a list of numbers
                if (typeof sample === "number") {
                    const numbers = parts.map(Number);
                    if (numbers.some((number) => !Number.isFinite(number))) return { error: "expected numbers" };
                    return { value: numbers };
                }
                if (typeof sample === "boolean") {
                    return { value: parts.map((part) => ["true", "yes", "on", "1"].includes(part.toLowerCase())) };
                }
                return { value: parts.map((part) => colorCodes(part)) };
            }
            case "string": {
                if (["clear", "empty", '""'].includes(lower)) return { value: "" };
                return { value: colorCodes(raw.replace(/\s+$/, "")) };
            }
            default: {
                // nothing to go on, so take json if it parses and plain text if not
                try {
                    return { value: JSON.parse(text) };
                } catch {
                    return { value: colorCodes(raw) };
                }
            }
        }
    }

    // &a is easier to type than §a, and && is how you keep a literal ampersand
    function colorCodes(text: string): string {
        const KEEP = " "; // goofy unicode character that will never appear in a config value, so we can use it as a temporary placeholder
        return text.replace(/&&/g, KEEP).replace(/&([0-9a-fk-orA-FK-OR])/g, "§$1").replace(new RegExp(KEEP, "g"), "&");
    }

    function applyValue(session: Session, path: string[], value: unknown, announce = true): boolean {
        if (!writeAt(config as unknown as Record<string, unknown>, path, value)) {
            session.chat.text(`${PREFIX} §cCould not write §f${dotted(path)}§c, the path is gone`);
            return false;
        }
        const saved = saveConfig(config);
        log.info(`${session.username} set ${dotted(path)} = ${JSON.stringify(value)}`);
        if (announce) {
            session.chat.text(`${PREFIX} §aSet §f${dotted(path)} §7to ${preview(value)}`);
        }
        if (!saved) session.chat.text(`${PREFIX} §cThe value is live but config.json could not be written`);
        return true;
    }

    function takeChat(session: Session, message: string): boolean {
        const state = sessions.get(session.id);
        const pending = state?.pending;
        if (!state || !pending) return false;
        state.pending = undefined;

        const trimmed = message.trim();
        if (trimmed.toLowerCase() === "cancel") {
            session.chat.text(`${PREFIX} §7Left §f${dotted(pending.path)} §7alone.`);
            open(session, pending.back, pending.page);
            return true;
        }

        const current = valueAt(config, pending.path);
        const result = coerce(current, message);
        if ("error" in result) {
            session.chat.text(`${PREFIX} §c${result.error}§7. §f${dotted(pending.path)} §7is unchanged.`);
            open(session, pending.back, pending.page);
            return true;
        }

        applyValue(session, pending.path, result.value);
        open(session, pending.back, pending.page);
        return true;
    }

    function show(session: Session, path: string[]): void {
        const value = valueAt(config, path);
        if (value === undefined) {
            session.chat.text(`${PREFIX} §cNo such setting: §f${dotted(path)}`);
            const parent = valueAt(config, path.slice(0, -1));
            if (isBlock(parent)) {
                session.chat.text(`  §7${dotted(path.slice(0, -1))} has: §f${Object.keys(parent).join("§7, §f")}`);
            }
            return;
        }
        session.chat.text(`${PREFIX} §f${dotted(path)} §8(${kindOf(value)})`);
        if (isBlock(value)) {
            for (const key of Object.keys(value)) {
                session.chat.text(`  §7${key}§8: ${previewFor(key, value[key])}`);
            }
            return;
        }
        session.chat.text(`  ${previewFor(path[path.length - 1] ?? "", value)}`);
    }

    function assign(session: Session, path: string[], raw: string): void {
        const current = valueAt(config, path);
        if (current === undefined && !isBlock(valueAt(config, path.slice(0, -1)))) {
            session.chat.text(`${PREFIX} §cNo such setting: §f${dotted(path)}`);
            return;
        }
        if (isBlock(current)) {
            session.chat.text(`${PREFIX} §f${dotted(path)} §7is a block, not a value. Open it with §f${prefix}config`);
            return;
        }
        const result = coerce(current, raw);
        if ("error" in result) {
            session.chat.text(`${PREFIX} §c${result.error}`);
            return;
        }
        applyValue(session, path, result.value);
    }

    return {
        open,
        show,
        assign,
        takeChat,
        editing: (session) => Boolean(sessions.get(session.id)?.pending),
        cancel: (session) => {
            const state = sessions.get(session.id);
            if (!state?.pending) return false;
            const pending = state.pending;
            state.pending = undefined;
            session.chat.text(`${PREFIX} §7Left §f${dotted(pending.path)} §7alone.`);
            open(session, pending.back, pending.page);
            return true;
        },
        forget: (id) => {
            sessions.get(id)?.menu?.close();
            sessions.delete(id);
        },
    };
}

export function parsePath(text: string): string[] {
    return text
        .split(/[.\/]/)
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
}

export function resolvePath(config: Config, parts: string[]): string[] | undefined {
    const path: string[] = [];
    let node: unknown = config;
    for (const part of parts) {
        if (!isBlock(node)) return undefined;
        const key = Object.keys(node).find((candidate) => candidate.toLowerCase() === part.toLowerCase());
        if (key === undefined) return undefined;
        path.push(key);
        node = node[key];
    }
    return path;
}
