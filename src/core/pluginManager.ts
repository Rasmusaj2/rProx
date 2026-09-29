import { readdirSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { createLogger } from "../util/log";
import { fromBase, isPackaged } from "../util/paths";
import type { HttpClient } from "../util/http";
import { applyPluginDefaults, saveConfig, type Config } from "../config";
import { installHostModules } from "./pluginHost";
import type { EventBus } from "./events";
import type { EnrichmentEngine } from "./enrichment";
import type { ChatFilter, ChatMessage, ClientFilter, CommandHandler, Plugin, PluginApi, Session } from "./types";

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
    private clientFilters: Array<{ filter: ClientFilter; plugin: string }> = []; // allows blocking client packets from being sent to the server
    private loaded: string[] = [];
    private freshDefaults: string[] = []; // plugins whose defaults are not in config.json yet
    private sources = new Map<string, { plugin: Plugin; file?: string }>(); // plugin name -> the instance to reload from
    private cleanups = new Map<string, Array<() => void>>(); // what each plugin registered, so a toggle can undo it
    private loading = new Set<string>(); // plugins with a setup in flight, so a double toggle cannot run it twice

    constructor(
        private readonly config: Config,
        private readonly bus: EventBus,
        private readonly enrichment: EnrichmentEngine,
        private readonly http: HttpClient,
    ) {}

    private pluginConfig(name: string): Record<string, unknown> {
        return (this.config.builtInPlugins[name] as Record<string, unknown>) ?? {};
    }

    private track(name: string, cleanup: () => void): void {
        const list = this.cleanups.get(name) ?? [];
        list.push(cleanup);
        this.cleanups.set(name, list);
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
            enrichment: this.enrichment,
            pluginConfig: this.pluginConfig(plugin.name),
            on: (event, handler) => {
                // handle subscription events for the plugin
                this.bus.on(event, handler);
                this.track(plugin.name, () => this.bus.off(event, handler));
            },
            registerEnricher: (enricher) => {
                // enricher voodoo plugin magic
                this.enrichment.register(enricher);
                this.track(plugin.name, () => this.enrichment.unregister(enricher));
            },
            registerCommand: (name, handler, help) => {
                const key = name.toLowerCase();
                if (this.commands.has(key)) {
                    log.warn(`command "${name}" already registered, overriding it (plugin ${plugin.name})`);
                }
                const record: RegisteredCommand = { handler, help, plugin: plugin.name };
                this.commands.set(key, record);
                // only drop it on unload if nobody replaced it since
                this.track(plugin.name, () => {
                    if (this.commands.get(key) === record) this.commands.delete(key);
                });
            },
            registerChatFilter: (filter) => {
                const entry = { filter, plugin: plugin.name };
                this.chatFilters.push(entry);
                this.track(plugin.name, () => {
                    const index = this.chatFilters.indexOf(entry);
                    if (index >= 0) this.chatFilters.splice(index, 1);
                });
            },
            registerClientFilter: (filter) => {
                const entry = { filter, plugin: plugin.name };
                this.clientFilters.push(entry);
                this.track(plugin.name, () => {
                    const index = this.clientFilters.indexOf(entry);
                    if (index >= 0) this.clientFilters.splice(index, 1);
                });
            },
            onCleanup: (handler) => this.track(plugin.name, handler),
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

    // does any plugin want this client packet kept away from hypixel
    blocksClient(name: string, data: unknown, session: Session): boolean {
        if (this.clientFilters.length === 0) return false;
        let block = false;
        for (const { filter, plugin } of this.clientFilters) {
            try {
                // keep going after a hit so every filter still sees the packet
                if (filter(name, data, session) === true) block = true;
            } catch (error) {
                log.error(`client filter from "${plugin}" threw: ${error}`);
            }
        }
        return block;
    }

    // a plugin is on unless its config block says enabled: false.
    // whoever registers a batch flushes the config afterwards, see registerAll
    async register(plugin: Plugin, file?: string): Promise<void> {
        // remember how to bring it back if config toggles it on later
        if (!this.sources.has(plugin.name)) this.sources.set(plugin.name, { plugin, file });
        // a disabled plugin still gets its block, so the settings it would have
        // read are there to look at before turning it back on
        this.ensureConfig(plugin);
        if (this.pluginConfig(plugin.name).enabled === false && !plugin.forceLoad) { // yes this does mean you can disable external plugins in the config.json file
            // i should probably make a seperate config thing for external plugins, but honestly i dont care enough and they should implement it themselves for now
            // untill i get around to making a "externalPlugins" config area in the config.json file which external plugins can have a default config written to
            log.info(`skipping disabled plugin "${plugin.name}"`);
            return;
        }
        if (this.loaded.includes(plugin.name) || this.loading.has(plugin.name)) return; // already on, a toggle is a no-op
        this.loading.add(plugin.name);
        try {
            await plugin.setup(this.buildApi(plugin));
            this.loaded.push(plugin.name);
            log.info(`loaded plugin "${plugin.name}"${plugin.version ? ` v${plugin.version}` : ""}`);
        } catch (error) {
            this.teardown(plugin.name); // drop whatever half of setup managed to register
            log.error(`failed to load plugin "${plugin.name}": ${error}`);
        } finally {
            this.loading.delete(plugin.name);
        }
    }

    // undo everything a plugin registered through the api, then let it clear the
    // timers only it knows about (see onCleanup)
    private teardown(name: string): void {
        for (const cleanup of this.cleanups.get(name) ?? []) {
            try {
                cleanup();
            } catch (error) {
                log.error(`cleanup for plugin "${name}" threw: ${error}`);
            }
        }
        this.cleanups.delete(name);
        const index = this.loaded.indexOf(name);
        if (index >= 0) this.loaded.splice(index, 1);
    }

    // config toggled a plugins enabled flag, bring it up or down to match
    async setEnabled(name: string, enabled: boolean): Promise<boolean> {
        const source = this.sources.get(name);
        if (!source) {
            log.warn(`cannot toggle "${name}", no such plugin`);
            return false;
        }
        if (!enabled && source.plugin.forceLoad) {
            log.warn(`plugin "${name}" is required and cannot be disabled`);
            return false;
        }
        if (enabled) {
            if (this.loaded.includes(name) || this.loading.has(name)) return false;
            await this.register(source.plugin, source.file);
            return this.loaded.includes(name);
        }
        if (!this.loaded.includes(name)) return false;
        this.teardown(name);
        log.info(`unloaded plugin "${name}" (disabled in config)`);
        return true;
    }

    isForced(name: string): boolean {
        return this.sources.get(name)?.plugin.forceLoad === true;
    }

    async registerAll(plugins: Plugin[]): Promise<void> {
        for (const plugin of plugins) await this.register(plugin);
        this.persistDefaults();
    }

    // a plugin file off the disk. require over import wherever we can, because a
    // packaged exe runs a snapshot node with no dynamic import at all, while
    // require falls through to the real filesystem beside the exe just fine
    private static async importPlugin(path: string): Promise<any> {
        if (extname(path) !== ".mjs") {
            try {
                // resolved as if from the plugin file, so its own relative requires
                // and any node_modules it sits next to still work
                return createRequire(path)(path);
            } catch (error) {
                // a .js plugin written as esm, ie one with a package.json of type module beside it
                if ((error as NodeJS.ErrnoException)?.code !== "ERR_REQUIRE_ESM") throw error; // honestly dont know what this does
            }
        }
        if (isPackaged()) {
            throw new Error("esm plugins cannot be loaded from a packaged build, write it as commonjs (module.exports)");
        }
        return import(pathToFileURL(path).href);
    }

    // drop-in plugins from the configured directory
    async loadExternal(): Promise<void> {
        const dir = this.externalDir();
        if (!existsSync(dir)) return;
        installHostModules(); // before anything requires "rprox"
        for (const file of this.availableExternal()) {
            if (extname(file) === ".ts" && isPackaged()) {
                log.warn(`ignoring ${file}, a packaged build has no typescript compiler - ship it as .js`);
                continue;
            }
            try {
                const mod = await PluginManager.importPlugin(join(dir, file));
                const plugin: Plugin = mod.default ?? mod.plugin ?? mod;
                if (!plugin?.name || typeof plugin.setup !== "function") {
                    log.warn(`ignoring ${file}, not a valid plugin (needs { name, setup })`);
                    continue;
                }
                await this.register(plugin, file);
            } catch (error) {
                log.error(`failed to import external plugin ${file}: ${error}`);
            }
        }
        this.persistDefaults();
    }

    private externalDir(): string {
        return fromBase(this.config.pluginDirectory);
    }

    // what the plugin directory has to offer, loaded or not
    availableExternal(): string[] {
        const dir = this.externalDir();
        if (!existsSync(dir)) return [];
        return readdirSync(dir).filter(
            (file) => [".js", ".mjs", ".cjs", ".ts"].includes(extname(file)) && !file.endsWith(".d.ts"), // a .d.ts is types for the author, not a plugin
        );
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
