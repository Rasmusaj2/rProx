import { PREFIX } from "../core/chat";
import type { EnrichmentEngine } from "../core/enrichment";
import type { PluginManager } from "../core/pluginManager";
import type { Plugin, PluginApi, Session } from "../core/types";
import { createConfigEditor, parsePath, resolvePath } from "./corePluginUtils/configEditor";
import { registerNickbook } from "./corePluginUtils/nickbook";
import { registerPlayerNotes } from "./corePluginUtils/playerNotes";

// built in commands. gets handed the enrichment engine and plugin registry
// directly since its a first party plugin, not a drop-in one.
export function createCoreCommandsPlugin(
    enrichment: EnrichmentEngine,
    plugins: PluginManager,
    prefix: string,
): Plugin {
    return {
        name: "Core",
        version: "0.4.0",
        description: "Plugin containing core commands (//help, //who, //plugins, etc), and common helpful utilities",
        forceLoad: true, // disabling this would take //config (and //help, //plugins) with it

        defaultConfig: {
            enabled: true,
            blocked_messages: {
                enabled: true,
                patterns: [
                    "Slow down! You can only use /tip every few seconds."
                ]
            },
            autoBoop: {
                enabled: true,
                players: [], // join autoboop
                boopBack: false, //boopback
                boo: false, // halloween event, /boo instead of /boop
            },
            autoGetOffMyFace: {
                enabled: true,
                useWhitelist: false,
                whitelist: [],
                blacklist: [],
            },
            nickbook: {
                enabled: true,
                restoreHeldItem: true,
                rerollCooldownMs: 400, // hypixel anti "ratelimit" stuff
                // button labels to match against
                useLabels: ["USE NAME"],
                rerollLabels: ["TRY AGAIN"],
                trace: false, // log the packet info for debugging
            },
            playerNotes: {
                enabled: true,
                file: "./playernotes.json",
                friendsListHover: true,
                alerts: {
                    enabled: true,
                    onJoin: true,
                    onLobby: true,
                    repeatSeconds: 300,
                },
            },
        },

        setup(api) {
            chatFilter(api);
            autoBoop(api);
            autoGetOffMyFace(api);
            registerNickbook(api);
            registerPlayerNotes(api);
            api.registerCommand(
                "who",
                (_args, session) => {
                    session.sendUpstream("/who");
                    session.chat.text(`${PREFIX} §7Requested the lobby list...`);
                },
                "ask the server for the lobby list (parsed automatically)",
            );

            api.registerCommand(
                "plugins",
                (_args, session) => {
                    const loaded = plugins.loadedNames;
                    const available = plugins.availableExternal();
                    session.chat.text(`${PREFIX} §7Loaded §f${loaded.length}§7: §f${loaded.join("§7, §f") || "(none)"}`);
                    session.chat.text(`  §7In ${api.config.pluginDirectory}: §f${available.join("§7, §f") || "(none)"}`);
                },
                "view loaded and available plugins",
            );

            api.registerCommand(
                "help",
                (_args, session) => {
                    session.chat.text(`${PREFIX} §7Commands:`);
                    for (const command of plugins.listCommands()) {
                        session.chat.text(`  §f${prefix}${command.name} §8- §7${command.help ?? ""}`);
                    }
                },
                "show this help",
            );
            
            if (api.config.proxy.allowIngameEditing) { // limit to if allowed
                const editor = createConfigEditor({
                    config: api.config,
                    prefix,
                    log: api.log,
                    // refuse to turn off a plugin the proxy cannot run without
                    guard: (path, value) => {
                        const name = pluginToggleTarget(path);
                        if (name && value === false && plugins.isForced(name)) {
                            return `"${name}" is required and cannot be disabled`;
                        }
                        return undefined;
                    },
                    // a plugins enabled flag just moved, load or unload it now
                    onSet: (session, path, value) => {
                        const name = pluginToggleTarget(path);
                        if (!name) return;
                        const enabled = value === true;
                        void plugins.setEnabled(name, enabled).then((changed) => {
                            if (changed) session.chat.text(`${PREFIX} §7${enabled ? "Loaded" : "Unloaded"} plugin §f${name}§7.`);
                        });
                    },
                });
                api.onCleanup(() => editor.dispose());

                api.registerCommand(
                    "config",
                    (args, session) => {
                        const [first, ...rest] = args;

                        if (!first) {
                            editor.open(session);
                            return;
                        }

                        if (first.toLowerCase() === "cancel") {
                            if (!editor.cancel(session)) {
                                session.chat.text(`${PREFIX} §7Nothing was waiting for a value.`);
                            }
                            return;
                        }

                        const parts = parsePath(first);
                        const path = resolvePath(api.config, parts);
                        if (!path) {
                            session.chat.text(`${PREFIX} §cNo such setting: §f${parts.join(".")}`);
                            session.chat.text(`  §7Open the menu with §f${prefix}config §7to browse it.`);
                            return;
                        }

                        if (rest.length === 0) {
                            // a block opens into the menu, a plain value asks for a new value
                            if (isBranch(api.config, path)) {
                                editor.open(session, path);
                                editor.show(session, path);
                            } else {
                                editor.prompt(session, path);
                            }
                            return;
                        }
                        editor.assign(session, path, rest.join(" "));
                    },
                    "browse and edit config.json in a chest gui, or //config <path> [value]",
                );

                // register chat filter for everything that is typed in chat here since it'll be setting a new value in config
                api.registerClientFilter((name, data, session) => {
                    if (name !== "chat" || typeof data?.message !== "string") return;
                    return editor.takeChat(session, data.message);
                });

                api.on("sessionEnd", (session) => editor.forget(session.id));
                
                // moved server, abandon config edit statew
                api.on("serverPacket", (name, _data, session) => {
                    if (name === "login") editor.abandon(session);
                });
            }
        },
    };

    // auto /boop
    function autoBoop(api: PluginApi): void {
        const config = api.pluginConfig.autoBoop as
            | { enabled?: boolean; players?: string[]; boopBack?: boolean; boo?: boolean }
            | undefined;
        if (!config?.enabled) return;

        

        const targets = new Set(
            (config.players ?? []).map((name) => String(name).trim().toLowerCase()).filter(Boolean),
        );
        const JOIN = /^(?:Friend|Guild) > (?:\[[^\]]+\] )?([A-Za-z0-9_]{1,16}) joined\b/;
        const BOOPED = /^From (?:\[[^\]]+\] )?([A-Za-z0-9_]{1,16}): Boop?!?\s*$/i;

        api.on("chat", (msg, session) => {
            const text = msg.text.trim();

            const command = config.boo ? "/boo" : "/boop";

            const join = JOIN.exec(text);
            if (join) {
                if (targets.has(join[1].toLowerCase())) {
                    session.sendUpstream(`${command} ${join[1]}`);
                    api.log.debug(`auto-booped ${join[1]} on join`);
                }
                return;
            }

            if (!config.boopBack) return;
            const boop = BOOPED.exec(text);
            if (boop && boop[1].toLowerCase() !== session.username.toLowerCase()) {
                session.sendUpstream(`${command} ${boop[1]}`);
                api.log.debug(`auto-booped ${boop[1]} back`);
            }
        });
    }

    // cowboy gadget detection
    function autoGetOffMyFace(api: PluginApi): void {
        const config = api.pluginConfig.autoGetOffMyFace as
            | { enabled?: boolean; useWhitelist?: boolean; whitelist?: string[]; blacklist?: string[] }
            | undefined;
        if (!config) return;

        interface FaceState {
            self?: number; // own entity id
            uuids: Map<number, string>; // entity id to player uuid
            vehicles: Map<number, number>; // rider entity id to vehicle entity id
            pending?: ReturnType<typeof setTimeout>;
            lastSent: number;
        }
        const sessions = new Map<string, FaceState>();
        const stateFor = (id: string): FaceState => {
            let state = sessions.get(id);
            if (!state) {
                state = { uuids: new Map(), vehicles: new Map(), lastSent: 0 };
                sessions.set(id, state);
            }
            return state;
        };
        const forget = (state: FaceState) => {
            clearTimeout(state.pending);
            state.pending = undefined;
            state.uuids.clear();
            state.vehicles.clear();
        };
        const normalize = (uuid: string) => uuid.replace(/-/g, "").toLowerCase();
        const has = (list: string[] | undefined, name: string) =>
            (list ?? []).some((entry) => String(entry).trim().toLowerCase() === name);

        // gadget makes invisable bat ride the player and goes through that. skip non-players
        const riderOnMe = (state: FaceState): number | undefined => {
            const seen = new Set<number>();
            let current = state.self;
            while (current !== undefined && !seen.has(current)) {
                seen.add(current);
                let above: number | undefined;
                for (const [rider, vehicle] of state.vehicles) {
                    if (vehicle === current) above = rider;
                }
                if (above === undefined || state.uuids.has(above)) return above;
                current = above;
            }
            return undefined;
        };

        // they dont attach at the same time so wait
        const check = (state: FaceState, session: Session) => {
            state.pending = undefined;
            if (!config.enabled) return;

            const rider = riderOnMe(state);
            if (rider === undefined) return;
            const uuid = state.uuids.get(rider);
            const name = session.players().find((player) => player.uuid && normalize(player.uuid) === uuid)?.name;
            api.log.debug(`riding you: ${name ?? `player ${uuid}`} (entity ${rider})`);

            const lower = name?.toLowerCase();
            const blacklisted = lower !== undefined && has(config.blacklist, lower);
            const whitelisted = lower !== undefined && has(config.whitelist, lower);
            if (!blacklisted && !(config.useWhitelist && !whitelisted)) return;

            if (Date.now() - state.lastSent < 1000) return;
            state.lastSent = Date.now();
            session.sendUpstream("/getoffmyface");
            api.log.debug(`/getoffmyface on ${name ?? `entity ${rider}`}`);
        };

        api.on("serverPacket", (name, data, session) => {
            if (name === "login") {
                const state = stateFor(session.id);
                forget(state);
                state.self = data.entityId;
                return;
            }
            const state = sessions.get(session.id);
            if (!state) return;

            if (name === "respawn") {
                forget(state);
            } else if (name === "named_entity_spawn") {
                state.uuids.set(data.entityId, normalize(String(data.playerUUID)));
            } else if (name === "entity_destroy") {
                for (const id of data.entityIds ?? []) {
                    state.uuids.delete(id);
                    state.vehicles.delete(id);
                }
            } else if (name === "attach_entity" && !data.leash) {
                if (data.vehicleId === -1) {
                    state.vehicles.delete(data.entityId);
                    return;
                }
                if (state.vehicles.get(data.entityId) === data.vehicleId) return; // no change
                state.vehicles.set(data.entityId, data.vehicleId);
                if (!config.enabled || state.self === undefined) return;
                clearTimeout(state.pending);
                state.pending = setTimeout(() => check(state, session), 250);
            }
        });

        api.on("sessionEnd", (session) => {
            const state = sessions.get(session.id);
            if (state) forget(state);
            sessions.delete(session.id);
        });
        api.onCleanup(() => {
            for (const state of sessions.values()) forget(state);
            sessions.clear();
        });
    }

    function chatFilter(api: PluginApi): void {
        const blockedMessages = api.pluginConfig.blocked_messages as
            | { enabled?: boolean; patterns?: string[] }
            | undefined;

        for (const pattern of (blockedMessages?.patterns ?? [])) {
            api.registerChatFilter((msg) => {
                if (!blockedMessages?.enabled) return false;
                if (msg.text.includes(pattern)) {
                    api.log.debug(`CORE blocked message: ${msg.text}`);
                    return true;
                }
            });
        }
    }
}

// the path a plugin on/off toggle lands on, builtInPlugins.<name>.enabled
function pluginToggleTarget(path: string[]): string | undefined {
    return path.length === 3 && path[0] === "builtInPlugins" && path[2] === "enabled" ? path[1] : undefined;
}

// is there anything to navigate into at this path
function isBranch(config: unknown, path: string[]): boolean {
    let node: unknown = config;
    for (const key of path) {
        if (typeof node !== "object" || node === null || Array.isArray(node)) return false;
        node = (node as Record<string, unknown>)[key];
    }
    return typeof node === "object" && node !== null && !Array.isArray(node);
}
