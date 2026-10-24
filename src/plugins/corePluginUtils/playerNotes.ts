// personal player notes
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { PREFIX, component, type ChatPart } from "../../core/chat";
import { actionName, hasNpcRank, isFakeUuid } from "../../core/lobby";
import type { PlayerRef, PluginApi, Session } from "../../core/types";
import { stripColorCodes } from "../../util/mcColors";
import { fromBase } from "../../util/paths";

const INITIAL_DUMP_MS = 5_000;
const JOIN_BATCH_MAX = 8;
const HOVER_WIDTH = 40; // 1.8 tooltips dont autowrap

const NAME_RE = /^[A-Za-z0-9_]{1,16}$/;
const UUID_RE = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
const LEADING_NAME = /^(?:\[[^\]]*\]\s*)*([A-Za-z0-9_]{1,16})\b/;
const FRIENDS_HOVER = /friends for/i;

interface NotesConfig {
    enabled?: boolean;
    file?: string;
    friendsListHover?: boolean;
    alerts?: { enabled?: boolean; onJoin?: boolean; onLobby?: boolean; repeatSeconds?: number };
}

interface Note {
    text: string;
    at: number;
}

interface Entry {
    uuid?: string;
    name: string;
    notes: Note[];
}

interface NotesFile {
    players?: Record<string, Entry>;
    nicks?: Record<string, Entry>;
}

interface HoverEvent {
    action?: string;
    value?: unknown;
}

interface ChatNode {
    text?: unknown;
    extra?: unknown;
    hoverEvent?: HoverEvent;
    clickEvent?: { action?: string; value?: unknown };
}

const undash = (uuid: string): string => String(uuid).replace(/-/g, "").toLowerCase();
const realUuid = (uuid: string | undefined): string | undefined =>
    uuid && UUID_RE.test(uuid) && !isFakeUuid(uuid) ? undash(uuid) : undefined;

function formatDate(millis: number): string {
    const date = new Date(Number(millis));
    return Number.isNaN(date.getTime()) ? "unknown" : date.toISOString().slice(0, 10);
}

function wrap(text: string, width: number): string[] {
    const lines: string[] = [];
    let line = "";
    for (const word of text.split(/\s+/).filter(Boolean)) {
        if (line && line.length + word.length + 1 > width) {
            lines.push(line);
            line = word;
        } else {
            line = line ? `${line} ${word}` : word;
        }
    }
    if (line) lines.push(line);
    return lines;
}

// hover lines for friends list
function noteLines(entry: Entry): string[] {
    const lines: string[] = [];
    for (const note of entry.notes) {
        wrap(note.text, HOVER_WIDTH).forEach((line, i) => lines.push(i === 0 ? `§8• §f${line}` : `  §f${line}`));
        lines.push(`§8 - added ${formatDate(note.at)}`);
    }
    return lines;
}

function plainText(node: unknown): string {
    if (node === null || node === undefined) return "";
    if (typeof node === "string") return node;
    if (Array.isArray(node)) return node.map(plainText).join("");
    const chat = node as ChatNode;
    return (typeof chat.text === "string" ? chat.text : "") + plainText(chat.extra);
}

function appendHover(hover: HoverEvent, text: string): void {
    const tail = { text };
    const value = hover.value;
    if (typeof value === "string") hover.value = { text: value, extra: [tail] };
    else if (Array.isArray(value)) value.push(tail);
    else if (value && typeof value === "object") {
        const node = value as ChatNode;
        node.extra = [...(Array.isArray(node.extra) ? node.extra : []), tail];
    } else hover.value = tail;
}

