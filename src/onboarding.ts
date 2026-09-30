import { applyPluginDefaults, type Config } from "./config";
import { AccountStore } from "./proxy/accounts";
import { LinkManager } from "./proxy/linking";
import { CancelledError, Terminal, style } from "./util/term";
import type { Plugin } from "./core/types";

// first-run setup
const HYPIXEL_KEYS = "https://developer.hypixel.net";

type Block = Record<string, unknown>;
type Kind = "object" | "array" | "boolean" | "number" | "string" | "null";

export async function runOnboarding(config: Config, plugins: Plugin[]): Promise<void> {
    const term = new Terminal();
    // every plugin gets its config block now, so the menu has settings to show
    for (const plugin of plugins) applyPluginDefaults(config, plugin.name, plugin.defaultConfig ?? { enabled: true });

    try {
        welcome(term);
        await collectApiKeys(term, config);
        await linkAccount(term, config);
        await configurePlugins(term, config, plugins);
        term.say(style.green("Setup complete. Starting the proxy..."));
        term.say("");
    } catch (error) {
        if (error instanceof CancelledError) {
            term.say(style.yellow("\nSetup cancelled. Keeping what was entered so far."));
        } else {
            term.say(style.red(`\nSetup hit an error: ${(error as Error).message}`));
            term.say(style.dim("Continuing with the current settings..."));
        }
    } finally {
        term.close();
    }
}

function welcome(term: Terminal): void {
    term.say("");
    term.say(style.bold("  rProx first-time setup"));
    term.say(style.dim("  This only runs once. Everything here can be changed later with //config,"));
    term.say(style.dim("  and by editing the config.json file next to the proxy."));
    term.say("");
}

async function collectApiKeys(term: Terminal, config: Config): Promise<void> {
    term.say(style.bold("  API keys"));
    term.say(style.dim("  Press Enter to skip anything you do not have yet."));
    term.say("");

    const stats = blockFor(config, "hypixelStats");
    if (stats) {
        await promptKey(term, stats, "apiKey", "Hypixel API key", [
            `Create one at ${style.cyan(HYPIXEL_KEYS)} (Developer Dashboard -> API Keys).`,
            "Powers player stats: //bw, //sw, //duels and the nametag/tab stats.",
        ]);
    }

    const urchin = blockFor(config, "urchin");
    if (urchin) {
        await promptKey(term, urchin, "apiKey", "Urchin API key (optional)", [
            `Find it using /dashboard using the Urchin Discord Bot.`,
            "Adds anti-cheat / blacklist tags next to names.",
        ]);
    }
    term.say("");
}

async function linkAccount(term: Terminal, config: Config): Promise<void> {
    term.say(style.bold("  Microsoft account"));
    term.say(style.dim("  rProx signs in as you to reach Hypixel. Sign in once here and it is remembered."));
    const wanted = await term.confirm("  Sign in a Microsoft account now?", false);
    if (!wanted) {
        term.say(style.dim("  Skipped. The proxy will ask the first time you connect instead."));
        term.say("");
        return;
    }

    const accounts = new AccountStore(config.auth.dir);
    const links = new LinkManager(accounts, config.auth.requireMatchingAccount);

    term.say("");
    const result = await links.session((code) => {
        term.say(style.bold("  Sign in with Microsoft:"));
        term.say(`    Open  ${style.cyan(code.verificationUri)}`);
        term.say(`    Enter code  ${style.bold(style.cyan(code.userCode))}`);
        term.say(style.dim("  Waiting for you to finish..."));
        term.say("");
    });

    if (result.status === "ok") term.say(style.green(`  Signed in as ${result.username}.`));
    else term.say(style.red(`  Sign-in failed: ${result.error}`));
    term.say("");
}

