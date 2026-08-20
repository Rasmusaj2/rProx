import { PREFIX, component, type ChatPart } from "../core/chat";
import { actionName, hasNpcRank, isFakeUuid } from "../core/lobby";
import { resolveUuid } from "../services/microsoft";
import { COLOR_CODES, COLOR_RGB, type McColorName } from "../util/mcColors";
import type { Plugin, PlayerRef, Session, Tag } from "../core/types";

// blacklist tags from urchin (coral) & seraph anticheater apis
const URCHIN_BASE = "https://api.urchin.gg";
const SERAPH_BASE = "https://api.seraph.si";

const BATCH_LIMIT = 100; // what urchins POST /v3/players takes in one go
const BATCH_DELAY_MS = 120; 
const FAILED_TTL_MS = 10_000; 
const RATELIMIT_COOLDOWN_MS = 30_000; 

const INITIAL_DUMP_MS = 5_000;
const JOIN_BATCH_MAX = 8;

const TAG_PRIORITY = 100; 
const SERAPH_PRIORITY = 99; 

// how a tag urchin tag is drawn
// seraph does not have specific tags, as the api returns with a color to use
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

interface SeraphConfig {
    enabled?: boolean;
    apiKey?: string;
    baseUrl?: string;
    scoreFactors?: string; // comma separated sniper score factors, passed through as ?score=
    scoreThreshold?: number; // sniper score worth a tag of its own, 0 turns that off
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
    seraph?: SeraphConfig;
}

interface UrchinTag {
    tag_type?: string;
    reason?: string;
    added_by_username?: string;
    hide_username?: boolean;
    added_on?: number;
    expires_at?: number;
}

interface SeraphTag {
    tag_name?: string;
    text?: string;
    tooltip?: string;
    color?: number;
    textColor?: number;
    icon?: string;
    alert?: boolean; 
}

interface SeraphResponse {
    error?: string;
    score?: { mode?: string; value?: number };
    tags?: SeraphTag[];
    timestamp?: string;
}

interface Hit {
    source: "urchin" | "seraph";
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
    const words = String(type).split(/[_-]+/).filter(Boolean);
    return words.map((word) => word[0].toUpperCase()).join("") || "?";
}

function formatDate(millis: number | undefined): string {
    if (!millis) return "unknown";
    const date = new Date(Number(millis));
    return Number.isNaN(date.getTime()) ? "unknown" : date.toISOString().slice(0, 10);
}

//seraph uses rgb colors 
function nearestColor(rgb: number | undefined): McColorName | undefined {
    if (typeof rgb !== "number" || !Number.isFinite(rgb)) return undefined;
    const r = (rgb >> 16) & 0xff;
    const g = (rgb >> 8) & 0xff;
    const b = rgb & 0xff;

    let best: McColorName | undefined;
    let bestDistance = Infinity;
    for (const [name, value] of Object.entries(COLOR_RGB) as [McColorName, number][]) {
        const dr = r - ((value >> 16) & 0xff); // bit shifts cause we get a hex number rather than a color object, shifting positions out give us the r, g, b values
        const dg = g - ((value >> 8) & 0xff);
        const db = b - (value & 0xff);
        const distance = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11; // wtf voodoo magic
        if (distance < bestDistance) {
            bestDistance = distance;
            best = name;
        }
    }
    return best;
}

