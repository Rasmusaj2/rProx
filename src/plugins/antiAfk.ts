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
    targetUser?: string; // use a targetUser instead of yourself for the DM, lets you avoid the "pling" on dm
}

const DEFAULT_CHARSET = "abcdefghijklmnopqrstuvwxyz0123456789";
const DEFAULT_INTERVAL = 60;
const DEFAULT_LENGTH = 8;
// dming yourself faster than this is just asking hypixel for a chat mute
const MIN_INTERVAL = 10;
// how many recent payloads stay hideable, a To and a From come back per message
const KEEP_TOKENS = 4;

interface AfkState {
    timer: NodeJS.Timeout;
    tokens: string[];
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
    setup(api) {
        const config = api.pluginConfig as AntiAfkConfig;

        const charset = config.charset && config.charset.length > 0 ? config.charset : DEFAULT_CHARSET;
        if (config.charset !== undefined && charset !== config.charset) {
            api.log.warn("charset is empty, falling back to the default alphanumeric set");
        }
        const length = Math.max(1, Math.floor(config.messageLength ?? DEFAULT_LENGTH));
        const requested = config.intervalSeconds ?? DEFAULT_INTERVAL;
        const interval = Math.max(MIN_INTERVAL, requested);
        if (interval !== requested) {
            api.log.warn(`intervalSeconds ${requested} is too low, clamped to ${MIN_INTERVAL}s`);
        }
        const hideMessages = config.hideMessages !== false;
        const autoStart = config.autoStart !== false;
        const messagePrefix = config.prefix ?? "";

        const sessions = new Map<string, AfkState>();

        const randomToken = (avoid?: string): string => {
            let token = "";
            do {
                token = "";
                for (let i = 0; i < length; i++) {
                    token += charset[Math.floor(Math.random() * charset.length)];
                }
                // a single char charset can never differ, dont spin forever on it
            } while (token === avoid && charset.length > 1);
            return token;
        };

        // who the dm goes to, yourself unless an alt is configured
        const targetOf = (session: Session) => config.targetUser || session.username;

        const tick = (session: Session, tokens: string[]): void => {
            const token = messagePrefix + randomToken(tokens[tokens.length - 1]);
            tokens.push(token);
            if (tokens.length > KEEP_TOKENS) tokens.shift();
            const target = targetOf(session);
            session.sendUpstream(`/msg ${target} ${token}`);
            api.log.debug(`anti-afk dm for ${session.username}: ${token} (message sent to ${target})`);
        };

        const running = (session: Session) => sessions.has(session.id);

        const start = (session: Session): void => {
            if (running(session)) return;
            const tokens: string[] = [];
            const timer = setInterval(() => tick(session, tokens), interval * 1000);
            sessions.set(session.id, { timer, tokens });
            api.log.info(`anti-afk on for ${session.username}, every ${interval}s`);
        };

        const stop = (sessionId: string): void => {
            const state = sessions.get(sessionId);
            if (!state) return;
            clearInterval(state.timer);
            sessions.delete(sessionId);
        };

        api.on("sessionStart", (session) => {
            if (autoStart) start(session);
        });
        api.on("sessionEnd", (session) => stop(session.id));

        if (hideMessages) {
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
                            `§7${hideMessages ? " §8(echo hidden)" : ""}`,
                    );
                } else {
                    stop(session.id);
                    session.chat.text(`${PREFIX} §cAnti-AFK off§7.`);
                }
            },
            "toggle anti-afk self-messaging, //afk [on|off]",
        );

        api.log.info(`anti-afk ready (${interval}s, ${autoStart ? "auto-start" : "manual"}, echo ${hideMessages ? "hidden" : "shown"})`);
    },
};

export default antiAfkPlugin;
