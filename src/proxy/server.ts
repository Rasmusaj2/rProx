import mc from "minecraft-protocol";
import { createLogger, type Logger } from "../util/log";
import { AccountStore } from "./accounts";
import { LinkManager, AUTH_OPTIONS } from "./linking";
import type { Config } from "../config";
import type { EventBus } from "../core/events";
import type { EnrichmentEngine } from "../core/enrichment";
import type { PluginManager } from "../core/pluginManager";
import { LobbyTracker, parseWhoResponse, type PlayerInfoPacket } from "../core/lobby";
import { makeChatInjector, parseChat, PREFIX } from "../core/chat";
import { createWindowApi } from "../interface/windowApi";
import type { ChatMessage, Session } from "../core/types";

const log = createLogger("proxy");

const states = mc.states;

// game start lines
const GAME_START_PATTERNS = [
    /^Protect your bed and destroy the enemy beds\.$/,
    /^\s*Bed Wars\s*$/,
    /^The game starts in \d+ seconds?!$/,
];

// a game start matches several lines in a row, only react once per game
const GAME_START_COOLDOWN_MS = 15_000;

export class ProxyServer {
    private server: unknown;
    private sessionSeq = 0;
    private lastGameStart = new Map<string, number>();
    private readonly accounts: AccountStore;
    private readonly links: LinkManager;

    constructor(
        private readonly config: Config,
        private readonly bus: EventBus,
        private readonly enrichment: EnrichmentEngine,
        private readonly plugins: PluginManager,
    ) {
        this.accounts = new AccountStore(config.auth.dir);
        this.links = new LinkManager(this.accounts, config.auth.requireMatchingAccount);
        // every detection source funnels through here - enrich, then inject
        this.bus.on("playerDetected", (player, source, session) => {
            void this.enrichment.checkPlayer(player, source, session);
        });
        this.bus.on("sessionEnd", (session) => this.enrichment.forgetSession(session.id));
    }

    start(): void {
        const { proxy } = this.config;
        this.server = mc.createServer({
            // online mode makes mojang verify each joining player, which is what
            // lets us trust their uuid and map it to their own upstream session
            "online-mode": proxy.onlineMode,
            keepAlive: false, // pass keep-alives straight through
            host: proxy.listenHost,
            port: proxy.listenPort,
            version: proxy.version,
            motd: proxy.motd,
            maxPlayers: proxy.maxPlayers,
        });

        const server = this.server as { on(event: string, cb: (...args: any[]) => void): void };
        server.on("listening", () => {
            log.info(
                `listening on ${proxy.listenHost}:${proxy.listenPort} (v${proxy.version}) -> ${proxy.targetHost}:${proxy.targetPort}`,
            );
            log.info(
                `online-mode ${proxy.onlineMode ? "ON (Microsoft auth required)" : "OFF"}, up to ${proxy.maxPlayers} player(s)`,
            );
            log.info(`connect via ${proxy.version} client to ${proxy.listenHost}:${proxy.listenPort}`);
        });
        server.on("error", (error: unknown) => log.error(`server error: ${error}`));
        server.on("login", (client: unknown) => void this.onLogin(client));
    }

    // disconnect a client using whichever packet its current state expects
    private kick(client: any, lines: string[]): void {
        const reason = JSON.stringify({ text: lines.join("\n") });
        try {
            client.write(client.state === states.PLAY ? "kick_disconnect" : "disconnect", { reason });
        } catch {
            // socket may already be gone
        }
        setTimeout(() => {
            try {
                client.end();
            } catch {
                // same
            }
        }, 100);
    }

    // first join for an unlinked player - start the device code flow and kick
    // them with the code, their next join goes through
    private async requireLink(client: any, uuid: string, clog: Logger): Promise<void> {
        const result = await this.links.begin(uuid, client.username);
        if (result.status !== "pending" || !result.code) {
            clog.warn(`could not start link for ${client.username}: ${result.error}`);
            this.kick(client, [
                "§cCould not start Microsoft sign-in",
                `§7${result.error ?? "unknown error"}`,
                "§7Please try again in a moment.",
            ]);
            return;
        }
        const { userCode, verificationUri } = result.code;
        clog.info(`link required for ${client.username}, code ${userCode}`);
        this.kick(client, [
            "§b§lLink your Microsoft account",
            "",
            "§7rProx needs to sign in as you once.",
            `§7Go to §f${verificationUri}`,
            "§7and enter this code:",
            `§a§l${userCode}`,
            "",
            "§7Then reconnect. §8(the code expires in ~15 min)", //  thanks claude this is good
            this.config.auth.requireMatchingAccount ? "§7The account you sign in with must match your Minecraft account." : ""
        ]);
    }

