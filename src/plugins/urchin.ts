import { PREFIX, component, type ChatPart } from "../core/chat";
import { actionName, hasNpcRank, isFakeUuid } from "../core/lobby";
import { COLOR_CODES, type McColorName } from "../util/mcColors";
import type { Plugin, PlayerRef, Session, Tag } from "../core/types";
import { TtlCache } from "../util/ttlCache";

// blacklist tags from urchin (coral) api
const URCHIN_BASE = "https://api.urchin.gg";

const BATCH_LIMIT = 100; // what urchins POST /v3/players takes in one go
const BATCH_DELAY_MS = 120; 
const FAILED_TTL_MS = 10_000; 
const RATELIMIT_COOLDOWN_MS = 30_000; 

const INITIAL_DUMP_MS = 5_000;
const JOIN_BATCH_MAX = 8;

const TAG_PRIORITY = 100; 

// how a tag urchin tag is drawn
const STYLES: Record<string, StyleConfig> = {
    confirmed_cheater: { label: "CHEATER", short: "C", color: "dark_red" },
    suspected_cheater: { label: "SUS", short: "S", color: "red" },
    blatant_cheater: { label: "BLATANT", short: "B", color: "dark_red" },
    cheater: { label: "CHEATER", short: "C", color: "dark_red" },
    sniper: { label: "SNIPER", short: "SN", color: "red" },
    caution: { label: "CAUTION", short: "!", color: "yellow" },
};

const FALLBACK_COLOR: McColorName = "red";

interface StyleConfig {
    label?: string;
    short?: string;
    color?: string;
}

interface AlertConfig {
    enabled?: boolean;
    onJoin?: boolean;
    onLobby?: boolean;
    repeatSeconds?: number;
}

interface UrchinConfig {
    enabled?: boolean;
    apiKey?: string;
    baseUrl?: string;
    cacheTtlSeconds?: number;
    timeoutMs?: number;
    ignoreTypes?: string[];
    types?: Record<string, StyleConfig>;
    alerts?: AlertConfig;
    disableInLobby?: boolean; // skip background lookups and alerts while in a lobby to save ratelimit
}

interface UrchinTag {
    tag_type?: string;
    reason?: string;
    added_by_username?: string;
    hide_username?: boolean;
    added_on?: number;
    expires_at?: number;
}

interface Hit {
    source: "urchin";
    label: string;
    short: string;
    color: McColorName;
    tooltip: string;
    priority: number;
    alertable: boolean;
}

interface SourceState {
    name: string;
    disabled: boolean;
    cooldownUntil: number;
}

const stripDashes = (uuid: string): string => String(uuid).replace(/-/g, "").toLowerCase();

function titleCase(type: string): string {
    return String(type).replace(/[_-]+/g, " ").trim().toUpperCase();
}

// initials used for short tag in nametag
function initials(type: string): string {
    const words = String(type).split(/[\s_-]+/).filter(Boolean);
    return words.map((word) => word[0].toUpperCase()).join("") || "?";
}

function formatDate(millis: number | undefined): string {
    if (!millis) return "unknown";
    const date = new Date(Number(millis));
    return Number.isNaN(date.getTime()) ? "unknown" : date.toISOString().slice(0, 10);
}

