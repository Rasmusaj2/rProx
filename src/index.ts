#!/usr/bin/env node
import { configExists, loadConfig, saveConfig } from "./config";
import { createLogger } from "./util/log";
import { HttpClient } from "./util/http";
import { checkForUpdate } from "./util/updateCheck";
import { EventBus } from "./core/events";
import { EnrichmentEngine } from "./core/enrichment";
import { PluginManager } from "./core/pluginManager";
import { ProxyServer } from "./proxy/server";
import { PREFIX, component } from "./core/chat";
import { runOnboarding } from "./onboarding";

import { createCoreCommandsPlugin } from "./plugins/core";
import { hypixelStatsPlugin } from "./plugins/hypixelStats";
import { createNametagStatsPlugin } from "./plugins/nametagStats";
import { dailyRewardsPlugin } from "./plugins/dailyRewards";
import { antiAfkPlugin } from "./plugins/antiAfk";
import { lobbyFishingPlugin } from "./plugins/lobbyFishing";
import { urchinPlugin } from "./plugins/urchin";
import { partyTeamsPlugin } from "./plugins/partyTeams";
import { duelsStatsPlugin } from "./plugins/duelsStats";

async function main(): Promise<void> {
    const firstRun = !configExists();
    const config = loadConfig();
    const log = createLogger("main");
    log.info("rProx starting...");

    const http = new HttpClient();
    const bus = new EventBus();
    const enrichment = new EnrichmentEngine(http, config);
    const plugins = new PluginManager(config, bus, enrichment, http);

    const builtIn = [
        createCoreCommandsPlugin(enrichment, plugins, config.commandPrefix), // forceload
        hypixelStatsPlugin,
        createNametagStatsPlugin(enrichment),
        dailyRewardsPlugin,
        antiAfkPlugin,
        lobbyFishingPlugin,
        urchinPlugin,
        partyTeamsPlugin,
        duelsStatsPlugin,
    ];

    // first boot onboarding setup
    if (firstRun && process.stdin.isTTY) {
        await runOnboarding(config, builtIn);
        saveConfig(config);
    }

    // load builtin plugins first
    await plugins.registerAll(builtIn);

    // then whatever is sitting in the plugin directory
    await plugins.loadExternal();

    log.info(`${plugins.loadedNames.length} plugins, ${enrichment.count} enrichers active`);

    // say hello once per session so its obvious the proxy is in the loop
    let updateNotice: Record<string, unknown> | undefined;
    const greeted = new Set<string>();
    bus.on("chat", (_msg, session) => {
        if (greeted.has(session.id)) return;
        greeted.add(session.id);
        session.chat.text(`${PREFIX} §aactive §7- type §f${config.commandPrefix}help §7for commands`);
        if (updateNotice) session.chat.raw(updateNotice);
    });
    bus.on("sessionEnd", (session) => greeted.delete(session.id));

    new ProxyServer(config, bus, enrichment, plugins).start();

    // a heads up only, nothing is downloaded or replaced
    void checkForUpdate().then((update) => {
        if (!update) return;
        updateNotice = component([
            { text: `${PREFIX} §eA newer rProx is available: ` },
            { text: `v${update.latest}`, color: "yellow", bold: true },
            { text: ` §7(you have §fv${update.current}§7) §8- ` },
            {
                text: update.url.replace(/^https?:\/\//, ""),
                color: "aqua",
                underlined: true,
                openUrl: update.url,
                tooltip: "§7Open the release page",
            },
        ]);
        log.warn(`newer rProx release available: v${update.latest} (running v${update.current}) - ${update.url}`);
    });
}

main().catch((error) => {
    console.error("fatal:", error);
    process.exit(1);
});
