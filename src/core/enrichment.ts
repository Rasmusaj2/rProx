import { createLogger } from "../util/log";
import type { HttpClient } from "../util/http";
import type { Config } from "../config";
import { renderPlayerLine } from "./chat";
import { tagsForGame } from "./game";
import type { DetectSource, Enricher, PlayerRef, Session, Tag } from "./types";

// Enrichers are a kind of inbuilt plugin that sees PlayerRefs and hands back tags to decorate their names with (most of the time)
// idk this was confusing even for myself and i wrote it
const log = createLogger("enrich");

// what a round of enrichers returned, shows the failed status incase of an error to allow the caller to decide if they want a retry
export interface Collected {
    tags: Tag[];
    failed: boolean;
}

// run tasks with a ceiling on how many are in flight
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let cursor = 0;
    const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
        while (cursor < items.length) {
            const i = cursor++;
            results[i] = await fn(items[i]);
        }
    });
    await Promise.all(workers);
    return results;
}

export class EnrichmentEngine {
    private enrichers: Enricher[] = [];
    // "sessionId:name" -> last lookup, debounces repeats. keyed per session on
    // purpose: several people share one instance, and a bare name would let one
    // players lobby check swallow everyone elses line for the same player.
    private recent = new Map<string, number>();

    constructor(
        private readonly http: HttpClient,
        private readonly config: Config,
        private readonly concurrency = 4,
        private readonly debounceMs = 15_000,
    ) {}

    register(enricher: Enricher): void {
        this.enrichers.push(enricher);
        log.debug(`registered enricher "${enricher.name}"`);
    }

    // drop a sessions debounce entries once it goes away, otherwise the map keeps
    forgetSession(id: string): void {
        const prefix = `${id}:`;
        for (const key of this.recent.keys()) {
            if (key.startsWith(prefix)) this.recent.delete(key);
        }
    }

    get count(): number {
        return this.enrichers.length;
    }

    // run every enricher for one player and merge what they hand back
    async collectDetailed(player: PlayerRef, source: DetectSource): Promise<Collected> {
        const ctx = { http: this.http, log, config: this.config, source };
        let failed = false;
        const perEnricher = await Promise.all(
            this.enrichers.map(async (enricher) => {
                try {
                    return (await enricher.enrich(player, ctx)) ?? [];
                } catch (error) {
                    failed = true;
                    log.debug(`enricher "${enricher.name}" failed for ${player.name}: ${error}`);
                    return [];
                }
            }),
        );
        return { tags: perEnricher.flat(), failed };
    }

    async collect(player: PlayerRef, source: DetectSource): Promise<Tag[]> {
        return (await this.collectDetailed(player, source)).tags;
    }

    // check one player and put a line in chat if theres anything worth showing
    async checkPlayer(
        player: PlayerRef,
        source: DetectSource,
        session: Session,
        options: { always?: boolean } = {},
    ): Promise<void> {
        if (this.enrichers.length === 0) return;
        if (session.isNpc(player.name)) return;
        const key = `${session.id}:${player.name.toLowerCase()}`;
        const last = this.recent.get(key) ?? 0;
        if (!options.always && Date.now() - last < this.debounceMs) return;
        this.recent.set(key, Date.now());

        // collect() hands back every game the enrichers know about, the chat
        // line only wants the one being played
        const tags = tagsForGame(await this.collect(player, source), session.game);
        if (tags.length === 0 && !options.always) return;
        session.chat.raw(renderPlayerLine(player.name, tags));
    }

    async checkPlayers(
        players: PlayerRef[],
        source: DetectSource,
        session: Session,
        options: { always?: boolean } = {},
    ): Promise<void> {
        await mapLimit(players, this.concurrency, (player) => this.checkPlayer(player, source, session, options));
    }
}