async function configurePlugins(term: Terminal, config: Config, plugins: Plugin[]): Promise<void> {
    if (plugins.length === 0) return;
    term.say(style.bold("  Plugins"));
    term.say(style.dim("  Turn features on/off, and open any plugin to edit its settings."));

    let index = 0;
    const block = (name: string) => blockFor(config, name) ?? {};
    const draw = () => {
        const rows = plugins.map((plugin, i) => {
            const on = plugin.forceLoad === true || block(plugin.name).enabled !== false;
            const marker = on ? style.green("[X]") : style.dim("[ ]");
            const locked = plugin.forceLoad ? style.dim(" (required)") : "";
            const cursor = i === index ? style.cyan(">") : " ";
            return `${cursor} ${marker} ${plugin.name}${locked}`;
        });
        term.render([...rows, style.dim("  up/down move  -  Enter toggle  -  right arrow settings  -  q done")]);
    };

    term.hideCursor();
    try {
        while (true) {
            draw();
            const key = await term.readKey();
            if (key.ctrl && key.name === "c") throw new CancelledError();
            if (key.name === "up") index = (index - 1 + plugins.length) % plugins.length;
            else if (key.name === "down") index = (index + 1) % plugins.length;
            else if (key.name === "return" || key.name === "space") {
                if (!plugins[index].forceLoad) {
                    const target = block(plugins[index].name);
                    target.enabled = target.enabled === false;
                }
            } else if (key.name === "right" || key.name === "e" || key.name === "c") {
                term.clearRender();
                term.showCursor();
                await editBlock(term, plugins[index].name, block(plugins[index].name));
                term.hideCursor();
            } else if (key.name === "q" || key.name === "escape") {
                break;
            }
        }
    } finally {
        term.clearRender();
        term.showCursor();
    }
    term.say("");
}

// a tiny console version of the in-game config menu: walk the plugin config
// object and edit scalar values in place
async function editBlock(term: Terminal, label: string, node: Block): Promise<void> {
    const stack: Array<{ label: string; node: Block }> = [{ label, node }];
    let index = 0;

    term.hideCursor();
    try {
        while (true) {
            const current = stack[stack.length - 1];
            const keys = Object.keys(current.node);
            const count = keys.length + 1; // trailing "< back"
            if (index >= count) index = count - 1;

            const rows = keys.map((key, i) => {
                const value = current.node[key];
                const cursor = i === index ? style.cyan(">") : " ";
                const drill = isBlock(value) ? style.dim(" (open)") : "";
                return `${cursor} ${key}: ${preview(value)}${drill}`;
            });
            const backCursor = index === keys.length ? style.cyan(">") : " ";
            rows.push(`${backCursor} ${style.dim("< back")}`);

            term.render([
                style.bold(`  ${stack.map((frame) => frame.label).join(" > ")}`),
                ...rows,
                style.dim("  up/down move  -  Enter edit  -  b back  -  q done"),
            ]);

            const key = await term.readKey();
            if (key.ctrl && key.name === "c") throw new CancelledError();
            if (key.name === "up") { index = (index - 1 + count) % count; continue; }
            if (key.name === "down") { index = (index + 1) % count; continue; }
            if (key.name === "b" || key.name === "left" || key.name === "backspace" || key.name === "escape") {
                if (stack.length > 1) { stack.pop(); index = 0; }
                else break;
                continue;
            }
            if (key.name === "q") break;
            if (key.name !== "return" && key.name !== "space") continue;

            if (index === keys.length) { // "< back"
                if (stack.length > 1) { stack.pop(); index = 0; }
                else break;
                continue;
            }

            const keyName = keys[index];
            const value = current.node[keyName];
            if (isBlock(value)) {
                stack.push({ label: keyName, node: value as Block });
                index = 0;
                continue;
            }
            if (typeof value === "boolean") {
                current.node[keyName] = !value;
                continue;
            }

            term.clearRender();
            term.showCursor();
            const edited = await promptValue(term, keyName, value);
            term.hideCursor();
            if (edited !== undefined) current.node[keyName] = edited;
        }
    } finally {
        term.clearRender();
        term.showCursor();
    }
}

