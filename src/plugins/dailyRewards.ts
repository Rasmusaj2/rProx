import { PREFIX, component, type ChatPart } from "../core/chat";
import type { Plugin, Session } from "../core/types";
import {
    DEFAULT_USER_AGENT,
    claimErrorMessage,
    claimReward,
    fetchErrorMessage,
    fetchRewardSession,
    findRewardId,
    formatReward,
    normalizeRewardId,
    pickBest,
    rarityColor,
    rewardLabel,
    rewardUrl,
    type RewardFetch,
    type RewardSession,
} from "../services/rewards";
import { COLOR_CODES } from "../util/mcColors";

interface DailyRewardsConfig {
    enabled?: boolean;
    mode?: "chat" | "auto"; // chat: pick in chat, auto: auto picks best
    prefer?: string[]; // tie break inside a rarity, e.g. ["mystery_box", "coins"]
    userAgent?: string;
    timeoutMs?: number;
}

// only announce/claim a given link once, hypixel repeats the reminder
const MAX_REMEMBERED = 64;
const DEFAULT_TIMEOUT_MS = 10_000;

export const dailyRewardsPlugin: Plugin = {
    name: "dailyRewards",
    version: "0.1.0",
    description: "Catches Hypixel daily reward links, claims them or offers them in chat.",

    defaultConfig: {
        enabled: true,
        mode: "chat",
        prefer: [],
        userAgent: DEFAULT_USER_AGENT,
        timeoutMs: DEFAULT_TIMEOUT_MS,
    },

    setup(api) {
        const config = api.pluginConfig as DailyRewardsConfig;
        if (config.mode && config.mode !== "auto" && config.mode !== "chat") {
            api.log.warn(`unknown mode "${config.mode}", falling back to "chat" (use "chat" or "auto")`);
        }
        const mode = config.mode === "auto" ? "auto" : "chat";
        const prefer = config.prefer ?? [];
        const prefix = api.config.commandPrefix;
        const request = {
            userAgent: config.userAgent ?? DEFAULT_USER_AGENT,
            timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        };

        const handled = new Set<string>();
        const lastSeen = new Map<string, string>(); // session id to reward id

        const remember = (id: string) => {
            handled.add(id);
            if (handled.size > MAX_REMEMBERED) {
                handled.delete(handled.values().next().value as string);
            }
        };

        const line = (parts: ChatPart[]) => parts.filter((part) => part.text.length > 0);

        // the browser can always finish the job, so every failure path keeps the link clickable
        const openPart = (id: string, label = " §8[§bopen§8]"): ChatPart => ({
            text: label,
            openUrl: rewardUrl(id),
            tooltip: `§7${rewardUrl(id)}`,
        });

        const reportFailure = (session: Session, id: string, result: Exclude<RewardFetch, { status: "ok" }>) => {
            api.log.warn(`reward ${id}: ${result.status}${result.status === "error" ? ` (${result.message})` : ""}`);
            session.chat.raw(
                component([
                    { text: `${PREFIX} §c${fetchErrorMessage(result.status)}` },
                    openPart(id),
                ]),
            );
        };

        const streakText = (rewards: RewardSession): string => {
            const score = rewards.dailyStreak?.score;
            return score ? ` §8(streak ${score})` : "";
        };

        const offer = (session: Session, rewards: RewardSession): void => {
            const best = pickBest(rewards.rewards, prefer);
            session.chat.raw(
                component([
                    { text: `${PREFIX} §eDaily reward ready${streakText(rewards)}` },
                    openPart(rewards.id, " §8[§bOpen in browser§8]"),
                ]),
            );
            rewards.rewards.forEach((reward, index) => {
                const label = rewardLabel(reward);
                session.chat.raw(
                    component(
                        line([
                            { text: `  §8${index + 1}. ` },
                            { text: label, color: rarityColor(reward.rarity), bold: index === best },
                            { text: reward.rarity ? ` ${reward.rarity}` : "" },
                            {
                                text: index === best ? " §8[§aCLAIM §e★§8]" : " §8[§fCLAIM§8]",
                                runCommand: `${prefix}reward claim ${index + 1}`,
                                tooltip: `§7Claim ${COLOR_CODES[rarityColor(reward.rarity)]}${label}§7`,
                            },
                        ]),
                    ),
                );
            });
        };

        const claim = async (session: Session, rewards: RewardSession, option: number): Promise<boolean> => {
            const reward = rewards.rewards[option];
            if (!reward) {
                session.chat.text(`${PREFIX} §7There is no option §f${option + 1}§7 on that reward.`);
                return false;
            }
            const result = await claimReward(rewards, option, request);
            if (result.status === "claimed") {
                remember(rewards.id);
                api.log.info(`claimed reward ${rewards.id} option ${option + 1} (${rewardLabel(reward)})`);
                session.chat.text(`${PREFIX} §aClaimed ${formatReward(reward)}§7.`);
                return true;
            }
            api.log.warn(`claim failed for ${rewards.id}: ${claimErrorMessage(result)}`);
            session.chat.raw(
                component([
                    { text: `${PREFIX} §c${claimErrorMessage(result)}` },
                    openPart(rewards.id),
                ]),
            );
            return false;
        };

        const load = async (session: Session, id: string): Promise<RewardSession | null> => {
            const result = await fetchRewardSession(id, request);
            if (result.status !== "ok") {
                reportFailure(session, id, result);
                return null;
            }
            return result.session;
        };

        api.on("chat", (msg, session) => {
            const id = findRewardId(msg.text);
            if (!id) return;
            lastSeen.set(session.id, id);
            if (handled.has(id)) return;
            remember(id);
            void (async () => {
                const rewards = await load(session, id);
                if (!rewards) {
                    handled.delete(id);
                    return;
                }
                if (mode !== "auto") {
                    offer(session, rewards);
                    return;
                }
                if (!(await claim(session, rewards, pickBest(rewards.rewards, prefer)))) handled.delete(id);
            })();
        });

        api.on("sessionEnd", (session) => lastSeen.delete(session.id));

        api.registerCommand(
            "reward",
            async (args, session) => {
                const [first, second] = args;

                if (first?.toLowerCase() === "claim") {
                    const id = lastSeen.get(session.id);
                    if (!id) {
                        session.chat.text(`${PREFIX} §7No reward link seen yet this session.`);
                        return;
                    }
                    let option: number | undefined;
                    if (second !== undefined) {
                        const choice = Number(second);
                        if (!Number.isInteger(choice) || choice < 1 || choice > 3) {
                            session.chat.text(`${PREFIX} §7Pick an option between §f1§7 and §f3§7.`);
                            return;
                        }
                        option = choice - 1;
                    }
                    // refetch, the cookie and token have to come from the same request
                    const rewards = await load(session, id);
                    if (!rewards) return;
                    await claim(session, rewards, option ?? pickBest(rewards.rewards, prefer));
                    return;
                }

                const id = first ? normalizeRewardId(first) : lastSeen.get(session.id);
                if (!id) {
                    session.chat.text(
                        first
                            ? `${PREFIX} §7That does not look like a reward link or id.`
                            : `${PREFIX} §7No reward link seen yet this session. §8(${prefix}reward <link>)`,
                    );
                    return;
                }
                lastSeen.set(session.id, id);
                const rewards = await load(session, id);
                if (rewards) offer(session, rewards);
            },
            `show the current daily reward options, ${prefix}reward claim [1-3] to take one`,
        );

        api.log.info(`daily rewards in ${mode} mode`);
    },
};

export default dailyRewardsPlugin;
