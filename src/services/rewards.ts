import { COLOR_CODES, type McColorName } from "../util/mcColors";

// Help from https://hypixel.net/threads/technical-overview-rewards-hypixel-net.4759148/

const BASE = "https://rewards.hypixel.net/claim-reward";
const LINK_PATTERN = /rewards\.hypixel\.net\/claim-reward\/([0-9a-f]{8})/i;
const ID_PATTERN = /^[0-9a-f]{8}$/i;

const SECURITY_TOKEN_PATTERN = /window\.securityToken\s*=\s*"([^"]+)"/;
const APP_DATA_PATTERN = /window\.appData\s*=\s*'((?:[^'\\]|\\.)*)'/;

export const DEFAULT_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) rProx/0.1";

export type Rarity = "COMMON" | "RARE" | "EPIC" | "LEGENDARY";

export interface Reward {
    reward: string; 
    rarity?: Rarity;
    gameType?: string; 
    amount?: number;
    key?: string; // cosmetic id 
    package?: string; // block id (housing)
    intlist?: number[];
}

export interface DailyStreak {
    score?: number;
    highScore?: number;
    token?: boolean;
}

export interface RewardSession {
    id: string;
    activeAd: number;
    securityToken: string;
    cookie: string;
    rewards: Reward[];
    dailyStreak?: DailyStreak;
}

export type FetchStatus = "ok" | "expired" | "blocked" | "unparsable" | "error";

export type RewardFetch =
    | { status: "ok"; session: RewardSession }
    | { status: "expired" } // 404/410 - already claimed, or the link aged out
    | { status: "blocked"; code: number } // cloudflare or anything else non-2xx
    | { status: "unparsable" } // page loaded but the script vars moved
    | { status: "error"; message: string };

export type ClaimResult =
    | { status: "claimed" }
    | { status: "rejected"; code: number }
    | { status: "error"; message: string };

export interface RewardRequestOptions {
    userAgent?: string;
    timeoutMs?: number;
}

export function rewardUrl(id: string): string {
    return `${BASE}/${id}`;
}

// pull link from chat
export function findRewardId(text: string): string | undefined {
    return LINK_PATTERN.exec(text)?.[1]?.toLowerCase();
}

export function normalizeRewardId(input: string): string | undefined {
    if (ID_PATTERN.test(input)) return input.toLowerCase();
    return findRewardId(input);
}

// headers fuckery cause cloudflare and node-fetch arent good friends
function cookieHeader(response: Response): string {
    const headers = response.headers as Headers & { getSetCookie?: () => string[] };
    const lines = typeof headers.getSetCookie === "function"
        ? headers.getSetCookie()
        : [headers.get("set-cookie") ?? ""];
    return lines
        .filter(Boolean)
        .map((line) => line.split(";")[0].trim())
        .filter((pair) => pair.includes("="))
        .join("; ");
}