export const urchinPlugin: Plugin = {
    name: "urchin",
    version: "1.1.0",
    description: "Urchin and Seraph blacklist tags on names, and a chat alert when a flagged player turns up.",

    defaultConfig: {
        enabled: true,
        apiKey: "", // urchin key
        baseUrl: URCHIN_BASE,
        cacheTtlSeconds: 600,
        timeoutMs: 6000,
        ignoreTypes: [], 
        types: {}, 
        alerts: {
            enabled: true,
            onJoin: true, 
            onLobby: true, 
            repeatSeconds: 300, 
        },
        seraph: {
            enabled: true,
            apiKey: "", // seraph key
            baseUrl: SERAPH_BASE,
            scoreFactors: "", 
            scoreThreshold: 0, 
        },
    },

    setup(api) {
        const config = api.pluginConfig as UrchinConfig;
        const seraphConfig = config.seraph ?? {};

        const urchinKey = String(config.apiKey ?? "").trim();
        const seraphKey = String(seraphConfig.apiKey ?? "").trim();
        const seraphWanted = seraphConfig.enabled !== false;

        if (!urchinKey && !(seraphWanted && seraphKey)) {
            api.log.warn(
                "no api keys set, blacklist tags are off (builtInPlugins.urchin.apiKey and/or builtInPlugins.urchin.seraph.apiKey)",
            );
            return;
        }

        const urchinBase = String(config.baseUrl || URCHIN_BASE).replace(/\/+$/, "");
        const seraphBase = String(seraphConfig.baseUrl || SERAPH_BASE).replace(/\/+$/, "");
        const ttl = Math.max(0, Number(config.cacheTtlSeconds ?? 600)) * 1000;
        const timeout = Number(config.timeoutMs ?? 6000);
        const ignored = new Set((config.ignoreTypes ?? []).map((type) => String(type).toLowerCase()));
        const styles: Record<string, StyleConfig> = { ...STYLES, ...(config.types ?? {}) };
        const alerts = { enabled: true, onJoin: true, onLobby: true, repeatSeconds: 300, ...(config.alerts ?? {}) };
        const repeatMs = Math.max(0, Number(alerts.repeatSeconds ?? 300)) * 1000;
        const scoreFactors = String(seraphConfig.scoreFactors ?? "").trim();
        const scoreThreshold = Number(seraphConfig.scoreThreshold ?? 0);
        const commandPrefix = api.config.commandPrefix;


        const urchin: SourceState = { name: "urchin", disabled: !urchinKey, cooldownUntil: 0 };
        const seraph: SourceState = { name: "seraph", disabled: !(seraphWanted && seraphKey), cooldownUntil: 0 };
        const anyLive = () => !urchin.disabled || !seraph.disabled;

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

        interface CacheEntry<T> {
            expires: number;
            promise: Promise<T>;
        }

        const cache = new Map<string, CacheEntry<unknown>>();

        function cached<T>(cacheKey: string, run: () => Promise<T>): Promise<T> {
            const hit = cache.get(cacheKey) as CacheEntry<T> | undefined;
            if (hit && hit.expires > Date.now()) return hit.promise;

            const entry: CacheEntry<T> = { expires: Date.now() + ttl, promise: undefined as unknown as Promise<T> };
            entry.promise = run().then(
                (value) => {
                    entry.expires = Date.now() + ttl;
                    return value;
                },
                (error) => {
                    entry.expires = Date.now() + FAILED_TTL_MS;
                    throw error;
                },
            );
            entry.promise.catch(() => {}); // whoever asked handles it, this just keeps node quiet
            cache.set(cacheKey, entry as CacheEntry<unknown>);
            return entry.promise;
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
                    { "x-api-key": urchinKey },
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
                { "x-api-key": urchinKey },
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

        // seraph
        // uses cubelify in documentation so thats what we used
        async function lookupSeraph(uuid: string): Promise<SeraphResponse | null> {
            const query = scoreFactors ? `?score=${encodeURIComponent(scoreFactors)}` : "";
            const result = await request<SeraphResponse>(
                seraph,
                "GET",
                `${seraphBase}/${uuid}/cubelify/blacklist${query}`,
                { "seraph-api-key": seraphKey },
            );
            if (result.fatal) return null;
            if (result.status === 400 || result.status === 404) return null; 
            if (!result.ok) throw new Error(`seraph lookup failed with ${result.status}`);
            // seraph can return 200s with an error (TERRIBLE API DESIGN)
            if (result.data?.error) {
                api.log.debug(`seraph returned an error for ${uuid}: ${result.data.error}`);
                return null;
            }
            return result.data;
        }

        // seraph is keyed by uuid only, so a name-only detection has to go through mojang
        // (unless we grab uuid directly from the server)
        function seraphFor(player: PlayerRef): Promise<SeraphResponse | null> {
            if (seraph.disabled) return Promise.resolve(null);
            const known = player.uuid ? stripDashes(player.uuid) : undefined;
            if (known && known.length === 32 && isFakeUuid(known)) return Promise.resolve(null); // nicked or npc

            const key = known ? `s:${known}` : `sn:${player.name.toLowerCase()}`;
            return cached(key, async () => {
                const uuid = known ?? (await resolveUuid(api.http, player.name).then((id) => (id ? stripDashes(id) : undefined)));
                if (!uuid) return null;
                return lookupSeraph(uuid);
            });
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

        function seraphTagHits(report: SeraphResponse | null): Hit[] {
            if (!report) return [];
            const hits: Hit[] = [];

            for (const tag of report.tags ?? []) {
                const name = String(tag.tag_name ?? tag.text ?? "").trim();
                if (!name) continue;
                if (ignored.has(name.toLowerCase())) continue;

                const label = String(tag.text ?? name).trim() || titleCase(name);
                const tooltip = [`§f${titleCase(name)}`, `§7${String(tag.tooltip ?? "").trim() || "no detail given"}`, "§8via seraph"]
                    .join("\n");

                hits.push({
                    source: "seraph",
                    label,
                    // seraph writes for a gui, so a label can be far too wide for a
                    // nametag prefix - initials stand in when it is
                    short: label.length <= 3 ? label : initials(name),
                    color: nearestColor(tag.color) ?? nearestColor(tag.textColor) ?? FALLBACK_COLOR,
                    tooltip,
                    priority: SERAPH_PRIORITY, 
                    alertable: tag.alert !== false,
                });
            }

            return hits;
        }

        // sniper isnt a flag here its a number so we only give it a tag if its above the threshold, and we dont want to show it if the score is missing or invalid
        function seraphScoreHit(report: SeraphResponse | null): Hit | null {
            const score = report?.score;
            if (scoreThreshold <= 0 || typeof score?.value !== "number") return null;
            if (score.value < scoreThreshold) return null;
            return {
                source: "seraph",
                label: `SNIPER ${Math.round(score.value * 100) / 100}`,
                short: "SS",
                color: "gold",
                tooltip: [
                    "§fSniper score",
                    `§7${score.value} §8(mode: ${score.mode || "default"})`,
                    `§8flags at ${scoreThreshold}, via seraph`,
                ].join("\n"),
                priority: SERAPH_PRIORITY,
                alertable: true,
            };
        }

        function seraphHits(report: SeraphResponse | null): Hit[] {
            const score = seraphScoreHit(report);
            return score ? [...seraphTagHits(report), score] : seraphTagHits(report);
        }

        // hit both proviers for one source but dont throw unless both fail, and combine the results
        async function hitsFor(player: PlayerRef): Promise<Hit[]> {
            const [urchinResult, seraphResult] = await Promise.allSettled([urchinTagsFor(player), seraphFor(player)]);

            const hits: Hit[] = [];
            if (urchinResult.status === "fulfilled") hits.push(...urchinHits(urchinResult.value));
            if (seraphResult.status === "fulfilled") hits.push(...seraphHits(seraphResult.value));
            if (hits.length > 0) return hits;

            const failure = [urchinResult, seraphResult].find((result) => result.status === "rejected");
            if (failure && failure.status === "rejected") throw failure.reason;
            return hits;
        }

        api.registerEnricher({
            name: "urchin",
            async enrich(player) {
                if (!anyLive()) return null;
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

        const target = (args: string[], session: Session): PlayerRef => {
            const name = args[0] ?? session.username;
            return session.findPlayer(name) ?? { name };
        };

        api.registerCommand(
            "urchin",
            async (args, session) => {
                if (!anyLive()) {
                    session.chat.text(`${PREFIX} §cBlacklist lookups are off, both api keys were rejected.`);
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
            "look a player up on the Urchin and Seraph blacklists",
        );

        api.registerCommand(
            "seraph",
            async (args, session) => {
                if (seraph.disabled) {
                    session.chat.text(`${PREFIX} §cSeraph is off (no key, disabled, or the key was rejected).`);
                    return;
                }
                const player = target(args, session);
                session.chat.text(`${PREFIX} §7Looking up §f${player.name} §7on Seraph...`);
                try {
                    const report = await seraphFor(player);
                    const score = report?.score;
                    const hits = seraphTagHits(report);

                    if (hits.length === 0) {
                        session.chat.text(`${PREFIX} §f${player.name} §ahas no Seraph tags.`);
                    } else {
                        const heading = hits.map((hit) => COLOR_CODES[hit.color] + hit.label).join("§7, ");
                        session.chat.text(`${PREFIX} §f${player.name} §8- ${heading}`);
                        for (const hit of hits) {
                            session.chat.text(`  §8• ${hit.tooltip.split("\n")[1] ?? "§7no detail given"}`);
                        }
                    }
                    if (typeof score?.value === "number") {
                        session.chat.text(`  §7Sniper score: §f${score.value} §8(${score.mode || "default"})`);
                    }
                } catch (error) {
                    session.chat.text(`${PREFIX} §cSeraph lookup failed: §7${error}`);
                }
            },
            "look a player up on Seraph, tags and sniper score",
        );

        const live = [urchin, seraph].filter((source) => !source.disabled).map((source) => source.name);
        api.log.info(`blacklist tags active via ${live.join(" + ")} (alerts: ${alerts.enabled ? "on" : "off"}, cache ${ttl / 1000}s)`);
    },
};

export default urchinPlugin;
