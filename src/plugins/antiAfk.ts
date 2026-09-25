import { PREFIX } from "../core/chat";
import type { Plugin, Session } from "../core/types";

interface AntiAfkConfig {
    enabled?: boolean;
    intervalSeconds?: number;
    prefix?: string;
    charset?: string;
    messageLength?: number;
    hideMessages?: boolean; // swallow the To/From echo
    autoStart?: boolean; // start on join, or wait for //afk
    lobbyOnly?: boolean;
    targetUser?: string | null; // use a targetUser instead of yourself for the DM, lets you avoid the "pling" on dm
    dmCooldownMs?: number; // "you can only message every 0.5 seconds" fix
}

const DEFAULT_CHARSET = "abcdefghijklmnopqrstuvwxyz0123456789";
const DEFAULT_INTERVAL = 90;
const DEFAULT_LENGTH = 16;
const DEFAULT_PREFIX = "[AFK] ";
// dming yourself faster than this is just asking hypixel for a chat mute
const MIN_INTERVAL = 10;
// hypixel drops a dm sent within roughly this long of another one
const DEFAULT_DM_COOLDOWN = 750;
// how many recent payloads stay hideable, a To and a From come back per message
const KEEP_TOKENS = 4;
// what counts as a dm command
const DM_COMMAND = /^\/(?:msg|m|w|tell|r|reply|message|pm)\b/i;

//hypixel shows this when /status offline, avoid sending dms as it errors
const APPEARING_OFFLINE = /appearing offline/i;

interface AfkState {
    timer?: NodeJS.Timeout;
    retry?: NodeJS.Timeout; // a send pushed back to clear the dm cooldown
    tokens: string[];
    lastSentAt: number; // when anti-afk last sent its own dm
    lastChatAt: number; // when you last had a chat message go upstream
}

// finding the "to user" line
function recipientOf(text: string): string | undefined {
    const colon = text.indexOf(":");
    if (colon === -1) return undefined;
    const words = text.slice("To ".length, colon).trim().split(/\s+/);
    return words[words.length - 1]?.toLowerCase() || undefined;
}

