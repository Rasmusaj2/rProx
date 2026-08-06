// scoreboard row enricher
// used to inject custom values and data into the sidebar, which hypixel keeps re-sending its own rows for every time its updated 
const MAX_ENTRY = 48; // 48 char limit per line
export const SIDEBAR_LINES = 15; // 15 rows limit 16th is title "HYPIXEL"
const SIDEBAR = 1;

// pads used to break a tie with a holder name that is already taken
const PADS = ["§r", "§r§r", "§r§r§r"];

interface ObjectivePacket {
    name: string;
    action: number; // 0 create, 1 remove, 2 update
    displayText?: string;
}

interface DisplayObjectivePacket {
    position: number;
    name: string;
}

interface ScorePacket {
    itemName: string; // the score holder, ie. the row
    action: number; // 0 create/update, 1 remove
    scoreName: string; // the objective, empty means every objective
    value?: number;
}

type Send = (name: string, data: unknown) => void;

type Scores = Map<string, number>; // holder -> score

// a row longer than the protocol allows gets cut, and a cut that lands mid
// color code would leave a dangling § for the client to draw
function clampEntry(line: string, max: number): string {
    const cut = line.length <= max ? line : line.slice(0, max);
    return cut.endsWith("§") ? cut.slice(0, -1) : cut;
}

function scoresFor(store: Map<string, Scores>, objective: string): Scores {
    let scores = store.get(objective);
    if (!scores) store.set(objective, (scores = new Map()));
    return scores;
}

export class SidebarInjector {
    private titles = new Map<string, string>(); // objective -> display title
    private server = new Map<string, Scores>(); // scores exactly as hypixel sent them
    private client = new Map<string, Scores>(); // scores the client is actually holding, ours included
    private display?: string; // objective in the sidebar slot
    private lines: string[] = []; // what we want at the bottom of it, top row first

    constructor(private readonly maxLines: number = SIDEBAR_LINES) {}

    get objective(): string | undefined {
        return this.display;
    }

    // sidebar title as the client sees it, §-codes and all
    get title(): string | undefined {
        return this.display ? this.titles.get(this.display) : undefined;
    }

    applyObjective(packet: ObjectivePacket): void {
        if (packet.action === 1) {
            // the client drops an objectives scores along with the objective,
            // and empties any display slot that was pointing at it - writing a
            // score to an objective it no longer has is how you upset a 1.8
            // client, so let go of the slot here too
            this.titles.delete(packet.name);
            this.server.delete(packet.name);
            this.client.delete(packet.name);
            if (this.display === packet.name) this.display = undefined;
            return;
        }
        if (typeof packet.displayText === "string") this.titles.set(packet.name, packet.displayText);
    }

    applyDisplayObjective(packet: DisplayObjectivePacket): void {
        if (packet.position !== SIDEBAR) return;
        this.display = packet.name || undefined;
    }

    applyScore(packet: ScorePacket): void {
        const { itemName, action, scoreName } = packet;
        if (action === 1) {
            // an empty objective name means drop this holder from all of them
            const targets = scoreName
                ? [scoreName]
                : new Set([...this.server.keys(), ...this.client.keys()]);
            for (const objective of targets) {
                this.server.get(objective)?.delete(itemName);
                this.client.get(objective)?.delete(itemName);
            }
            return;
        }
        const value = packet.value ?? 0;
        scoresFor(this.server, scoreName).set(itemName, value);
        scoresFor(this.client, scoreName).set(itemName, value);
    }

    // clear scoreboard and accept hypixels on login packet (ie. lobby swap)
    clear(): void {
        this.titles.clear();
        this.server.clear();
        this.client.clear();
        this.display = undefined;
    }

    // the rows we want, top first. an empty list gives hypixel its sidebar back
    set(lines: string[]): void {
        this.lines = lines;
    }

    // send whatever it takes to turn the clients scoreboard into what we want
    // hypixel will resend rows, so we need to keep track of what the client is actually holding and keep overwriting hypixel
    flush(send: Send): void {
        const objectives = new Set([...this.server.keys(), ...this.client.keys()]);
        // a sidebar we have not seen a single score for still wants our rows
        if (this.display && this.lines.length) objectives.add(this.display);

        for (const objective of objectives) {
            const target = this.targetFor(objective);
            const current = this.client.get(objective) ?? new Map<string, number>();

            for (const entry of current.keys()) {
                if (target.has(entry)) continue;
                send("scoreboard_score", { itemName: entry, action: 1, scoreName: objective });
            }
            for (const [entry, value] of target) {
                if (current.get(entry) === value) continue;
                send("scoreboard_score", { itemName: entry, action: 0, scoreName: objective, value });
            }

            if (target.size) this.client.set(objective, target);
            else this.client.delete(objective);
        }
    }

    // what the client should be holding for one objective. everything but the
    // sidebar is left exactly as hypixel sent it, which is also how our rows
    private targetFor(objective: string): Scores {
        const server = this.server.get(objective) ?? new Map<string, number>();
        if (objective !== this.display || this.lines.length === 0) return new Map(server);

        // ascending score, which is bottom to top on screen
        const byScore = [...server].sort((a, b) => a[1] - b[1]);
        // never hide more of hypixels rows than we are putting back, so a
        // sidebar we cannot fit into ends up no less informative than it started
        const overflow = server.size + this.lines.length - this.maxLines;
        const hidden = Math.max(0, Math.min(overflow, this.lines.length));

        const target = new Map(byScore.slice(hidden));
        // one score per row, counting down from whatever survived
        const floor = byScore[hidden]?.[1] ?? this.lines.length;
        this.lines.forEach((line, index) => {
            target.set(this.entryFor(line, target), floor - 1 - index);
        });
        return target;
    }

    // the holder name is the row text so the text is the key
    // if the text is already taken, we pad it with §r until it is unique
    private entryFor(line: string, taken: Scores): string {
        const base = clampEntry(line, MAX_ENTRY);
        if (!taken.has(base)) return base;
        for (const pad of PADS) {
            const candidate = clampEntry(line, MAX_ENTRY - pad.length) + pad;
            if (!taken.has(candidate)) return candidate;
        }
        return base;
    }
}
