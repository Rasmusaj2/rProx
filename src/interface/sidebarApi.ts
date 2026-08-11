// interface api for interacting with the bossbar at a higher level than in core
// SidebarInjector in core thinks in objectives, score holders and packet diffs.
// this api thinks in rows of text instead, letting you rewrite hypixels rows, add your own, and keep the sidebar up when hypixel does a change.
// every change here is a rule that stays in effect until removed

// FUNCTIONS
// createSidebarApi(host, options) - session & options in, a SidebarApi out
// SidebarApi.handlePacket(name, data) - feed every server packet through here, returns whether it was one we care about
// SidebarApi.flush() - render and send now instead of waiting for hypixel
// SidebarApi.dispose() - drop the pending flush. does not put hypixels sidebar back, call reset first
// SidebarApi.onChange(listener) - hypixel change, useful for detecting when a change happens on the scoreboard and you need to use it to modify the override

// PROPERTIES
// SidebarApi.enabled - stop drawing without forgetting anything
// SidebarApi.objective - the objective in the sidebar slot, undefined when there is no sidebar
// SidebarApi.title - the header, ours if we set one
// SidebarApi.serverTitle - what hypixel last set it to, whether or not we are covering it

// METHODS
// SidebarApi.read() - the whole sidebar, top row first, with our edits already in it
// SidebarApi.readLine(index) - one row. negative counts from the bottom, -1 being the last one
// SidebarApi.serverRows() - hypixels rows untouched by anything we do, handy for logging what your patterns are actually being matched against
// SidebarApi.find(match) - find a row by matcher
// SidebarApi.findAll(match) - find all rows by matcher
// SidebarApi.indexOf(match) - find the index of a row by matcher
// SidebarApi.has(match) - whether a row matching exists
// SidebarApi.setLine(text, index?) - one line of ours. no index puts it at the bottom, an index overwrites the row sitting there, negative counts from the bottom
// SidebarApi.setLines(lines, startIndex?) - the block of lines we own, replacing whatever we had before. no index draws them under hypixels rows, an index overwrites from there down
// SidebarApi.insertLine(index, text) - push the row at that index down instead of writing over it
// SidebarApi.prependLine(text) - insert a line at the top
// SidebarApi.updateLine(target, text) - retext a line of ours without moving it
// SidebarApi.removeLine(target) - a line of ours by id or handle, any row by index, or every row matching a regex
// SidebarApi.removeLines(match) - every row matching, now and every time hypixel sends it again
// SidebarApi.modifyLine(match, replacement) - rewrite matching rows. a regex matcher rewrites through String.replace so capture groups work, anything else replaces the whole line. a function gets the row and can return null to drop it.
// SidebarApi.setTitle(text) - a header of our own over hypixels. re-applied whenever they rewrite it
// SidebarApi.resetTitle() - drop our header and hand the sidebar back the way we found it
// SidebarApi.clear() - an empty board with nothing but the title on it, ours to draw on
// SidebarApi.reset() - hypixels sidebar back exactly as they sent it, every edit of ours dropped
// SidebarApi.clearRules() - drop the hides and rewrites but keep our own lines
// SidebarApi.setEnabled(enabled) - stop drawing without forgetting anything - hypixels sidebar comes back untouched and everything we had is still there when it goes back on
// SidebarApi.setVisible(visible) - take the sidebar off the screen entirely, title and all. clear() leaves the header up, this does not


import { SIDEBAR_LINES, SidebarInjector } from "../core/sidebar";
import { stripColorCodes } from "../util/mcColors";

export interface SidebarHost {
    sendPacket(name: string, data: unknown): void;
}

// sidebar row as the client sees it
export interface SidebarRow {
    index: number; // 0-maxLines, top row first
    text: string; // §-codes kept
    plain: string; // colors stripped, what regex matches
    owned: boolean; // true - ours, false - hypixels
    id?: string; // handle for lines of ours
    score?: number; // protocol score hypixel gave the row, higher sits higher
    entry?: string; // score holder behind the row, hypixel rows only
}

export type LineMatcher = string | RegExp | ((row: SidebarRow) => boolean);
export type LineReplacement = string | ((text: string, row: SidebarRow) => string | null | undefined);

