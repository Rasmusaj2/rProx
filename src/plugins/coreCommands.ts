import { PREFIX } from "../core/chat";
import type { EnrichmentEngine } from "../core/enrichment";
import type { PluginManager } from "../core/pluginManager";
import type { Plugin } from "../core/types";

// built in commands. gets handed the enrichment engine and plugin registry
// directly since its a first party plugin, not a drop-in one.
export function createCoreCommandsPlugin(
    enrichment: EnrichmentEngine,
    plugins: PluginManager,
    prefix: string,
): Plugin {
    return {
        name: "coreCommands",
        version: "0.1.0",
        description: "//help, //who, //sc and //plugins",
        setup(api) {
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
        },
    };
}
