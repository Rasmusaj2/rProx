import readline from "node:readline";

// terminal helper functionality
// used mostly for onboarding

const CLEAR_TO_END = "\x1b[0J";
const CURSOR_UP = (n: number) => `\x1b[${n}A`;
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";

export class CancelledError extends Error {
    constructor() {
        super("cancelled");
        this.name = "CancelledError";
    }
}

export const style = {
    bold: (text: string) => `\x1b[1m${text}\x1b[0m`,
    dim: (text: string) => `\x1b[90m${text}\x1b[0m`,
    cyan: (text: string) => `\x1b[36m${text}\x1b[0m`,
    green: (text: string) => `\x1b[32m${text}\x1b[0m`,
    red: (text: string) => `\x1b[31m${text}\x1b[0m`,
    yellow: (text: string) => `\x1b[33m${text}\x1b[0m`,
};

export class Terminal {
    private pendingKeys: readline.Key[] = []; // keys that arrived before anything asked
    private keyWaiters: Array<(key: readline.Key) => void> = [];
    private rendered = 0;
    private raw = false;

    constructor() {
        readline.emitKeypressEvents(process.stdin);
        process.stdin.on("keypress", this.onKeypress);
    }

    private onKeypress = (_text: string | undefined, key: readline.Key): void => {
        const waiter = this.keyWaiters.shift();
        if (waiter) waiter(key);
        else this.pendingKeys.push(key);
    };

    // one keypress, menus drive themselves with these
    readKey(): Promise<readline.Key> {
        this.enterRaw();
        const buffered = this.pendingKeys.shift();
        if (buffered) return Promise.resolve(buffered);
        return new Promise((resolve) => this.keyWaiters.push(resolve));
    }

    say(text = ""): void {
        process.stdout.write(`${text}\n`);
    }

    // draw a block of lines that the next render() will replace in place
    render(lines: string[]): void {
        this.clearRender();
        process.stdout.write(`${lines.join("\n")}\n`);
        this.rendered = lines.length;
    }

    clearRender(): void {
        if (this.rendered === 0) return;
        process.stdout.write(`${CURSOR_UP(this.rendered)}${CLEAR_TO_END}`);
        this.rendered = 0;
    }

    hideCursor(): void {
        process.stdout.write(HIDE_CURSOR);
    }

    showCursor(): void {
        process.stdout.write(SHOW_CURSOR);
    }

    async ask(query: string, options: { default?: string } = {}): Promise<string> {
        const suffix = options.default !== undefined ? ` ${style.dim(`[${options.default}]`)}` : "";
        const answer = (await this.readLine(`${query}${suffix} `, false)).trim();
        return answer.length > 0 ? answer : (options.default ?? "");
    }

    async secret(query: string): Promise<string> {
        return (await this.readLine(query, true)).trim();
    }

    async confirm(query: string, fallback = true): Promise<boolean> {
        const answer = (await this.readLine(`${query} ${fallback ? "[Y/n]" : "[y/N]"} `, false)).trim().toLowerCase();
        if (answer.length === 0) return fallback;
        return answer === "y" || answer === "yes";
    }

    close(): void {
        this.clearRender();
        this.showCursor();
        this.exitRaw();
        process.stdin.removeListener("keypress", this.onKeypress);
    }

    // hand-built line editor: print or mask each key, enter submits, backspace
    // deletes, ctrl+c cancels
    private async readLine(query: string, masked: boolean): Promise<string> {
        process.stdout.write(query);
        let buffer = "";
        while (true) {
            const key = await this.readKey();
            if (key.ctrl && key.name === "c") throw new CancelledError();
            if (key.name === "return" || key.name === "enter") break;
            if (key.name === "backspace") {
                if (buffer.length > 0) {
                    buffer = buffer.slice(0, -1);
                    process.stdout.write("\b \b");
                }
                continue;
            }
            const text = key.sequence ?? "";
            // ignore escape sequences (arrows, function keys) and control chars
            if (text.length > 0 && !text.startsWith("\x1b") && text >= " ") {
                buffer += text;
                process.stdout.write(masked ? "*".repeat(text.length) : text);
            }
        }
        process.stdout.write("\n");
        return buffer;
    }

    private enterRaw(): void {
        if (this.raw) return;
        this.raw = true;
        if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function") process.stdin.setRawMode(true);
        process.stdin.resume();
    }

    private exitRaw(): void {
        if (!this.raw) return;
        this.raw = false;
        if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function") process.stdin.setRawMode(false);
        process.stdin.pause();
    }
}
