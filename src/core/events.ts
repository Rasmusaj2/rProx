import { createLogger } from "../util/log";
import type { ProxyEvents } from "./types";

const log = createLogger("events");

type AnyHandler = (...args: unknown[]) => void;

// knockoff event bus, lets plugins subscribe to events and emit them. the proxy itself is the only emitter, plugins are only consumers.
// idk if you can do a subscriber style event bus in typescript similar to C# so this works for now
export class EventBus {
    private handlers: Partial<Record<keyof ProxyEvents, AnyHandler[]>> = {};

    on<K extends keyof ProxyEvents>(event: K, handler: ProxyEvents[K]): void {
        const map = this.handlers as Record<string, AnyHandler[]>;
        (map[event] ??= []).push(handler as AnyHandler);
    }

    off<K extends keyof ProxyEvents>(event: K, handler: ProxyEvents[K]): void {
        const list = this.handlers[event];
        if (!list) return;
        const index = list.indexOf(handler as AnyHandler);
        if (index >= 0) list.splice(index, 1);
    }

    emit<K extends keyof ProxyEvents>(event: K, ...args: Parameters<ProxyEvents[K]>): void {
        const list = this.handlers[event];
        if (!list) return;
        for (const handler of [...list]) { // copy, handlers may unsubscribe while we iterate
            try {
                handler(...args);
            } catch (error) {
                log.error(`handler for "${String(event)}" threw: ${error}`);
            }
        }
    }
}
