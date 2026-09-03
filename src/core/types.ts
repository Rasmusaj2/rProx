import type { Logger } from "../util/log";
import type { HttpClient } from "../util/http";
import type { McColorName } from "../util/mcColors";
import type { Config } from "../config";
import type { GameMode } from "./game";
import type { WindowApi } from "../interface/windowApi";

export interface PlayerRef {
    name: string;
    uuid?: string;
}

// where a detection came from
export type DetectSource =
| "GAME"    // tab list, /who or game start
| "PARTY"
| "CHAT"
| "MANUAL"  // //sc
| "ME";

// one thing an enricher wants shown for a player - a star, an fkdr, a cheater flag
export interface Tag {
    text: string; // inline label, e.g. "312✫"
    color?: McColorName;
    short?: string; // compact form for nametags, falls back to text
    formatted?: string; // pre-colored legacy string, wins over text + color (rainbow stars)
    prefix?: boolean; // render as [tag] in front of the name instead of after it
    tooltip?: string;
    priority?: number; // higher shows first, default 0
    game?: GameMode; // which game this stat belongs to, left off means show it everywhere
}

export interface EnrichContext {
    http: HttpClient;
    log: Logger;
    config: Config;
    source: DetectSource;
}

// the main extension point - turns a player into tags
export interface Enricher {
    name: string;
    enrich(player: PlayerRef, ctx: EnrichContext): Promise<Tag[] | null | undefined>;
}

export interface ChatInjector {
    raw(component: unknown): void; // a chat component, object or json string
    text(message: string): void; // plain text, §-codes honored
}

// one connected client + server pair
export interface Session {
    readonly id: string;
    readonly username: string;
    readonly chat: ChatInjector;
    game: GameMode; // active game, detected and kept up to date by nametagStats
    lobby: boolean;
    readonly windows: WindowApi; // chest rewrites
    sendUpstream(message: string): void; // send a message/command as if typed
    sendPacket(name: string, data: unknown): void; // write a decoded packet to the client
    sendServerPacket(name: string, data: unknown): void; // write a decoded packet to hypixel, as if the client sent it
    players(): PlayerRef[]; // current tab list, npcs left out
    findPlayer(name: string): PlayerRef | undefined;
    isNpc(name: string): boolean; // a lobby npc, never worth a lookup
    markNpc(name: string): void; // for whoever spots the [NPC] rank first
}

export interface ChatMessage {
    text: string; // plain, color codes stripped
    formatted: string; // legacy §-codes kept
    raw: unknown;
    position: number; // 0 chat, 1 system, 2 action bar
}

export type CommandHandler = (args: string[], session: Session) => void | Promise<void>;

// return true to stop a line from ever reaching the client. runs before the
// chat event, so other plugins still see what got hidden
export type ChatFilter = (msg: ChatMessage, session: Session) => boolean | void;

// return true to stop a client packet from reaching hypixel
export type ClientFilter = (name: string, data: any, session: Session) => boolean | void;

export interface ProxyEvents {
    sessionStart: (session: Session) => void;
    sessionEnd: (session: Session) => void;
    chat: (msg: ChatMessage, session: Session) => void;
    playerDetected: (player: PlayerRef, source: DetectSource, session: Session) => void;
    serverPacket: (name: string, data: any, session: Session) => void;
    clientPacket: (name: string, data: any, session: Session) => void;
}

// what a plugin gets handed in setup()
export interface PluginApi {
    config: Config;
    log: Logger;
    http: HttpClient;
    pluginConfig: Record<string, unknown>; // config.builtInPlugins[name]
    on<K extends keyof ProxyEvents>(event: K, handler: ProxyEvents[K]): void;
    registerEnricher(enricher: Enricher): void;
    registerCommand(name: string, handler: CommandHandler, help?: string): void;
    registerChatFilter(filter: ChatFilter): void;
    registerClientFilter(filter: ClientFilter): void;
}

export interface Plugin {
    name: string;
    version?: string;
    description?: string;
    defaultConfig?: Record<string, unknown>;
    setup(api: PluginApi): void | Promise<void>;
}
