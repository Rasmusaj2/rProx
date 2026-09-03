#!/usr/bin/env node
import { loadConfig } from "./config";
import { createLogger } from "./util/log";
import { HttpClient } from "./util/http";
import { EventBus } from "./core/events";
import { EnrichmentEngine } from "./core/enrichment";
import { PluginManager } from "./core/pluginManager";
import { ProxyServer } from "./proxy/server";
import { PREFIX } from "./core/chat";

import { createCoreCommandsPlugin } from "./plugins/core";
import { hypixelStatsPlugin } from "./plugins/hypixelStats";
import { createNametagStatsPlugin } from "./plugins/nametagStats";
import { dailyRewardsPlugin } from "./plugins/dailyRewards";
import { antiAfkPlugin } from "./plugins/antiAfk";
import { lobbyFishingPlugin } from "./plugins/lobbyFishing";
import { urchinPlugin } from "./plugins/urchin";

async function main(): Promise<void> {
    const config = loadConfig();
    const log = createLogger("main");
    log.info("rProx starting...");

    const http = new HttpClient();
    const bus = new EventBus();
    const enrichment = new EnrichmentEngine(http, config);
    const plugins = new PluginManager(config, bus, enrichment, http);

    // load builtin plugins first
    await plugins.registerAll([
        createCoreCommandsPlugin(enrichment, plugins, config.commandPrefix), // forceload
        hypixelStatsPlugin,
        createNametagStatsPlugin(enrichment),
        dailyRewardsPlugin,
        antiAfkPlugin,
        lobbyFishingPlugin,
        urchinPlugin,
    ]);

    // then whatever is sitting in the plugin directory
    await plugins.loadExternal();

    log.info(`${plugins.loadedNames.length} plugins, ${enrichment.count} enrichers active`);

    // say hello once per session so its obvious the proxy is in the loop
    const greeted = new Set<string>();
    bus.on("chat", (_msg, session) => {
        if (greeted.has(session.id)) return;
        greeted.add(session.id);
        session.chat.text(`${PREFIX} §aactive §7- type §f${config.commandPrefix}help §7for commands`);
    });
    bus.on("sessionEnd", (session) => greeted.delete(session.id));

    new ProxyServer(config, bus, enrichment, plugins).start();
}

main().catch((error) => {
    console.error("fatal:", error);
    process.exit(1);
});