async function promptValue(term: Terminal, key: string, value: unknown): Promise<unknown | undefined> {
    term.say(`  ${style.bold(key)} ${style.dim(`(${kindOf(value)})`)}`);
    term.say(style.dim(`    now: ${formatValue(value)}`));
    const raw = await term.ask("  new value (blank keeps it):");
    if (raw.trim().length === 0) return undefined;
    const result = coerce(value, raw);
    if ("error" in result) {
        term.say(style.red(`  ${result.error}`));
        return undefined;
    }
    return result.value;
}

async function promptKey(term: Terminal, block: Block, key: string, label: string, hints: string[]): Promise<void> {
    term.say(style.bold(`  ${label}`));
    for (const hint of hints) term.say(`    ${style.dim(hint)}`);
    const current = typeof block[key] === "string" ? (block[key] as string) : "";
    if (current) term.say(style.dim(`    current: ${mask(current)}`));
    const answer = await term.secret("    paste key > ");
    if (answer.length > 0) block[key] = answer;
    term.say("");
}

function blockFor(config: Config, name: string): Block | undefined {
    const existing = config.builtInPlugins[name];
    if (isBlock(existing)) return existing;
    if (existing === undefined) return undefined;
    const block: Block = {};
    config.builtInPlugins[name] = block;
    return block;
}

function isBlock(value: unknown): value is Block {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function kindOf(value: unknown): Kind {
    if (value === null || value === undefined) return "null";
    if (Array.isArray(value)) return "array";
    if (isBlock(value)) return "object";
    const type = typeof value;
    if (type === "boolean" || type === "number" || type === "string") return type;
    return "null";
}

function preview(value: unknown): string {
    switch (kindOf(value)) {
        case "object": return style.dim(`{${Object.keys(value as object).length}}`);
        case "array": return style.dim(`[${(value as unknown[]).length}]`);
        case "boolean": return value ? style.green("true") : style.red("false");
        case "null": return style.dim("null");
        default: return style.yellow(clip(String(value), 40));
    }
}

function formatValue(value: unknown): string {
    if (isBlock(value) || Array.isArray(value)) return JSON.stringify(value);
    return String(value);
}

function mask(value: string): string {
    if (value.length <= 6) return "******";
    return `${value.slice(0, 4)}...${value.slice(-2)}`;
}

function clip(text: string, max: number): string {
    return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

// same coercion the in-game editor uses: keep the setting the type it already had
function coerce(current: unknown, raw: string): { value: unknown } | { error: string } {
    const text = raw.trim();
    const lower = text.toLowerCase();
    if (lower === "null") return { value: null };

    switch (kindOf(current)) {
        case "boolean": {
            if (["true", "yes", "on", "1", "enable", "enabled"].includes(lower)) return { value: true };
            if (["false", "no", "off", "0", "disable", "disabled"].includes(lower)) return { value: false };
            if (lower === "toggle") return { value: !current };
            return { error: "expected true or false" };
        }
        case "number": {
            const number = Number(text);
            if (!Number.isFinite(number)) return { error: `"${clip(text, 20)}" is not a number` };
            return { value: number };
        }
        case "array": {
            if (["clear", "empty", "[]", "none"].includes(lower)) return { value: [] };
            if (text.startsWith("[")) {
                try {
                    const parsed = JSON.parse(text);
                    if (!Array.isArray(parsed)) return { error: "that json is not a list" };
                    return { value: parsed };
                } catch (error) {
                    return { error: `bad json: ${(error as Error).message}` };
                }
            }
            const sample = (current as unknown[])[0];
            const parts = text.split(",").map((part) => part.trim()).filter(Boolean);
            if (typeof sample === "number") {
                const numbers = parts.map(Number);
                if (numbers.some((number) => !Number.isFinite(number))) return { error: "expected numbers" };
                return { value: numbers };
            }
            return { value: parts };
        }
        default: {
            try {
                return { value: JSON.parse(text) };
            } catch {
                return { value: raw };
            }
        }
    }
}