    private async onLogin(rawClient: unknown): Promise<void> {
        const client = rawClient as any;
        const id = `s${++this.sessionSeq}`;
        const clog = createLogger(`proxy:${id}`);
        const uuid: string = client.uuid;
        clog.info(`client "${client.username}" (${uuid}) connected`);

        if (this.config.proxy.onlineMode && !this.accounts.isLinked(uuid)) {
            await this.requireLink(client, uuid, clog);
            return;
        }
        this.accounts.touch(uuid);

        // each player authenticates out of their own token cache, so a session
        // can never pick up somebody elses credentials
        const perUser = this.config.proxy.onlineMode;
        const authUsername = perUser ? uuid.toLowerCase() : client.username;
        const profilesFolder = perUser ? this.accounts.profileDir(uuid) : this.config.auth.dir;

        clog.info(`connecting to Microsoft auth as ${client.username}`);
        const target = mc.createClient({
            host: this.config.proxy.targetHost,
            port: this.config.proxy.targetPort,
            version: this.config.proxy.version,
            username: authUsername,
            auth: "microsoft",
            profilesFolder,
            ...AUTH_OPTIONS,
            keepAlive: false,
            onMsaCode: (data: { user_code: string; verification_uri: string }) => {
                clog.warn(`Microsoft sign-in required: go to ${data.verification_uri} and enter code ${data.user_code}`);
            },
        });

        const lobby = new LobbyTracker();
        const toClient = (name: string, data: unknown) => {
            if (client.state === states.PLAY) client.write(name, data);
        };
        const toServer = (name: string, data: unknown) => {
            if (target.state === states.PLAY) target.write(name, data);
        };
        // chest guis of our own live here. it needs to send both ways - windows of
        // ours go to the client, and pressing a button in one of hypixels goes up
        const windows = createWindowApi(
            { sendPacket: toClient, sendServerPacket: toServer },
            {
                version: this.config.proxy.version,
                onError: (error) => clog.debug(`window api: ${error}`),
            },
        );
        const session: Session = { // player sessions
            id,
            username: client.username,
            chat: makeChatInjector(client),
            game: "unknown", // nametagStats fills this in off the scoreboard and we dont have a scoreboard yet - also irrelevant anyways if nametagStats is off
            lobby: true,
            windows,
            sendUpstream: (message: string) => {
                if (target.state === states.PLAY) target.write("chat", { message });
            },
            sendPacket: toClient,
            sendServerPacket: toServer,
            players: () => lobby.list(),
            findPlayer: (name: string) => lobby.get(name),
            isNpc: (name: string) => lobby.isNpc(name),
            markNpc: (name: string) => lobby.markNpc(name),
        };

        let ended = false;
        const cleanup = (who: string, reason?: unknown) => {
            if (ended) return;
            ended = true;
            clog.info(`session ended (${who})${reason ? `: ${reason}` : ""}`);
            this.lastGameStart.delete(session.id);
            windows.dispose();
            try {
                client.end("Proxy connection closed");
            } catch {
                // already down
            }
            try {
                target.end();
            } catch {
                // same
            }
            this.bus.emit("sessionEnd", session);
        };

        // hypixel to client: forward packets, intercept for anything we need to handle or react to
        target.on("raw", (buffer: Buffer, meta: { name: string; state: string }) => {
            // chat is the one packet we do not blind-forward, see below
            if (meta.name === "chat") return;
            if (meta.state === states.PLAY && client.state === states.PLAY) client.writeRaw(buffer);
        });
        target.on("packet", (data: any, meta: { name: string; state: string }) => {
            if (meta.state !== states.PLAY) return;
            let hideChat = false;
            try {
                if (meta.name === "chat") hideChat = this.onServerChat(data, session, clog);
                else if (meta.name === "player_info") lobby.applyPlayerInfo(data as PlayerInfoPacket);
                // forced to clear lobby on login because hypixel sends a player_info packet 
                else if (meta.name === "login") lobby.clear();
                // windows before the event, so a plugin reading session.windows in
                // a serverPacket handler is looking at the current state
                windows.handleServerPacket(meta.name, data);
                this.bus.emit("serverPacket", meta.name, data, session);
            } catch (error) {
                clog.debug(`parse error: ${error}`);
            }
            // "packet" fires before "raw", so writing chat here keeps it in the same
            // spot in the stream while letting a plugin swallow the line entirely.
            // anything that threw above lands here with hideChat still false
            if (meta.name === "chat" && !hideChat && client.state === states.PLAY) {
                client.write("chat", { message: data.message, position: data.position ?? 0 });
            }
        });
        target.once("login", () => clog.info("upstream authenticated & connected"));
        target.on("error", (error: unknown) => cleanup("upstream error", (error as Error)?.message));
        target.on("end", () => cleanup("upstream closed"));

        // client to hypixel: forward decoded, intercept our own commands
        client.on("packet", (data: any, meta: { name: string; state: string }) => {
            if (meta.state !== states.PLAY || target.state !== states.PLAY) return;
            if (meta.name === "chat" && typeof data.message === "string" && data.message.startsWith(this.config.commandPrefix)) {
                void this.onCommand(data.message, session, clog);
                return; // handled here, dont forward it
            }
            // a click in a window of ours is talking about a window id hypixel has
            // never heard of, so it can never be forwarded. a plugin filter can
            // swallow anything else it asked for. both still get the event, same as
            // a hidden chat line does
            const inWindow = windows.handleClientPacket(meta.name, data);
            const filtered = this.plugins.blocksClient(meta.name, data, session);
            this.bus.emit("clientPacket", meta.name, data, session);
            if (inWindow || filtered) return;
            target.write(meta.name, data);
        });
        client.on("error", (error: unknown) => cleanup("client error", (error as Error)?.message));
        client.on("end", () => cleanup("client closed"));

        this.bus.emit("sessionStart", session);
    }

