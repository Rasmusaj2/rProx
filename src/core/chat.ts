import loadPrismarineChat from "prismarine-chat";
import { COLOR_CODES, stripColorCodes, type McColorName } from "../util/mcColors";
import type { ChatInjector, ChatMessage, Tag } from "./types";

export const PREFIX = "§8[§brProx§8]";

// one styled span of a chat component
export interface ChatPart {
    text: string;
    color?: McColorName;
    bold?: boolean;
    italic?: boolean;
    underlined?: boolean;
    tooltip?: string;
    runCommand?: string;
    suggestCommand?: string;
}

type ChatRegistry = {
    fromNotch(msg: unknown): { toString(): string; toMotd(): string };
};

const registries = new Map<string, ChatRegistry>();

function registryFor(version: string): ChatRegistry {
    let registry = registries.get(version);
    if (!registry) {
        registry = loadPrismarineChat(version) as ChatRegistry;
        registries.set(version, registry);
    }
    return registry;
}

function safeJson(str: string): unknown {
    try {
        return JSON.parse(str);
    } catch {
        return { text: str };
    }
}

// turn a raw chat packet into something plugins can pattern match on
export function parseChat(version: string, rawMessage: unknown, position: number): ChatMessage {
    let formatted = "";
    let raw: unknown = rawMessage;
    try {
        const parsed = typeof rawMessage === "string" ? safeJson(rawMessage) : rawMessage;
        raw = parsed;
        formatted = registryFor(version).fromNotch(parsed).toMotd();
    } catch {
        formatted = typeof rawMessage === "string" ? rawMessage : "";
    }
    return { text: stripColorCodes(formatted), formatted, raw, position };
}

// render a component down to a legacy §-string, so we can append to a tab list
// display name without throwing away hypixels rank coloring
export function componentToLegacy(version: string, raw: unknown): string {
    if (raw === undefined || raw === null) return "";
    try {
        const parsed = typeof raw === "string" ? safeJson(raw) : raw;
        return registryFor(version).fromNotch(parsed).toMotd();
    } catch {
        return typeof raw === "string" ? raw : "";
    }
}

export function component(parts: ChatPart[]): Record<string, unknown> {
    const extra = parts.map((part) => {
        const node: Record<string, unknown> = { text: part.text };
        if (part.color) node.color = part.color;
        if (part.bold) node.bold = true;
        if (part.italic) node.italic = true;
        if (part.underlined) node.underlined = true;
        if (part.tooltip) node.hoverEvent = { action: "show_text", value: { text: part.tooltip } };
        if (part.runCommand) node.clickEvent = { action: "run_command", value: part.runCommand };
        else if (part.suggestCommand) node.clickEvent = { action: "suggest_command", value: part.suggestCommand };
        return node;
    });
    return { text: "", extra };
}

// §8[ §b✫312 §8| §c8.4 §8] §fPlayerName
export function renderPlayerLine(name: string, tags: Tag[]): Record<string, unknown> {
    const sorted = [...tags].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    const parts: ChatPart[] = [];

    if (sorted.length > 0) {
        parts.push({ text: "[", color: "dark_gray" });
        sorted.forEach((tag, i) => {
            if (i > 0) parts.push({ text: " | ", color: "dark_gray" });
            // formatted carries its own codes, so dont set a component color on it
            parts.push(
                tag.formatted
                    ? { text: tag.formatted, tooltip: tag.tooltip }
                    : { text: tag.text, color: tag.color ?? "gray", tooltip: tag.tooltip },
            );
        });
        parts.push({ text: "] ", color: "dark_gray" });
    }

    parts.push({ text: name, color: sorted.length ? "white" : "gray" });
    return component(parts);
}

// hacky cancer bullshit to get a chat injector that writes to the client, basically just for plugins
export function makeChatInjector(client: { write(name: string, data: unknown): void }): ChatInjector {
    const send = (message: unknown) => {
        client.write("chat", {
            message: typeof message === "string" ? message : JSON.stringify(message),
            position: 0,
        });
    };
    return {
        raw: (component) => send(component),
        text: (message) => send({ text: message }),
    };
}