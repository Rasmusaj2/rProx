export interface TtlCacheOptions {
    defaultTtl: number,
    maxEntries?: number,
    sweepIntervalMs?: number
}

export interface TtlCacheStats {
    size: number,
    sweeps: number,
    evictions: number,
}

interface Entry<V> {
    value: V,
    expires: number,
}

const SWEEP_MIN_MS = 1000;

export class TtlCache<V> {
    private entries = new Map<string, Entry<V>>();
    private timer: NodeJS.Timeout | undefined;
    private sweeps = 0;
    private evictions = 0;

    constructor(private readonly options: TtlCacheOptions) {}

    get size(): number {
        return this.entries.size;
    }

    stats(): TtlCacheStats {
        return { size: this.entries.size, sweeps: this.sweeps, evictions: this.evictions };
    }

    get(key: string): V | undefined {
        const entry = this.entries.get(key);
        if (!entry) return undefined;
        if (entry.expires <= Date.now()) {
            this.entries.delete(key);
            return undefined;
        }
        return entry.value;
    }

    has(key: string): boolean {
        return this.get(key) !== undefined;
    }

    set(key: string, value: V, ttl?: number): void {
        const ms = ttl ?? this.options.defaultTtl;
        this.entries.set(key, { value, expires: Date.now() + Math.max(1, ms) });
        this.enforceLimit();
        this.ensureSweep();
    }

    delete(key: string): void {
        this.entries.delete(key);
    }

    clear(): void {
        this.entries.clear();
    }

    keys(): string[] {
        const now = Date.now();
        const out: string[] = [];
        for (const [key, entry] of this.entries) {
            if (entry.expires <= now) this.entries.delete(key);
            else out.push(key);
        }
        return out;
    }

    prune(now = Date.now()): number {
        let dropped = 0;
        for (const [key, entry] of this.entries) {
            if (entry.expires <= now) {
                this.entries.delete(key);
                dropped++;
            }
        }
        return dropped;
    }

    dispose(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
        this.entries.clear();
    }

    private enforceLimit(): void {
        const max = this.options.maxEntries;
        if (!max) return;
        while (this.entries.size > max) {
            const oldest = this.entries.keys().next();
            if (oldest.done) break;
            this.entries.delete(oldest.value);
            this.evictions++;
        }
    }

    private ensureSweep(): void {
        if (this.timer) return;
        const interval = Math.max(SWEEP_MIN_MS, this.options.sweepIntervalMs ?? 30_000);
        this.timer = setInterval(() => {
            this.sweeps++;
            this.prune();
            if (this.entries.size === 0) {
                clearInterval(this.timer);
                this.timer = undefined;
            }
        }, interval);
        this.timer.unref?.();
    }
}