    // true means a plugin asked for this line to be hidden from the client
    private onServerChat(data: { message: unknown; position?: number }, session: Session, clog: Logger): boolean {
        const chat: ChatMessage = parseChat(this.config.proxy.version, data.message, data.position ?? 0);
        if (chat.position === 2) return false; // action bar spam
        const hide = this.plugins.hidesChat(chat, session);
        this.bus.emit("chat", chat, session);

        const names = parseWhoResponse(chat.text);
        if (names) {
            for (const name of names) {
                this.bus.emit("playerDetected", session.findPlayer(name) ?? { name }, "GAME", session);
            }
            return hide;
        }

        if (!GAME_START_PATTERNS.some((pattern) => pattern.test(chat.text))) return hide;
        const last = this.lastGameStart.get(session.id) ?? 0;
        if (Date.now() - last < GAME_START_COOLDOWN_MS) return hide;
        this.lastGameStart.set(session.id, Date.now());

        if (this.config.detection.autoWhoOnStart) { // honestly this is terrible rn because of it triggering during countdown
            clog.info("game start detected, requesting /who");
            session.sendUpstream("/who");
        }

        const players = session
            .players()
            .filter((p) => !this.config.detection.ignoreSelf || p.name.toLowerCase() !== session.username.toLowerCase());
        clog.info(`checking ${players.length} tab-list players`);
        for (const player of players) this.bus.emit("playerDetected", player, "GAME", session);
        return hide;
    }

    private async onCommand(raw: string, session: Session, clog: Logger): Promise<void> {
        const [name, ...args] = raw.slice(this.config.commandPrefix.length).trim().split(/\s+/);
        if (!name) return;
        const command = this.plugins.getCommand(name);
        if (!command) {
            session.chat.text(`${PREFIX} §7Unknown command: §f${name}§7. Try §f${this.config.commandPrefix}help`);
            return;
        }
        try {
            await command.handler(args, session);
        } catch (error) {
            clog.error(`command "${name}" threw: ${error}`);
            session.chat.text(`${PREFIX} §cCommand error: §7${(error as Error).message}`);
        }
    }
}
