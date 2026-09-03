import { PREFIX } from "../core/chat";
import type { EnrichmentEngine } from "../core/enrichment";
import type { PluginManager } from "../core/pluginManager";
import type { Plugin, PluginApi } from "../core/types";
import { createConfigEditor, parsePath, resolvePath } from "./corePluginUtils/configEditor";

// built in commands. gets handed the enrichment engine and plugin registry
// directly since its a first party plugin, not a drop-in one.
export function createCoreCommandsPlugin(
    enrichment: EnrichmentEngine,
    plugins: PluginManager,
    prefix: string,
): Plugin {
    return {
        name: "Core",
        version: "0.2.0",
        description: "Plugin containing core commands (//help, //who, //plugins, etc), and common helpful utilities",

        defaultConfig: {
            enabled: true,
            blocked_messages: {
                enabled: true,
                patterns: [
                    "Slow down! You can only use /tip every few seconds."
                ]
            },
            nickbook: {
                enabled: true,
                UseLabe: "[USE NAME]",
                RerollLabel: "[REROLL NAME]",
                throttleTime: 400, // milliseconds to wait before allowing another reroll to allow hypixel "ratelimit" stuff and double rolling names
                restoreHeldItem: true
            }
        },

        setup(api) {
            chatFilter(api);
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
                const editor = createConfigEditor({ config: api.config, prefix, log: api.log });

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
                            editor.open(session, isBranch(api.config, path) ? path : path.slice(0, -1));
                            editor.show(session, path);
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
            }
        },
    };

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

// is there anything to navigate into at this path
function isBranch(config: unknown, path: string[]): boolean {
    let node: unknown = config;
    for (const key of path) {
        if (typeof node !== "object" || node === null || Array.isArray(node)) return false;
        node = (node as Record<string, unknown>)[key];
    }
    return typeof node === "object" && node !== null && !Array.isArray(node);
}