export interface SidebarLine {
    readonly id: string;
    set(text: string): void;
    remove(): boolean;
    text(): string;
    index(): number; // where it currently sits, -1 if it is not being drawn
}

export interface SidebarApiOptions {
    maxLines?: number; // rows your client renders, 15 in vanilla 1.8
    autoFlush?: boolean; // coalesce a flush after every change, on by default
    onError?: (error: unknown) => void; // a bad packet or a throwing replacement
}

const BLANK = " "; // a board with nothing on it still needs one row to stand on. add a space
const MATCH_ALL = /(?:)/; // hides every hypixel row, for when we draw the lot ourselves

type HideRule = { kind: "hide"; match: LineMatcher; pattern?: RegExp };
type ModifyRule = { kind: "modify"; match: LineMatcher; pattern?: RegExp; replacement: LineReplacement };
type Rule = HideRule | ModifyRule;

interface OwnedLine {
    id: string;
    text: string;
    at?: number; // where it goes, left off means the block at the bottom
    insert: boolean; // splice in above whatever is there, or overwrite it
}

type Composed = Omit<SidebarRow, "index">;

function escapeRegex(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toPattern(match: LineMatcher): RegExp | undefined {
    if (typeof match === "string") return new RegExp(escapeRegex(match), "i");
    if (match instanceof RegExp) return new RegExp(match.source, match.flags.replace(/g/g, ""));
    return undefined; // cannot be expressed as a pattern, only a function can match it. cannot be handled by core
}

function sameMatcher(a: LineMatcher, b: LineMatcher): boolean {
    if (a instanceof RegExp && b instanceof RegExp) return a.source === b.source && a.flags === b.flags;
    return a === b;
}

export class SidebarApi {
    readonly injector: SidebarInjector;

    private readonly maxLines: number;
    private readonly autoFlush: boolean;
    private rules: Rule[] = [];
    private owned: OwnedLine[] = [];
    private counter = 0;
    private pending?: NodeJS.Immediate;
    private drawn: string[] = [];
    private listeners = new Set<(rows: SidebarRow[]) => void>();
    private active = true;
    private titleOverride?: string;
    private titleApplied = false;
    private titleDirty = false;
    private visible = true;
    private visibilityDirty = false;

    constructor(
        private readonly host: SidebarHost,
        private readonly options: SidebarApiOptions = {},
    ) {
        this.maxLines = Math.max(1, Math.floor(options.maxLines ?? SIDEBAR_LINES));
        this.autoFlush = options.autoFlush !== false;
        this.injector = new SidebarInjector(this.maxLines);
    }

    // UTILITY
    // server packet handler for scoreboard changes. returns true if it was one we care about, false if it should be handled elsewhere
    handlePacket(name: string, data: any): boolean {
        try {
            switch (name) {
                case "scoreboard_objective":
                    this.injector.applyObjective(data);
                    // hypixel rewrote a title, ours has to go back over it
                    if (data?.name === this.injector.objective) this.titleDirty = true;
                    break;
                case "scoreboard_display_objective":
                    this.injector.applyDisplayObjective(data);
                    this.titleDirty = true;
                    this.visibilityDirty = true;
                    break;
                case "scoreboard_score":
                    this.injector.applyScore(data);
                    break;
                case "scoreboard_team":
                    this.injector.applyTeam(data);
                    break;
                case "login":
                    // lobby change, do cleaning
                    this.injector.clear();
                    this.drawn = [];
                    this.titleApplied = false;
                    this.titleDirty = false;
                    this.visibilityDirty = false;
                    return true; // nothing new yet, wait
                default:
                    return false;
            }
        } catch (error) {
            this.fail(error);
            return true;
        }
        this.schedule();
        return true;
    }

    // render and send now instead of waiting for hypixel update
    flush(): void {
        if (this.pending) {
            clearImmediate(this.pending);
            this.pending = undefined;
        }
        try {
            this.apply();
        } catch (error) {
            this.fail(error);
        }
    }

    // drop the next hypixel flush
    dispose(): void {
        if (this.pending) clearImmediate(this.pending);
        this.pending = undefined;
        this.listeners.clear();
    }

    // fires after a render that changed what the client is looking at
    onChange(listener: (rows: SidebarRow[]) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    // READING
    // full sidebar, top to bottom
    read(): SidebarRow[] {
        return this.compose().map((row, index) => ({ ...row, index }));
    }

    // one row. negative counts from the bottom, -1 being the last one
    readLine(index: number): SidebarRow | undefined {
        const rows = this.read();
        return rows[index < 0 ? rows.length + index : index];
    }

    // hypixels rows untouched by anything we do, useful if you need data to write on custom scoreboard
    serverRows(): SidebarRow[] {
        return this.injector.rows().map((row, index) => ({
            index,
            text: row.text,
            plain: stripColorCodes(row.text),
            owned: false,
            score: row.score,
            entry: row.entry,
        }));
    }

    // find first row by matcher
    find(match: LineMatcher): SidebarRow | undefined {
        return this.read().find((row) => this.matches(match, row));
    }

    // find all rows by matcher
    findAll(match: LineMatcher): SidebarRow[] {
        return this.read().filter((row) => this.matches(match, row));
    }

    // find the index of a row by matcher
    indexOf(match: LineMatcher): number {
        return this.read().findIndex((row) => this.matches(match, row));
    }

    // exists on the sidebar, whether hypixel or ours
    has(match: LineMatcher): boolean {
        return this.indexOf(match) !== -1;
    }

    // the number of rows the client is currently drawing, including hypixels and ours
    get size(): number {
        return this.compose().length;
    }

    // the objective in the sidebar slot, undefined when there is no sidebar
    get objective(): string | undefined {
        return this.injector.objective;
    }

    // the header, ours if we set one - messes up nametagStats if custom header set sometimes
    get title(): string | undefined {
        return this.titleOverride ?? this.injector.title;
    }

    // what hypixel last set it to, whether or not we are covering it - used to fixed previously mentioned nametagStats issue
    get serverTitle(): string | undefined {
        return this.injector.title;
    }

    // WRITING TO SIDEBAR

    // one line of ours. no index puts it at the bottom, an index overwrites the
    // row sitting there, negative counts from the bottom
    setLine(text: string, index?: number): SidebarLine {
        const line: OwnedLine = { id: `line-${++this.counter}`, text, at: index, insert: false };
        this.owned.push(line);
        this.schedule();
        return this.handle(line.id);
    }

    // the block of lines we own, replacing whatever we had before. no index
    // draws them under hypixels rows, an index overwrites from there down
    setLines(lines: string[], startIndex?: number): SidebarLine[] {
        this.owned = lines.map((text, offset) => ({
            id: `line-${++this.counter}`,
            text,
            at: startIndex === undefined ? undefined : startIndex + offset,
            insert: false,
        }));
        this.schedule();
        return this.owned.map((line) => this.handle(line.id));
    }

    // push the row at that index down instead of writing over it
    insertLine(index: number, text: string): SidebarLine {
        const line: OwnedLine = { id: `line-${++this.counter}`, text, at: index, insert: true };
        this.owned.push(line);
        this.schedule();
        return this.handle(line.id);
    }

    // insert a line at the top
    prependLine(text: string): SidebarLine {
        return this.insertLine(0, text);
    }

    // retext a line of ours without moving it
    updateLine(target: string | SidebarLine, text: string): boolean {
        const id = typeof target === "string" ? target : target.id;
        const line = this.owned.find((own) => own.id === id);
        if (!line || line.text === text) return !!line;
        line.text = text;
        this.schedule();
        return true;
    }

    // a line of ours by id or handle, any row by index, or every row matching a regex
    removeLine(target: number | string | RegExp | SidebarLine): boolean {
        if (typeof target === "number") {
            const row = this.readLine(target);
            return row ? this.removeRow(row) : false;
        }
        if (target instanceof RegExp) return this.removeLines(target);
        const id = typeof target === "string" ? target : target.id;
        const before = this.owned.length;
        this.owned = this.owned.filter((own) => own.id !== id);
        if (this.owned.length === before) return false;
        this.schedule();
        return true;
    }

    // every row matching, now and every time hypixel sends it again
    removeLines(match: LineMatcher): boolean {
        return this.rule({ kind: "hide", match, pattern: toPattern(match) });
    }

    // rewrite matching rows
    modifyLine(match: LineMatcher, replacement: LineReplacement): boolean {
        return this.rule({ kind: "modify", match, pattern: toPattern(match), replacement });
    }

    // a header of our own over hypixels. re-applied whenever they rewrite it
    setTitle(text: string): void {
        if (this.titleOverride === text) return;
        this.titleOverride = text;
        this.titleDirty = true;
        this.schedule();
    }

    // set title back to base
    resetTitle(): void {
        if (this.titleOverride === undefined) return;
        this.titleOverride = undefined;
        this.schedule();
    }

    // an empty board with nothing but the title on it, ours to draw on
    clear(): void {
        this.owned = [];
        this.rules = [{ kind: "hide", match: MATCH_ALL, pattern: MATCH_ALL }];
        this.schedule();
    }

    // back to base hypixel
    reset(): void {
        this.owned = [];
        this.rules = [];
        this.active = true;
        this.resetTitle();
        this.setVisible(true);
        this.schedule();
    }

    // drop the hides and rewrites but keep our own lines
    clearRules(): void {
        if (!this.rules.length) return;
        this.rules = [];
        this.schedule();
    }

    // stop drawing while keeping everything we had
    setEnabled(enabled: boolean): void {
        if (this.active === enabled) return;
        this.active = enabled;
        this.schedule();
    }

    get enabled(): boolean {
        return this.active;
    }

    // take the sidebar off the screen entirely, title and all. clear() leaves header, this just toggles the scoreboard
    setVisible(visible: boolean): void {
        if (this.visible === visible) return;
        this.visible = visible;
        this.visibilityDirty = true;
        this.schedule();
    }

    // internal stuff
    // a line of ours, by id, with methods to manipulate it
    private handle(id: string): SidebarLine {
        return {
            id,
            set: (text: string) => void this.updateLine(id, text),
            remove: () => this.removeLine(id),
            text: () => this.owned.find((own) => own.id === id)?.text ?? "",
            index: () => this.read().findIndex((row) => row.id === id),
        };
    }

    // an identical matcher twice is the same instruction twice, not two of them
    private rule(rule: Rule): boolean {
        const existing = this.rules.findIndex((held) => held.kind === rule.kind && sameMatcher(held.match, rule.match));
        if (existing !== -1) this.rules[existing] = rule;
        else this.rules.push(rule);
        this.schedule();
        return true;
    }

    // actually remove a row from the sidebar, either one of ours or one of hypixels. returns whether it was there to be removed
    private removeRow(row: SidebarRow): boolean {
        // a line of ours goes away, one of hypixels has to be held down by its text
        if (row.owned && row.id) return this.removeLine(row.id);
        return this.removeLines(new RegExp(`^${escapeRegex(row.plain)}$`));
    }

    private matches(match: LineMatcher, row: SidebarRow, pattern?: RegExp): boolean {
        if (typeof match === "function") return match(row);
        return (pattern ?? toPattern(match)!).test(row.plain);
    }

    // what the client should end up looking at, top row first
    private compose(): Composed[] {
        const base: Composed[] = this.injector.rows().map((row) => ({
            text: row.text,
            plain: stripColorCodes(row.text),
            owned: false,
            score: row.score,
            entry: row.entry,
        }));
        if (!this.active) return base;

        // rules run over hypixels rows in the order they were added
        const kept: Composed[] = [];
        for (let index = 0; index < base.length; index++) {
            let row: Composed | undefined = base[index];
            for (const rule of this.rules) {
                if (!this.matches(rule.match, { ...row, index }, rule.pattern)) continue;
                if (rule.kind === "hide") {
                    row = undefined;
                    break;
                }
                const next = this.rewrite(rule, row, index);
                if (next == null) {
                    row = undefined;
                    break;
                }
                row = { ...row, text: next, plain: stripColorCodes(next) };
            }
            if (row) kept.push(row);
        }

        // the bottom block first, so an indexed line can still be aimed at it
        const rows = kept.concat(
            this.owned.filter((line) => line.at === undefined).map((line) => this.asRow(line)),
        );
        for (const line of this.owned) {
            if (line.at === undefined) continue;
            const at = Math.max(0, Math.min(line.at < 0 ? rows.length + line.at : line.at, rows.length));
            if (line.insert || at >= rows.length) rows.splice(at, 0, this.asRow(line));
            else rows[at] = this.asRow(line);
        }

        // a client only draws so many rows, and it draws the top ones. give up
        // hypixels from the bottom before ever giving up one of ours
        while (rows.length > this.maxLines) {
            const last = rows.map((row) => row.owned).lastIndexOf(false);
            rows.splice(last === -1 ? rows.length - 1 : last, 1);
        }
        return rows;
    }

    // a replacement that throws should cost one line, not the whole sidebar
    private rewrite(rule: ModifyRule, row: Composed, index: number): string | null {
        const { match, replacement } = rule;
        try {
            if (typeof replacement === "function") return replacement(row.text, { ...row, index }) ?? null;
            return match instanceof RegExp ? row.text.replace(match, replacement) : replacement;
        } catch (error) {
            this.fail(error);
            return row.text;
        }
    }

    private asRow(line: OwnedLine): Composed {
        return { text: line.text, plain: stripColorCodes(line.text), owned: true, id: line.id };
    }

    private schedule(): void {
        if (!this.autoFlush || this.pending) return;
        this.pending = setImmediate(() => {
            this.pending = undefined;
            try {
                this.apply();
            } catch (error) {
                this.fail(error);
            }
        });
    }

    // core can only omit patterns while it has rows of ours to put there, so we just put empty stuff to hold the place while we are not drawing anything
    private apply(): void {
        const rows = this.compose();
        const drawing = this.active && (this.rules.length > 0 || this.owned.length > 0);

        if (!drawing) {
            this.injector.omit([]);
            this.injector.set([]);
        } else if (this.overlayable()) {
            this.injector.omit(this.rules.map((rule) => rule.pattern!).filter(Boolean));
            this.injector.set(this.lines(rows.filter((row) => row.owned)));
        } else {
            this.injector.omit([MATCH_ALL]);
            this.injector.set(this.lines(rows));
        }

        this.applyVisibility();
        this.applyTitle();
        this.injector.flush((name, data) => this.host.sendPacket(name, data));
        this.announce(rows);
    }

    private lines(rows: Composed[]): string[] {
        return rows.length ? rows.map((row) => row.text) : [BLANK];
    }

    private overlayable(): boolean {
        return (
            this.rules.every((rule) => rule.kind === "hide" && rule.pattern) &&
            this.owned.every((line) => line.at === undefined)
        );
    }

    private applyTitle(): void {
        const objective = this.injector.objective;
        if (!objective) return;
        if (this.titleOverride === undefined) {
            // hand the header back the way we found it
            if (!this.titleApplied) return;
            this.titleApplied = false;
            const original = this.injector.title;
            if (original !== undefined) this.sendTitle(objective, original);
            return;
        }
        if (this.titleApplied && !this.titleDirty) return;
        this.sendTitle(objective, this.titleOverride);
        this.titleApplied = true;
        this.titleDirty = false;
    }

    private sendTitle(objective: string, text: string): void {
        // action 2 is an update, and 1.8 wants the render type back with it
        this.host.sendPacket("scoreboard_objective", {
            name: objective,
            action: 2,
            displayText: text,
            type: "integer",
        });
    }

    // an empty name in the sidebar slot is how you tell a client to draw nothing
    private applyVisibility(): void {
        if (!this.visibilityDirty) return;
        const objective = this.injector.objective;
        if (!objective) return;
        this.visibilityDirty = false;
        this.host.sendPacket("scoreboard_display_objective", {
            position: 1,
            name: this.visible ? objective : "",
        });
    }

    private announce(rows: Composed[]): void {
        if (!this.listeners.size) return;
        const text = rows.map((row) => row.text);
        if (text.length === this.drawn.length && text.every((line, index) => line === this.drawn[index])) return;
        this.drawn = text;
        const snapshot = rows.map((row, index) => ({ ...row, index }));
        for (const listener of this.listeners) {
            try {
                listener(snapshot);
            } catch (error) {
                this.fail(error);
            }
        }
    }

    private fail(error: unknown): void {
        this.options.onError?.(error);
    }
}

// sidebar api factory, so plugins can import it without knowing where it lives in core
export function createSidebarApi(host: SidebarHost, options?: SidebarApiOptions): SidebarApi {
    return new SidebarApi(host, options);
}
