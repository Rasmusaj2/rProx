import {createLogger, type Logger} from "./log";
import { TtlCache } from "./ttlCache";

export interface HttpGet {
    headers?: Record<string, string>;
    cacheKey?: string;
    cacheDuration?: number; // in milliseconds
    timeout?: number; // in milliseconds
}

export class HttpClient {
    private cache = new TtlCache<unknown>({ defaultTtl: 5 * 60_000, maxEntries: 500 });
    private inflightRequests = new Map<string, Promise<unknown>>();
    private log: Logger;

    private readonly userAgent =  "rProx/1.0";

    constructor(
        log?: Logger
    ) {
        this.log = log || createLogger("HttpClient");
    }

    async get<T = unknown>(url: string, options: HttpGet = {}): Promise<T | null> {
        const key = options.cacheKey ?? url;
        const ttl = options.cacheDuration ?? 0;

        if (ttl > 0) {
            const hit = this.cache.get(key);
            if (hit !== undefined) {
                this.log.debug(`Cache hit for ${key}`);
                return hit as T;
            }
        }

        const existingRequest = this.inflightRequests.get(key);
        if (existingRequest) {
            this.log.debug(`Waiting for inflight request for ${key}`);
            return existingRequest as Promise<T>;
        }

        const promise = this.fetch<T>(url, options)
            .then((value) => {
                if (ttl > 0 && value !== null) {
                    this.cache.set(key, value, ttl);
                }
                return value;
            })
            .finally(() => {
                this.inflightRequests.delete(key);
            });
        
        this.inflightRequests.set(key, promise);
        return promise;
    }

    private async fetch<T>(url: string, options: HttpGet): Promise<T | null> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), options.timeout ?? 5000);
    
        try {
            const response = await fetch(url, {
                method: "GET",
                headers: options.headers,
                signal: controller.signal
            });
            if (!response.ok) {
                this.log.error(`HTTP GET ${url} failed with status ${response.status}`);
                return null;
            }
            const data = await response.json();
            return data as T;
        } finally {
            clearTimeout(timer);
        }
    }

    async send<T = unknown>(
        url: string,
        method: "GET" | "POST" | "PUT" | "DELETE",
        options: {
            headers?: Record<string, string>;
            json?: unknown;
            form?: Record<string, string>;
            timeout?: number;
        } = {}): Promise<{ ok: boolean, status: number, data: T | null, headers: Record<string, string> }>
    {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), options.timeout ?? 5000);
        try {
            const headers: Record<string, string> = {
                "user-agent": this.userAgent,
                accept: "application/json",
                ...options.headers
            };
            let body: string | undefined;
            
            if (options.json !== undefined) {
                headers["content-type"] = "application/json";
                body = JSON.stringify(options.json);
            } else if (options.form !== undefined) {
                headers["content-type"] = "application/x-www-form-urlencoded";
                body = new URLSearchParams(options.form).toString();
            }
            const result = await fetch(url, {
                method,
                headers,
                body,
                signal: controller.signal
            });
            const seen: Record<string, string> = {};
            result.headers.forEach((value, key) => { seen[key.toLowerCase()] = value; });

            const raw = await result.text();
            let data: T | null = null;
            if (raw) {
                try {
                    data = JSON.parse(raw) as T;
                } catch {
                    this.log.debug(`HTTP ${method} ${url} returned ${result.status} with a non-JSON body`); // ratelimit stuff
                }
            }
            return { ok: result.ok, status: result.status, data, headers: seen };
        } catch (error) {
            this.log.error(`HTTP ${method} ${url} failed: ${error}`);
            return { ok: false, status: 0, data: null, headers: {} };
        }
        finally {
            clearTimeout(timer);
        }
    }

    // fetch json with caching and inflight request deduplication
    async getJson<T = unknown>(url: string, options: HttpGet = {}): Promise<T | null> {
    const key = options.cacheKey ?? url;
    const ttl = options.cacheDuration ?? 0;

    if (ttl > 0) {
      const hit = this.cache.get(key);
      if (hit !== undefined) return hit as T;
    }

    const existing = this.inflightRequests.get(key);
    if (existing) return existing as Promise<T | null>;

    const p = this.fetch<T>(url, options)
      .then((value) => {
        if (ttl > 0 && value !== null) {
          this.cache.set(key, value, ttl);
        }
        return value;
      })
      .finally(() => this.inflightRequests.delete(key));

    this.inflightRequests.set(key, p as Promise<unknown>);
    return p;
  }

  invalidate(...keys: string[]): void {
    for (const k of keys) this.cache.delete(k);
  }

  dispose(): void {
    this.cache.dispose();
    this.inflightRequests.clear();
  }
}
