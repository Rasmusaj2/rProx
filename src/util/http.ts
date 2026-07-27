import {createLogger, type Logger} from "./log";

interface CacheEntry {
    expires: number,
    value: unknown
}

export interface HttpGet {
    headers?: Record<string, string>;
    cacheKey?: string;
    cacheDuration?: number; // in milliseconds
    timeout?: number; // in milliseconds
}

export class HttpClient {
    private cache = new Map<string, CacheEntry>();
    private inflightRequests = new Map<string, Promise<unknown>>();
    private log: Logger;

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
            if (hit && hit.expires > Date.now()) {
                this.log.debug(`Cache hit for ${key}`);
                return hit.value as T;
            }
        }

        const existingRequest = this.inflightRequests.get(key);
        if (existingRequest) {
            this.log.debug(`Waiting for inflight request for ${key}`);
            return existingRequest as Promise<T>;
        }

        const promise = this.fetch<T>(url, options)
            .then((value) => {
                if (ttl > 0) {
                    this.cache.set(key, { expires: Date.now() + ttl, value });
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
        const timeout = options.timeout ?? 5000;
    
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
            clearTimeout(timeout);
        }
    }
}