export const urchinPlugin: Plugin = {
    name: "urchin",
    version: "1.2.0",
    description: "Urchin blacklist tags on names, and a chat alert when a flagged player turns up.",

    defaultConfig: {
        enabled: true,
        apiKey: "", // urchin key
        baseUrl: URCHIN_BASE,
        cacheTtlSeconds: 600,
        timeoutMs: 6000,
        ignoreTypes: [], 
        types: {}, 
        disableInLobby: false,
        alerts: {
            enabled: true,
            onJoin: true, 
            onLobby: true, 
            repeatSeconds: 300, 
        },
    },

    setup(api) {
        const config = api.pluginConfig as UrchinConfig;

        if (!config.apiKey) {
            api.log.warn("no api key set, blacklist tags are off (builtInPlugins.urchin.apiKey)");
            return;
        }

        const urchinBase = String(config.baseUrl || URCHIN_BASE).replace(/\/+$/, "");
        const ttl = Math.max(0, Number(config.cacheTtlSeconds ?? 600)) * 1000;
        const timeout = Number(config.timeoutMs ?? 6000);
        const ignored = new Set((config.ignoreTypes ?? []).map((type) => String(type).toLowerCase()));
        const styles: Record<string, StyleConfig> = { ...STYLES, ...(config.types ?? {}) };
        const alerts = { enabled: true, onJoin: true, onLobby: true, repeatSeconds: 300, ...(config.alerts ?? {}) };
        const repeatMs = Math.max(0, Number(alerts.repeatSeconds ?? 300)) * 1000;
        const commandPrefix = api.config.commandPrefix;

        const urchin: SourceState = { name: "urchin", disabled: !config.apiKey, cooldownUntil: 0 };
        const anyLive = () => !urchin.disabled;

        function checkFatal(source: SourceState, status: number): boolean {
            if (status !== 401 && status !== 403) return false;
            source.disabled = true;
            api.log.warn(`${source.name} rejected the api key, its tags stay off until thats fixed`);
            return true;
        }

        async function request<T>(
            source: SourceState,
            method: "GET" | "POST",
            url: string,
            headers: Record<string, string>,
            json?: unknown,
        ): Promise<{ ok: boolean; fatal: boolean; status: number; data: T | null }> {
            if (source.disabled) return { ok: false, fatal: true, status: 0, data: null };
            if (source.cooldownUntil > Date.now()) throw new Error(`${source.name} is ratelimited`);

            const result = await api.http.send<T>(url, method, { headers, json, timeout });

            if (checkFatal(source, result.status)) return { ok: false, fatal: true, status: result.status, data: null };
            if (result.status === 429) {
                const retryAfter = Number(result.headers["retry-after"]) * 1000;
                source.cooldownUntil =
                    Date.now() + (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : RATELIMIT_COOLDOWN_MS);
                api.log.debug(
                    `${source.name} ratelimited, backing off for ${Math.round((source.cooldownUntil - Date.now()) / 1000)}s`,
                );
                throw new Error(`${source.name} is ratelimited`);
            }
            return { ok: result.ok, fatal: false, status: result.status, data: result.data };
        }

        const cache = new TtlCache<Promise<unknown>>({ defaultTtl: ttl, maxEntries: 2048 });

        function cached<T>(cacheKey: string, run: () => Promise<T>): Promise<T> {
            const hit = cache.get(cacheKey);
            if (hit) return hit as Promise<T>;

            const promise = run().then(
                (value) => {
                    cache.set(cacheKey, promise, ttl);
                    return value;
                },
                (error) => {
                    // failures stay cached briefly so a broken key does not hammer the api
                    cache.set(cacheKey, promise, FAILED_TTL_MS);
                    throw error;
                },
            );
            promise.catch(() => {}); // whoever asked handles it, this just keeps node quiet
            cache.set(cacheKey, promise, ttl);
            return promise;
        }

        // urchin
        interface Waiter {
            resolve(tags: UrchinTag[]): void;
            reject(error: unknown): void;
        }

        const queue = new Map<string, Waiter[]>(); // undashed uuid -> waiters
        let batchTimer: NodeJS.Timeout | null = null;
        let flushing = false;

        function enqueue(uuid: string): Promise<UrchinTag[]> {
            return new Promise<UrchinTag[]>((resolve, reject) => {
                let waiters = queue.get(uuid);
                if (!waiters) {
                    waiters = [];
                    queue.set(uuid, waiters);
                }
                waiters.push({ resolve, reject });

                if (queue.size >= BATCH_LIMIT) {
                    void flush();
                } else if (!batchTimer) {
                    batchTimer = setTimeout(() => {
                        batchTimer = null;
                        void flush();
                    }, BATCH_DELAY_MS);
                    batchTimer.unref?.();
                }
            });
        }

        async function flush(): Promise<void> {
            if (flushing) return;
            flushing = true;
            if (batchTimer) {
                clearTimeout(batchTimer);
                batchTimer = null;
            }
            try {
                while (queue.size) {
                    const batch = [...queue.entries()].slice(0, BATCH_LIMIT);
                    for (const [uuid] of batch) queue.delete(uuid);
                    await runBatch(batch);
                }
            } finally {
                flushing = false;
            }
        }

        async function runBatch(batch: Array<[string, Waiter[]]>): Promise<void> {
            const uuids = batch.map(([uuid]) => uuid);
            try {
                const result = await request<{ players?: Record<string, UrchinTag[]> }>(
                    urchin,
                    "POST",
                    `${urchinBase}/v3/players`,
                    { "x-api-key": config.apiKey ?? "" },
                    { uuids },
                );
                if (!result.ok) {
                    // failed keys are not worth it
                    if (result.fatal) return settle(batch, () => []);
                    throw new Error(`urchin batch lookup failed with ${result.status}`);
                }
                const players = new Map(
                    Object.entries(result.data?.players ?? {}).map(([id, tags]) => [stripDashes(id), tags ?? []]),
                );
                settle(batch, (uuid) => players.get(uuid) ?? []);
            } catch (error) {
                for (const [, waiters] of batch) for (const waiter of waiters) waiter.reject(error);
            }
        }

        function settle(batch: Array<[string, Waiter[]]>, tagsFor: (uuid: string) => UrchinTag[]): void {
            for (const [uuid, waiters] of batch) {
                const tags = tagsFor(uuid);
                for (const waiter of waiters) waiter.resolve(tags);
            }
        }

        async function lookupName(name: string): Promise<UrchinTag[]> {
            const result = await request<{ tags?: UrchinTag[] }>(
                urchin,
                "GET",
                `${urchinBase}/v3/player/tags?player=${encodeURIComponent(name)}`,
                { "x-api-key": config.apiKey ?? "" },
            );
            if (result.fatal) return [];
            if (result.status === 404) return []; 
            if (!result.ok) throw new Error(`urchin lookup for ${name} failed with ${result.status}`);
            return result.data?.tags ?? [];
        }

        // every tag urchin holds on a player, cached, throwing on anything worth a retry
        function urchinTagsFor(player: PlayerRef): Promise<UrchinTag[]> {
            if (urchin.disabled) return Promise.resolve([]);
            const uuid = player.uuid ? stripDashes(player.uuid) : undefined;
            if (uuid && uuid.length === 32) {
                if (isFakeUuid(uuid)) return Promise.resolve([]); // unknown player, nicked, or an npc
                return cached(`u:${uuid}`, () => enqueue(uuid));
            }
            return cached(`un:${player.name.toLowerCase()}`, () => lookupName(player.name));
        }

        // tag styling
        function styleFor(type: string): { label: string; short: string; color: McColorName } {
            const style = styles[String(type).toLowerCase()] ?? {};
            const color = String(style.color ?? "").toLowerCase();
            return {
                label: style.label ?? titleCase(type),
                short: style.short ?? style.label ?? initials(type),
                // a color the renderer doesnt know would end up printed as text
                color: (color in COLOR_CODES ? color : FALLBACK_COLOR) as McColorName,
            };
        }

        // what urchin sent, minus the types we were told to ignore and the ones
        // whose ban already ran out
        function usable(tags: UrchinTag[] | null | undefined): UrchinTag[] {
            const now = Date.now();
            return (tags ?? []).filter(
                (tag) =>
                    tag?.tag_type &&
                    !ignored.has(String(tag.tag_type).toLowerCase()) &&
                    !(tag.expires_at && tag.expires_at <= now),
            );
        }

        function urchinTooltip(tag: UrchinTag): string {
            const who = tag.hide_username ? "hidden" : (tag.added_by_username ?? "unknown");
            const lines = [
                `§f${titleCase(tag.tag_type ?? "")}`,
                `§7${tag.reason || "no reason given"}`,
                `§8added by ${who} on ${formatDate(tag.added_on)}`,
            ];
            if (tag.expires_at) lines.push(`§8expires ${formatDate(tag.expires_at)}`);
            lines.push("§8via urchin");
            return lines.join("\n");
        }

        function urchinHits(tags: UrchinTag[]): Hit[] {
            return usable(tags).map((tag) => {
                const style = styleFor(tag.tag_type ?? "");
                return {
                    source: "urchin" as const,
                    label: style.label,
                    short: style.short,
                    color: style.color,
                    tooltip: urchinTooltip(tag),
                    priority: TAG_PRIORITY,
                    alertable: true,
                };
            });
        }

        async function hitsFor(player: PlayerRef): Promise<Hit[]> {
            return urchinHits(await urchinTagsFor(player));
        }

        api.registerEnricher({
            name: "urchin",
            async enrich(player, ctx) {
                if (!anyLive()) return null;
                if (config.disableInLobby && ctx.session?.lobby) return null; // hold off, save the ratelimit for games
                return (await hitsFor(player)).map(
                    (hit): Tag => ({
                        text: hit.label,
                        short: hit.short,
                        color: hit.color,
                        prefix: true, 
                        priority: hit.priority,
                        tooltip: hit.tooltip,
                    }),
                );
            },
        });

        // alerts
        interface AlertState {
            alerted: Map<string, number>;
            pending: Set<string>;
            serverAt: number;
        }

        const sessions = new Map<string, AlertState>();

        function stateFor(id: string): AlertState {
            let state = sessions.get(id);
            if (!state) {
                state = { alerted: new Map(), pending: new Set(), serverAt: Date.now() };
                sessions.set(id, state);
            }
            return state;
        }

        // joined line creator
        function alertLine(name: string, hits: Hit[], verb: string): Record<string, unknown> {
            const parts: ChatPart[] = [
                { text: `${PREFIX} `, color: "dark_gray" },
                { text: "⚠ ", color: "red" },
                {
                    text: name,
                    color: "white",
                    tooltip: `§7Look up §f${name}§7 with §f${commandPrefix}urchin`,
                    runCommand: `${commandPrefix}urchin ${name}`,
                },
                { text: ` ${verb} `, color: "gray" },
                { text: "- ", color: "dark_gray" },
            ];
            hits.forEach((hit, i) => {
                if (i > 0) parts.push({ text: ", ", color: "dark_gray" });
                parts.push({ text: hit.label, color: hit.color, tooltip: hit.tooltip });
            });
            return component(parts);
        }

        async function alertFor(session: Session, player: PlayerRef, verb: string): Promise<void> {
            if (!alerts.enabled || !anyLive()) return;
            if (config.disableInLobby && session.lobby) return; // hold off, save the ratelimit for games
            if (!player?.name || session.isNpc(player.name)) return;
            if (player.name.toLowerCase() === session.username.toLowerCase()) return;

            const state = stateFor(session.id);
            const alertKey = player.uuid ? stripDashes(player.uuid) : player.name.toLowerCase();
            if (state.pending.has(alertKey)) return; 
            if (Date.now() - (state.alerted.get(alertKey) ?? 0) < repeatMs) return;

            state.pending.add(alertKey);
            try {
                const hits = (await hitsFor(player)).filter((hit) => hit.alertable);
                if (hits.length === 0) return;
                state.alerted.set(alertKey, Date.now());
                session.chat.raw(alertLine(player.name, hits, verb));
            } catch (error) {
                api.log.debug(`alert lookup for ${player.name} failed: ${error}`);
            } finally {
                state.pending.delete(alertKey);
            }
        }

        api.on("serverPacket", (name, data, session) => {
            if (!alerts.enabled) return;
            try {
                if (name === "login") {
                    // server move
                    stateFor(session.id).serverAt = Date.now();
                    return;
                }
                if (name !== "player_info" || actionName(data.action) !== "add_player") return;

                const state = stateFor(session.id);
                const entries = (data.data ?? []) as Array<{ uuid?: string; UUID?: string; name?: string; displayName?: unknown }>;
                const dump = entries.length > JOIN_BATCH_MAX || Date.now() - state.serverAt < INITIAL_DUMP_MS;
                if (dump ? !alerts.onLobby : !alerts.onJoin) return;

                for (const entry of entries) {
                    const rawUuid = entry.uuid ?? entry.UUID;
                    if (!entry.name || !rawUuid) continue;
                    if (!/^[A-Za-z0-9_]{1,16}$/.test(entry.name)) continue; // voodoo hypixel magic cancer bullshit
                    if (hasNpcRank(entry.displayName)) continue;
                    void alertFor(
                        session,
                        { name: entry.name, uuid: stripDashes(rawUuid) },
                        dump ? "is in your lobby" : "joined",
                    );
                }
            } catch (error) {
                api.log.debug(`${name} handling failed: ${error}`);
            }
        });
        
        // verbs for the alert line, keyed by the source of the detection
        const VERBS: Record<string, string> = {
            PARTY: "is in your party",
            CHAT: "turned up in chat",
            MANUAL: "is flagged",
        };
        api.on("playerDetected", (player, source, session) => {
            if (source === "ME") return;
            void alertFor(session, player, VERBS[source] ?? "is in your game");
        });

        api.on("sessionEnd", (session) => sessions.delete(session.id));

        api.onCleanup(() => {
            if (batchTimer) {
                clearTimeout(batchTimer);
                batchTimer = null;
            }
            // nobody is waiting on these lookups anymore, hand back empty tags
            for (const waiters of queue.values()) for (const waiter of waiters) waiter.resolve([]);
            queue.clear();
            cache.dispose();
            sessions.clear();
        });

        const target = (args: string[], session: Session): PlayerRef => {
            const name = args[0] ?? session.username;
            return session.findPlayer(name) ?? { name };
        };

        api.registerCommand(
            "urchin",
            async (args, session) => {
                if (!anyLive()) {
                    session.chat.text(`${PREFIX} §cBlacklist lookups are off, the api key was rejected.`);
                    return;
                }
                const player = target(args, session);
                session.chat.text(`${PREFIX} §7Looking up §f${player.name}§7...`);
                try {
                    const hits = await hitsFor(player);
                    if (hits.length === 0) {
                        session.chat.text(`${PREFIX} §f${player.name} §ais on no blacklist we can see.`);
                        return;
                    }
                    const heading = hits.map((hit) => COLOR_CODES[hit.color] + hit.label).join("§7, ");
                    session.chat.text(`${PREFIX} §f${player.name} §8- ${heading}`);
                    for (const hit of hits) {
                        const reason = hit.tooltip.split("\n")[1] ?? "§7no detail given";
                        session.chat.text(`  §8• ${COLOR_CODES[hit.color]}${hit.label} §8- ${reason} §8(${hit.source})`);
                    }
                } catch (error) {
                    session.chat.text(`${PREFIX} §cBlacklist lookup failed: §7${error}`);
                }
            },
            "look a player up on the Urchin blacklist",
        );

        const live = [urchin].filter((source) => !source.disabled).map((source) => source.name);
        api.log.info(
            `blacklist tags active via ${live.join(" + ")} (alerts: ${alerts.enabled ? "on" : "off"}, lobbies: ${config.disableInLobby ? "off" : "on"}, cache ${ttl / 1000}s)`,
        );
    },
};

export default urchinPlugin;