export function registerPlayerNotes(api: PluginApi): void {
    const config = (api.pluginConfig.playerNotes ?? {}) as NotesConfig;
    if (config.enabled === false) return;
    const commandPrefix = api.config.commandPrefix;
    const alerts = { enabled: true, onJoin: true, onLobby: true, repeatSeconds: 300, ...(config.alerts ?? {}) };
    const repeatMs = Math.max(0, Number(alerts.repeatSeconds ?? 300)) * 1000;
    const fileSetting = String(config.file || "./playernotes.json");
    const file = isAbsolute(fileSetting) ? fileSetting : fromBase(fileSetting);

    // store
    const players = new Map<string, Entry>(); // undashed uuid to entry
    const nicks = new Map<string, Entry>(); // lowercase name to entry

    function load(): void {
        try {
            if (!existsSync(file)) return;
            const raw = JSON.parse(readFileSync(file, "utf-8")) as NotesFile;
            for (const [uuid, entry] of Object.entries(raw.players ?? {})) {
                if (!entry?.notes?.length) continue;
                players.set(undash(uuid), { uuid: undash(uuid), name: String(entry.name ?? uuid), notes: entry.notes });
            }
            for (const [name, entry] of Object.entries(raw.nicks ?? {})) {
                if (!entry?.notes?.length) continue;
                nicks.set(name.toLowerCase(), { name: String(entry.name ?? name), notes: entry.notes });
            }
            api.log.info(`loaded notes on ${players.size + nicks.size} player(s)`);
        } catch (error) {
            api.log.warn(`could not read ${file}: ${error}`);
        }
    }

    function save(): void {
        const out: NotesFile = {
            players: Object.fromEntries([...players].filter(([, entry]) => entry.notes.length > 0)),
            nicks: Object.fromEntries([...nicks].filter(([, entry]) => entry.notes.length > 0)),
        };
        try {
            mkdirSync(dirname(file), { recursive: true });
            // safe write
            writeFileSync(`${file}.tmp`, JSON.stringify(out, null, 2));
            renameSync(`${file}.tmp`, file);
        } catch (error) {
            api.log.error(`could not write ${file}: ${error}`);
        }
    }

    load();

    const byLastName = (name: string): Entry | undefined => {
        const lower = name.toLowerCase();
        for (const entry of players.values()) if (entry.name.toLowerCase() === lower) return entry;
        return undefined;
    };

    // a real uuid only ever matches its own entry, nick notes are for names hypixel hides behind a fake one
    function entryFor(player: PlayerRef): Entry | undefined {
        const uuid = realUuid(player.uuid);
        if (uuid) return players.get(uuid);
        return nicks.get(player.name.toLowerCase()) ?? (player.uuid ? undefined : byLastName(player.name));
    }

    // keep the stored name current, its what the friends list and //note <name> match on
    function rename(entry: Entry, name: string): void {
        if (!entry.uuid || !NAME_RE.test(name) || entry.name === name) return;
        api.log.debug(`notes: ${entry.name} is now ${name}`);
        entry.name = name;
        save();
    }

    type Resolved = { uuid?: string; name: string } | { error: string };

    async function mojang(name: string): Promise<Resolved> {
        const result = await api.http.send<{ id?: string; name?: string }>(
            `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(name)}`,
            "GET",
        );
        if (result.ok && result.data?.id) return { uuid: undash(result.data.id), name: result.data.name ?? name };
        if (result.status === 404 || result.status === 204) return { name }; // no acc, nick (not perfect cause some players can exist with a mojang acc but never logging on)
        return { error: `could not reach mojang (${result.status || "no response"})` };
    }

    // check lobby first then mojang
    async function resolve(session: Session, name: string): Promise<Resolved> {
        const inTab = session.findPlayer(name);
        if (inTab) {
            const uuid = realUuid(inTab.uuid);
            return uuid ? { uuid, name: inTab.name } : { name: inTab.name };
        }
        return mojang(name);
    }

    // an existing entry for a name typed in a command, without hitting mojang when we can help it
    async function find(session: Session, name: string): Promise<Entry | undefined> {
        const inTab = session.findPlayer(name);
        if (inTab) {
            const entry = entryFor(inTab);
            if (entry) return entry;
        }
        const local = byLastName(name) ?? nicks.get(name.toLowerCase());
        if (local) return local;
        const resolved = await mojang(name); // maybe they changed names since
        return "uuid" in resolved && resolved.uuid ? players.get(resolved.uuid) : undefined;
    }

    // chat
    const notesTooltip = (entry: Entry, title = true): string =>
        [...(title ? [`§e✎ Notes on §f${entry.name}`] : []), ...noteLines(entry)].join("\n");

    function alertLine(entry: Entry, name: string, verb: string): Record<string, unknown> {
        const first = entry.notes[0];
        const parts: ChatPart[] = [
            { text: `${PREFIX} `, color: "dark_gray" },
            { text: "✎ ", color: "yellow" },
            {
                text: name,
                color: "white",
                tooltip: `§7Manage notes with §f${commandPrefix}note ${name}`,
                runCommand: `${commandPrefix}note view ${name}`,
            },
            { text: ` ${verb} `, color: "gray" },
            { text: "- ", color: "dark_gray" },
            { text: first.text, color: "yellow", tooltip: notesTooltip(entry) },
        ];
        if (entry.notes.length > 1) {
            parts.push({ text: ` (+${entry.notes.length - 1} more)`, color: "dark_gray", tooltip: notesTooltip(entry) });
        }
        return component(parts);
    }

    function showNotes(session: Session, entry: Entry): void {
        const kind = entry.uuid ? "" : " §8(nick)";
        session.chat.text(`${PREFIX} §e✎ Notes on §f${entry.name}${kind}`);
        entry.notes.forEach((note, i) => {
            session.chat.raw(
                component([
                    { text: `  ${i + 1}. `, color: "dark_gray" },
                    { text: note.text + ` §8(added ${formatDate(note.at)})`, color: "white" },
                    { text: " " },
                    {
                        text: "[✕]",
                        color: "red",
                        tooltip: "§cRemove note",
                        runCommand: `${commandPrefix}note remove ${entry.name} ${i + 1}`,
                    },
                ]),
            );
        });
    }

    // alerts
    interface AlertState {
        alerted: Map<string, number>;
        serverAt: number;
    }

    const sessions = new Map<string, AlertState>();

    function stateFor(id: string): AlertState {
        let state = sessions.get(id);
        if (!state) {
            state = { alerted: new Map(), serverAt: Date.now() };
            sessions.set(id, state);
        }
        return state;
    }

    function alertFor(session: Session, player: PlayerRef, verb: string): void {
        if (!alerts.enabled || !player?.name) return;
        if (player.name.toLowerCase() === session.username.toLowerCase()) return;
        const entry = entryFor(player);
        if (!entry || entry.notes.length === 0) return;
        rename(entry, player.name);

        const state = stateFor(session.id);
        const alertKey = entry.uuid ?? `nick:${entry.name.toLowerCase()}`;
        if (Date.now() - (state.alerted.get(alertKey) ?? 0) < repeatMs) return;
        state.alerted.set(alertKey, Date.now());
        session.chat.raw(alertLine(entry, player.name, verb));
    }

    // find friend list
    function friendFor(node: ChatNode): Entry | undefined {
        const click = typeof node.clickEvent?.value === "string" ? node.clickEvent.value.trim().split(/\s+/) : [];
        const arg = click.length > 1 ? click[click.length - 1] : undefined;
        const uuid = arg ? realUuid(arg) : undefined;
        if (uuid) return players.get(uuid);

        const name = LEADING_NAME.exec(stripColorCodes(plainText(node)).trim())?.[1] ?? (arg && NAME_RE.test(arg) ? arg : undefined);
        return name ? (byLastName(name) ?? nicks.get(name.toLowerCase())) : undefined;
    }

    function decorateFriends(node: unknown): boolean {
        if (!node || typeof node !== "object") return false;
        if (Array.isArray(node)) return node.map(decorateFriends).some(Boolean);
        const chat = node as ChatNode;
        let changed = false;
        const hover = chat.hoverEvent;
        if (hover?.action === "show_text" && FRIENDS_HOVER.test(stripColorCodes(plainText(hover.value)))) {
            const entry = friendFor(chat);
            if (entry && entry.notes.length > 0) {
                appendHover(hover, `\n\n${notesTooltip(entry)}`);
                changed = true;
            }
        }
        if (decorateFriends(chat.extra)) changed = true;
        return changed;
    }

    api.on("serverPacket", (name, data, session) => {
        try {
            if (name === "login") {
                stateFor(session.id).serverAt = Date.now();
                return;
            }

            // the proxy writes data.message after this event, so rewriting it here sticks
            if (name === "chat") {
                if (config.friendsListHover === false || (players.size === 0 && nicks.size === 0)) return;
                if (typeof data.message !== "string" || !/riends for/i.test(data.message)) return;
                const parsed = JSON.parse(data.message) as unknown;
                if (decorateFriends(parsed)) data.message = JSON.stringify(parsed);
                return;
            }

            if (!alerts.enabled || name !== "player_info" || actionName(data.action) !== "add_player") return;
            const state = stateFor(session.id);
            const entries = (data.data ?? []) as Array<{ uuid?: string; UUID?: string; name?: string; displayName?: unknown }>;
            const dump = entries.length > JOIN_BATCH_MAX || Date.now() - state.serverAt < INITIAL_DUMP_MS;
            if (dump ? !alerts.onLobby : !alerts.onJoin) return;

            for (const entry of entries) {
                const uuid = entry.uuid ?? entry.UUID;
                if (!entry.name || !uuid || !NAME_RE.test(entry.name)) continue;
                if (hasNpcRank(entry.displayName)) continue;
                alertFor(session, { name: entry.name, uuid }, dump ? "is in your lobby" : "joined");
            }
        } catch (error) {
            api.log.debug(`notes: ${name} handling failed: ${error}`);
        }
    });


    api.on("playerDetected", (player, source, session) => {
        if (source === "ME" || session.isNpc(player.name)) return;
        alertFor(session, player, "is here");
    });

    api.on("sessionEnd", (session) => sessions.delete(session.id));
    api.onCleanup(() => sessions.clear());

    // command
    function usage(session: Session): void {
        const p = `${commandPrefix}note`;
        session.chat.text(`${PREFIX} §7Player notes:`);
        session.chat.text(`  §f${p} <player> §8- §7show notes on a player`);
        session.chat.text(`  §f${p} add <player> <text> §8- §7add a note`);
        session.chat.text(`  §f${p} nick <name> <text> §8- §7add a note to a nick`);
        session.chat.text(`  §f${p} list §8- §7everyone you have notes on`);
    }

    function addNote(session: Session, target: { uuid?: string; name: string }, text: string): void {
        let entry = target.uuid ? players.get(target.uuid) : nicks.get(target.name.toLowerCase());
        if (!entry) {
            entry = { uuid: target.uuid, name: target.name, notes: [] };
            if (target.uuid) players.set(target.uuid, entry);
            else nicks.set(target.name.toLowerCase(), entry);
        }
        if (target.uuid) entry.name = target.name;
        entry.notes.push({ text, at: Date.now() });
        save();
        const kind = target.uuid ? "" : " §8(saved as a nick, matched by name)";
        session.chat.text(`${PREFIX} §aNoted §f${entry.name}§a: §f${text}${kind}`);
    }

    function RemoveNote(session: Session, entry: Entry, index: number): void {
        if (index < 1 || index > entry.notes.length) {
            session.chat.text(`${PREFIX} §cInvalid note number, must be between 1 and ${entry.notes.length}`);
            return;
        }
        const [removed] = entry.notes.splice(index - 1, 1);
        save();
        session.chat.text(`${PREFIX} §aRemoved note §f${removed.text}§a from §f${entry.name}`);
    }

    function listAll(session: Session): void {
        const all = [...players.values(), ...nicks.values()].sort((a, b) => a.name.localeCompare(b.name));
        if (all.length === 0) {
            session.chat.text(`${PREFIX} §7No notes yet. Add one with §f${commandPrefix}note add <player> <text>`);
            return;
        }
        session.chat.text(`${PREFIX} §7Notes on §f${all.length} §7player(s):`);
        for (const entry of all) {
            session.chat.raw(
                component([
                    { text: "  • ", color: "dark_gray" },
                    {
                        text: entry.name,
                        color: "white",
                        tooltip: notesTooltip(entry),
                        runCommand: `${commandPrefix}note view ${entry.name}`,
                    },
                    { text: ` ${entry.notes.length} note${entry.notes.length === 1 ? "" : "s"}`, color: "gray" },
                    ...(entry.uuid ? [] : [{ text: " (nick)", color: "dark_gray" as const }]),
                ]),
            );
        }
    }

    api.registerCommand(
        "note",
        async (args, session) => {
            const [first, name, ...rest] = args;
            const sub = first?.toLowerCase();
            if (!sub) return usage(session);
            if (sub === "list") return listAll(session);

            if (sub === "add" || sub === "nick") {
                const text = rest.join(" ").trim();
                if (!name || !NAME_RE.test(name) || !text) return usage(session);
                if (sub === "nick") return addNote(session, { name }, text);
                const target = await resolve(session, name);
                if ("error" in target) {
                    session.chat.text(`${PREFIX} §cCould not look up §f${name}§c, ${target.error}.`);
                    session.chat.text(`  §7Use §f${commandPrefix}note nick ${name} <text> §7to save it by name instead.`);
                    return;
                }
                return addNote(session, target, text);
            }

            if (sub === "remove") {
                const index = Number(rest[0]);
                if (!name || !NAME_RE.test(name) || !index) return usage(session);
                const entry = await find(session, name);
                if (!entry) {
                    session.chat.text(`${PREFIX} §7No notes on §f${name}§7. Add one with §f${commandPrefix}note add ${name} <text>`);
                    return;
                }
                return RemoveNote(session, entry, index);
            }

            const target = sub === "view" ? name : first;
            if (!target) return usage(session);
            const entry = await find(session, target);
            if (!entry) {
                session.chat.text(`${PREFIX} §7No notes on §f${target}§7. Add one with §f${commandPrefix}note add ${target} <text>`);
                return;
            }
            showNotes(session, entry);
        },
        "add notes to players, shown when they join: //note <player|add|nick|list>",
    );
}