export const antiAfkPlugin: Plugin = {
    name: "antiAfk",
    version: "0.1.0",
    description: "Anti-AFK by messaging yourself a random string on an interval.",

    defaultConfig: {
        enabled: false,
        intervalSeconds: DEFAULT_INTERVAL,
        prefix: DEFAULT_PREFIX,
        charset: DEFAULT_CHARSET,
        messageLength: DEFAULT_LENGTH,
        hideMessages: true,
        autoStart: true,
        lobbyOnly: true,
        targetUser: null,
        dmCooldownMs: DEFAULT_DM_COOLDOWN,
    },

    setup(api) {
        const config = api.pluginConfig as AntiAfkConfig;

        if (!config.charset) {
            api.log.warn("charset is empty, falling back to the default alphanumeric set");
        }
        const length = Math.max(1, Math.floor(config.messageLength ?? DEFAULT_LENGTH));
        const requested = config.intervalSeconds ?? DEFAULT_INTERVAL;
        const interval = Math.max(MIN_INTERVAL, requested);
        if (interval !== requested) {
            api.log.warn(`intervalSeconds ${requested} is too low, clamped to ${MIN_INTERVAL}s`);
        }
        const cooldown = Math.max(0, Math.floor(config.dmCooldownMs ?? DEFAULT_DM_COOLDOWN));

        const sessions = new Map<string, AfkState>();

        const randomToken = (avoid?: string): string => {
            let token = "";
            do {
                token = "";
                for (let i = 0; i < length; i++) {
                    token += (config.charset ?? DEFAULT_CHARSET)[Math.floor(Math.random() * (config.charset?.length ?? DEFAULT_CHARSET.length))];
                }
                // a single char charset can never differ, dont spin forever on it
            } while (token === avoid && (config.charset?.length ?? DEFAULT_CHARSET.length) > 1);
            return token;
        };

        // who the dm goes to, yourself unless an alt is configured
        const targetOf = (session: Session) => config.targetUser || session.username;

        const tick = (session: Session, state: AfkState): void => {
            if (config.lobbyOnly && !session.lobby) {
                api.log.debug(`skipping anti-afk dm for ${session.username}, in a game`);
                return;
            }
            // appearing offline, the dm will not register, wait for the notice to go
            if (APPEARING_OFFLINE.test(session.title.displayText)) {
                api.log.debug(`skipping anti-afk dm for ${session.username}, appearing offline`);
                return;
            }
            // dm sent too recently, wait for cooldown
            const since = Date.now() - Math.max(state.lastSentAt, state.lastChatAt);
            if (since < cooldown) {
                if (!state.retry) {
                    state.retry = setTimeout(() => {
                        state.retry = undefined;
                        tick(session, state);
                    }, cooldown - since);
                }
                return;
            }
            const token = (config.prefix ?? DEFAULT_PREFIX) + randomToken(state.tokens[state.tokens.length - 1]);
            state.tokens.push(token);
            if (state.tokens.length > KEEP_TOKENS) state.tokens.shift();
            const target = targetOf(session);
            session.sendUpstream(`/msg ${target} ${token}`);
            state.lastSentAt = Date.now();
            api.log.debug(`anti-afk dm for ${session.username}: ${token} (message sent to ${target})`);
        };

        const running = (session: Session) => sessions.has(session.id);

        const start = (session: Session): void => {
            if (running(session)) return;
            const state: AfkState = { tokens: [], lastSentAt: 0, lastChatAt: 0 };
            state.timer = setInterval(() => tick(session, state), interval * 1000);
            sessions.set(session.id, state);
            api.log.info(`anti-afk on for ${session.username}, every ${interval}s`);
        };

        const stop = (sessionId: string): void => {
            const state = sessions.get(sessionId);
            if (!state) return;
            if (state.timer) clearInterval(state.timer);
            if (state.retry) clearTimeout(state.retry);
            sessions.delete(sessionId);
        };

        api.on("sessionStart", (session) => {
            if (config.autoStart) start(session);
        });
        api.on("sessionEnd", (session) => stop(session.id));

        // remember whenever you send something, so a tick can yield to you
        api.on("clientPacket", (name, data: any, session) => {
            if (name !== "chat" || typeof data?.message !== "string") return;
            const state = sessions.get(session.id);
            if (state) state.lastChatAt = Date.now();
        });

        // antiafk just got sent, catch message right after
        api.registerClientFilter((name, data: any, session) => {
            if (cooldown === 0 || name !== "chat" || typeof data?.message !== "string") return;
            if (!DM_COMMAND.test(data.message)) return;
            const state = sessions.get(session.id);
            if (!state) return;
            const since = Date.now() - state.lastSentAt;
            if (since >= cooldown) return;
            const message = data.message;
            const wait = cooldown - since;
            api.log.debug(`holding your dm for ${wait}ms to clear the anti-afk cooldown`);
            setTimeout(() => {
                state.lastChatAt = Date.now();
                session.sendUpstream(message);
            }, wait);
            return true;
        });

        if (config.hideMessages) {
            api.registerChatFilter((msg, session) => {
                const state = sessions.get(session.id);
                if (!state) return false;
                const text = msg.text.trim();
                if (text.startsWith("To ")) return recipientOf(text) === targetOf(session).toLowerCase();
                if (!text.startsWith("From ") || state.tokens.length === 0) return false;
                if (!text.includes(session.username)) return false;
                return state.tokens.some((token) => text.endsWith(token));
            });
        }

        api.registerCommand(
            "afk",
            (args, session) => {
                const arg = args[0]?.toLowerCase();
                const wanted = arg === "on" ? true : arg === "off" ? false : !running(session);
                if (arg && arg !== "on" && arg !== "off") {
                    session.chat.text(`${PREFIX} §7Usage: §f${api.config.commandPrefix}afk §8[on|off]`);
                    return;
                }
                if (wanted === running(session)) {
                    session.chat.text(`${PREFIX} §7Anti-AFK is already §f${wanted ? "on" : "off"}§7.`);
                    return;
                }
                if (wanted) {
                    start(session);
                    session.chat.text(
                        `${PREFIX} §aAnti-AFK on §7- messaging §f${config.targetUser || "yourself"}§7 every §f${interval}s` +
                            `§7${config.lobbyOnly ? " §8(lobbies only)" : ""}${config.hideMessages ? " §8(echo hidden)" : ""}`,
                    );
                } else {
                    stop(session.id);
                    session.chat.text(`${PREFIX} §cAnti-AFK off§7.`);
                }
            },
            "toggle anti-afk self-messaging, //afk [on|off]",
        );

        api.log.info(
            `anti-afk ready (${interval}s, ${config.autoStart ? "auto-start" : "manual"}, ${config.lobbyOnly ? "lobbies only" : "everywhere"}, echo ${config.hideMessages ? "hidden" : "shown"})`,
        );
    },
};

export default antiAfkPlugin;
