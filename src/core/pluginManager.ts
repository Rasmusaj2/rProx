import { readdirSync, existsSync } from "node:fs";
import { resolve, join, extname } from "node:path";
import { pathToFileURL } from "node:url";
import { createLogger } from "../util/log";
import type { HttpClient } from "../util/http";
import type { Config } from "../config";
import type { EventBus } from "./events";
import type { EnrichmentEngine } from "./enrichment";
import type { CommandHandler, Plugin, PluginApi } from "./types";

const log = createLogger("plugins");


// handles creating plugins and giving them a PluginApi to work with
// keeps track of registered commands, which plugins are loaded, internal + external commands, and command-deduplication

interface RegisteredCommand {
    handler: CommandHandler;
    help?: string;
    plugin: string;
}

export class PluginManager {
    private commands = new Map<string, RegisteredCommand>();
    private loaded: string[] = [];

    constructor(
        private readonly config: Config,
        private readonly bus: EventBus,
        private readonly enrichment: EnrichmentEngine,
        private readonly http: HttpClient,
    ) {}

    private pluginConfig(name: string): Record<string, unknown> {
        return (this.config.builtInPlugins[name] as Record<string, unknown>) ?? {};
    }

    private buildApi(plugin: Plugin): PluginApi {
        return {
            config: this.config,
            log: createLogger(`plugin:${plugin.name}`),
            http: this.http,
            pluginConfig: this.pluginConfig(plugin.name),
            on: (event, handler) => this.bus.on(event, handler), // handle subscription events for the plugin
            registerEnricher: (enricher) => this.enrichment.register(enricher), // enricher voodoo plugin magic
            registerCommand: (name, handler, help) => {
                const key = name.toLowerCase();
                if (this.commands.has(key)) {
                    log.warn(`command "${name}" already registered, overriding it (plugin ${plugin.name})`);
                }
                this.commands.set(key, { handler, help, plugin: plugin.name });
            },
        };
    }

    // a plugin is on unless its config block says enabled: false
    async register(plugin: Plugin): Promise<void> {
        if (this.pluginConfig(plugin.name).enabled === false) { // yes this does mean you can disable external plugins in the config.json file
            // i should probably make a seperate config thing for external plugins, but honestly i dont care enough and they should implement it themselves for now
            // untill i get around to making a "externalPlugins" config area in the config.json file which external plugins can have a default config written to
            log.info(`skipping disabled plugin "${plugin.name}"`);
            return;
        }
        try {
            await plugin.setup(this.buildApi(plugin));
            this.loaded.push(plugin.name);
            log.info(`loaded plugin "${plugin.name}"${plugin.version ? ` v${plugin.version}` : ""}`);
        } catch (error) {
            log.error(`failed to load plugin "${plugin.name}": ${error}`);
        }
    }

    async registerAll(plugins: Plugin[]): Promise<void> {
        for (const plugin of plugins) await this.register(plugin);
    }

    // drop-in plugins from the configured directory
    async loadExternal(): Promise<void> {
        const dir = resolve(process.cwd(), this.config.pluginDirectory);
        if (!existsSync(dir)) return;
        const files = readdirSync(dir).filter((file) => [".js", ".mjs", ".cjs", ".ts"].includes(extname(file)));
        for (const file of files) {
            try {
                const mod = await import(pathToFileURL(join(dir, file)).href);
                const plugin: Plugin = mod.default ?? mod.plugin ?? mod;
                if (!plugin?.name || typeof plugin.setup !== "function") {
                    log.warn(`ignoring ${file}, not a valid plugin (needs { name, setup })`);
                    continue;
                }
                await this.register(plugin);
            } catch (error) {
                log.error(`failed to import external plugin ${file}: ${error}`);
            }
        }
    }

    // what the plugin directory has to offer, loaded or not
    availableExternal(): string[] {
        const dir = resolve(process.cwd(), this.config.pluginDirectory);
        if (!existsSync(dir)) return [];
        return readdirSync(dir).filter((file) => [".js", ".mjs", ".cjs", ".ts"].includes(extname(file)));
    }

    getCommand(name: string): RegisteredCommand | undefined {
        return this.commands.get(name.toLowerCase());
    }

    listCommands(): Array<{ name: string; help?: string; plugin: string }> {
        return [...this.commands.entries()].map(([name, command]) => ({
            name,
            help: command.help,
            plugin: command.plugin,
        }));
    }

    get loadedNames(): string[] {
        return [...this.loaded];
    }
}