export async function fetchRewardSession(id: string, options: RewardRequestOptions = {}): Promise<RewardFetch> {
    let response: Response;
    try {
        response = await fetch(rewardUrl(id), {
            headers: {
                // "rewardclaim" is denied as useragent
                "user-agent": options.userAgent ?? DEFAULT_USER_AGENT,
                accept: "text/html,application/xhtml+xml,application/xml;q=0.9",
                "accept-language": "en-US,en;q=0.9",
            },
            signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
        });
    } catch (error) {
        return { status: "error", message: (error as Error).message };
    }

    if (response.status === 404 || response.status === 410) return { status: "expired" };
    if (!response.ok) return { status: "blocked", code: response.status };

    let html: string;
    try {
        html = await response.text();
    } catch (error) {
        return { status: "error", message: (error as Error).message };
    }

    const securityToken = SECURITY_TOKEN_PATTERN.exec(html)?.[1];
    const appDataRaw = APP_DATA_PATTERN.exec(html)?.[1];
    if (!securityToken || !appDataRaw) return { status: "unparsable" };

    let appData: Record<string, unknown>;
    try {
        // appData sits inside a single quoted js string, so only \' needs undoing
        appData = JSON.parse(appDataRaw.replace(/\\'/g, "'")) as Record<string, unknown>;
    } catch {
        return { status: "unparsable" };
    }

    const rewards = Array.isArray(appData.rewards) ? (appData.rewards as Reward[]) : [];
    if (rewards.length === 0) return { status: "unparsable" };

    return {
        status: "ok",
        session: {
            id: typeof appData.id === "string" ? appData.id : id,
            activeAd: Number(appData.activeAd ?? 0),
            securityToken,
            cookie: cookieHeader(response),
            rewards,
            dailyStreak: (appData.dailyStreak as DailyStreak | undefined) ?? undefined,
        },
    };
}

export async function claimReward(
    session: RewardSession,
    option: number,
    options: RewardRequestOptions = {},
): Promise<ClaimResult> {
    const params = new URLSearchParams({
        id: session.id,
        option: String(option),
        activeAd: String(session.activeAd), // has to match what the page was serving
        _csrf: session.securityToken,
        watchedFallback: "false",
    });
    try {
        const response = await fetch(`${BASE}/claim?${params.toString()}`, {
            method: "POST",
            headers: {
                "user-agent": options.userAgent ?? DEFAULT_USER_AGENT,
                cookie: session.cookie,
                accept: "*/*",
            },
            signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
        });
        await response.text().catch(() => ""); // drain, we do not trust the body
        return response.ok ? { status: "claimed" } : { status: "rejected", code: response.status };
    } catch (error) {
        return { status: "error", message: (error as Error).message };
    }
}

export function fetchErrorMessage(status: Exclude<FetchStatus, "ok">): string {
    switch (status) {
        case "expired":
            return "That reward link is gone - already claimed, or it expired";
        case "blocked":
            return "Hypixel refused the request (Cloudflare), claim it in the browser";
        case "unparsable":
            return "Could not read the rewards page (most likely claimed)";
        default:
            return "Could not reach rewards.hypixel.net";
    }
}

export function claimErrorMessage(result: Exclude<ClaimResult, { status: "claimed" }>): string {
    return result.status === "rejected"
        ? `Hypixel rejected the claim (HTTP ${result.code})`
        : `Claim request failed: ${result.message}`;
}

const RARITY_RANK: Record<string, number> = { COMMON: 0, RARE: 1, EPIC: 2, LEGENDARY: 3 };

export function rarityRank(rarity?: string): number {
    return RARITY_RANK[rarity ?? ""] ?? -1;
}

export function rarityColor(rarity?: string): McColorName {
    switch (rarity) {
        case "LEGENDARY":
            return "gold";
        case "EPIC":
            return "dark_purple";
        case "RARE":
            return "blue";
        case "COMMON":
            return "white";
        default:
            return "gray";
    }
}

// highest rarity wins. within a rarity the configured type preference decides,
// then the bigger pile, then whatever hypixel listed first
export function pickBest(rewards: Reward[], prefer: string[] = []): number {
    if (rewards.length === 0) return 0;
    const preference = (reward: Reward) => {
        const index = prefer.indexOf(reward.reward);
        return index === -1 ? prefer.length : index;
    };
    return rewards
        .map((reward, index) => ({ reward, index }))
        .sort(
            (a, b) =>
                rarityRank(b.reward.rarity) - rarityRank(a.reward.rarity) ||
                preference(a.reward) - preference(b.reward) ||
                (b.reward.amount ?? 0) - (a.reward.amount ?? 0) ||
                a.index - b.index,
        )[0].index;
}

const REWARD_NAMES: Record<string, string> = {
    coins: "Coins",
    tokens: "Tokens",
    dust: "Mystery Dust",
    experience: "XP",
    adsense_token: "Reroll Token",
    souls: "Souls",
    mystery_box: "Mystery Box",
    gift_box: "Gift Box",
    add_vanity: "Vanity",
    housing_package: "Housing Package",
};

// gameType codes to display name 
const GAME_NAMES: Record<string, string> = {
    ARCADE: "Arcade",
    ARENA: "Arena Brawl",
    BATTLEGROUND: "Warlords",
    BEDWARS: "Bed Wars",
    BUILD_BATTLE: "Build Battle",
    DUELS: "Duels",
    GINGERBREAD: "Turbo Kart Racers",
    LEGACY: "Classic Games",
    MCGO: "Cops and Crims",
    MURDER: "Murder Mystery",
    MURDER_MYSTERY: "Murder Mystery",
    PAINTBALL: "Paintball",
    QUAKECRAFT: "Quakecraft",
    SKYWARS: "SkyWars",
    SUPER_SMASH: "Smash Heroes",
    SURVIVAL_GAMES: "Blitz Survival Games",
    TNTGAMES: "TNT Games",
    UHC: "UHC Champions",
    VAMPIREZ: "VampireZ",
    WALLS: "Walls",
    WALLS3: "Mega Walls",
};

// vanity cosmetics
const VANITY_NAMES: Record<string, string> = {
    emote_moustache: "Moustache Emote",
    taunt_treasure: "Dig for Treasure Gesture",
    suit_treasure_boots: "Treasure Hunter Suit Boots",
    suit_treasure_leggings: "Treasure Hunter Suit Leggings",
    suit_treasure_chestplate: "Treasure Hunter Suit Chestplate",
    suit_treasure_helmet: "Treasure Hunter Suit Helmet",
};

// housing
const HOUSING_NAMES: Record<string, string> = {
    specialoccasion_reward_card_skull_red_treasure_chest: "Red Treasure Chest",
    specialoccasion_reward_card_skull_blue_treasure_chest: "Blue Treasure Chest",
    specialoccasion_reward_card_skull_green_treasure_chest: "Green Treasure Chest",
    specialoccasion_reward_card_skull_gold_nugget: "Gold Nugget",
    "specialoccasion_reward_card_skull_pot_o'_gold": "Pot O' Gold",
    "specialoccasion_reward_card_skull_rubik's_cube": "Rubik's Cube",
    specialoccasion_reward_card_skull_piggy_bank: "Piggy Bank",
    specialoccasion_reward_card_skull_health_potion: "Health Potion",
    specialoccasion_reward_card_skull_coin_bag: "Coin Bag",
    specialoccasion_reward_card_skull_ornamental_helmet: "Ornamental Helmet",
    specialoccasion_reward_card_skull_pocket_galaxy: "Pocket Galaxy",
    specialoccasion_reward_card_skull_mystic_pearl: "Mystic Pearl",
    specialoccasion_reward_card_skull_agility_potion: "Agility Potion",
    specialoccasion_reward_card_skull_golden_chalice: "Golden Chalice",
    specialoccasion_reward_card_skull_jewelry_box: "Jewelry Box",
    specialoccasion_reward_card_skull_crown: "Crown",
    specialoccasion_reward_card_skull_molten_core: "Molten Core",
    specialoccasion_reward_card_skull_mana_potion: "Mana Potion",
};

// String prettify title case
function titleCase(value: string): string {
    return value
        .split(/[_\s]+/)
        .filter(Boolean)
        .map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase())
        .join(" ");
}

const SUIT_PIECES = new Set(["boots", "leggings", "chestplate", "helmet"]);
const HOUSING_PREFIX = "specialoccasion_reward_card_skull_";

function gameName(gameType: string): string {
    return GAME_NAMES[gameType] ?? titleCase(gameType);
}

function vanityName(key: string): string {
    if (VANITY_NAMES[key]) return VANITY_NAMES[key];
    const underscore = key.indexOf("_");
    const kind = underscore === -1 ? "" : key.slice(0, underscore);
    const rest = underscore === -1 ? key : key.slice(underscore + 1);
    if (kind === "suit") {
        const piece = rest.slice(rest.lastIndexOf("_") + 1);
        const body = SUIT_PIECES.has(piece) ? rest.slice(0, rest.lastIndexOf("_")) : rest;
        return `${titleCase(body)} Suit${SUIT_PIECES.has(piece) ? ` ${titleCase(piece)}` : ""}`;
    }
    return titleCase(key);
}

function housingName(id: string): string {
    if (HOUSING_NAMES[id]) return HOUSING_NAMES[id];
    return titleCase(id.startsWith(HOUSING_PREFIX) ? id.slice(HOUSING_PREFIX.length) : id);
}

// plain label, no color codes - callers decide the coloring
export function rewardLabel(reward: Reward): string {
    const name = REWARD_NAMES[reward.reward] ?? titleCase(reward.reward);
    if (reward.reward === "add_vanity") return `${name}: ${reward.key ? vanityName(reward.key) : "Unknown Cosmetic"}`;
    if (reward.reward === "housing_package") return `${name}: ${reward.package ? housingName(reward.package) : "Unknown Block"}`;
    const amount = reward.amount ? `${reward.amount.toLocaleString("en-US")} ` : "";
    const game = reward.gameType ? `${gameName(reward.gameType)} ` : "";
    // intlist stars are zero based, 0 is a 1 star box
    const stars = reward.intlist?.length ? ` (${reward.intlist.map((level) => level + 1).join("/")}✫)` : "";
    return `${amount}${game}${name}${stars}`;
}

export function formatReward(reward: Reward): string {
    return COLOR_CODES[rarityColor(reward.rarity)] + rewardLabel(reward);
}