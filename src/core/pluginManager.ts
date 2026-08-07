import { readdirSync, existsSync } from "node:fs";
import { resolve, join, extname } from "node:path";
import { pathToFileURL } from "node:url";
import { createLogger } from "../util/log";
import type { HttpClient } from "../util/http";
import { applyPluginDefaults, saveConfig, type Config } from "../config";
import type { EventBus } from "./events";
import type { EnrichmentEngine } from "./enrichment";
import type { ChatFilter, ChatMessage, CommandHandler, Plugin, PluginApi, Session } from "./types";

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
    private chatFilters: Array<{ filter: ChatFilter; plugin: string }> = []; // allow plugins to add chat filters so they can hide messages from the client for data collection (ie. running /who and needing to hide it or dms from antiafk)
    private loaded: string[] = [];
    private freshDefaults: string[] = []; // plugins whose defaults are not in config.json yet

    constructor(
        private readonly config: Config,
        private readonly bus: EventBus,
        private readonly enrichment: EnrichmentEngine,
        private readonly http: HttpClient,
    ) {}

    private pluginConfig(name: string): Record<string, unknown> {
        return (this.config.builtInPlugins[name] as Record<string, unknown>) ?? {};
    }

    private ensureConfig(plugin: Plugin): void {
        const defaults = plugin.defaultConfig ?? { enabled: true }; // a plugin without a defaultConfig is still on by default, but has no settings to write
        if (applyPluginDefaults(this.config, plugin.name, defaults)) this.freshDefaults.push(plugin.name);
    }

    private persistDefaults(): void {
        if (this.freshDefaults.length === 0) return;
        const names = this.freshDefaults.splice(0);
        if (saveConfig(this.config)) log.info(`wrote default config for ${names.join(", ")} into config.json`);
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
            registerChatFilter: (filter) => this.chatFilters.push({ filter, plugin: plugin.name }),
        };
    }

    // does any plugin want this line kept away from the client
    hidesChat(msg: ChatMessage, session: Session): boolean {
        let hide = false;
        for (const { filter, plugin } of this.chatFilters) {
            try {
                // keep going after a hit so every filter still sees the line
                if (filter(msg, session) === true) hide = true;
            } catch (error) {
                log.error(`chat filter from "${plugin}" threw: ${error}`);
            }
        }
        return hide;
    }

    // a plugin is on unless its config block says enabled: false.
    // whoever registers a batch flushes the config afterwards, see registerAll
    async register(plugin: Plugin): Promise<void> {
        // a disabled plugin still gets its block, so the settings it would have
        // read are there to look at before turning it back on
        this.ensureConfig(plugin);
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
        this.persistDefaults();
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
        this.persistDefaults();
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
