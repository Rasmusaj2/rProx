import { PREFIX } from "../core/chat";
import type { Session } from "../core/types";
import { COLOR_CODES, type McColorName } from "../util/mcColors";
import { tierFormat, DUELS_WINS, DUELS_WLR, DUELS_KDR, DUELS_MODE_WINS, DUELS_DIVISION } from "./thresholds";
import type { DuelsCategory, DuelsDivision, DuelsModeStats, DuelsStats } from "./hypixel";

// rendering for //duels lives here so the duelsStats plugin can post the exact
// same lines the command would, instead of a second hand-rolled format.

const c = (color: McColorName, value: string | number) => COLOR_CODES[color] + value;

export const division = (d: DuelsDivision | null): string =>
    d ? ` §8(${tierFormat(d.index, DUELS_DIVISION, d.label)}§8)` : "";

// the simple line of wins, wlr, kdr
export function duelsLine(m: DuelsModeStats): string {
    const bridge = m.bridgeKills > 0 || m.bridgeDeaths > 0;
    const kdr = bridge ? m.bridgeKdr : m.kdr;
    return `§7Wins: ${tierFormat(m.wins, DUELS_MODE_WINS)}  §7WLR: ${tierFormat(m.wlr, DUELS_WLR)}`
        + (m.kills > 0 || bridge ? `  §7KDR: ${tierFormat(kdr, DUELS_KDR)}` : "")
        + (bridge ? `  §7Goals: ${c("white", m.goals.toLocaleString())}` : "");
}

// the whole account summary, the same thing //duels prints with no mode
export function duelsOverview(session: Session, title: string, s: DuelsStats): void {
    session.chat.text(`${PREFIX} ${title} §7- §bDuels${division(s.division)}`);
    session.chat.text(`  §7Wins: ${tierFormat(s.wins, DUELS_WINS)}  §7WLR: ${tierFormat(s.wlr, DUELS_WLR)}  §7KDR: ${tierFormat(s.kdr, DUELS_KDR)}  §7Games: ${c("white", s.gamesPlayed.toLocaleString())}`);
    if (s.categories.length === 0) {
        session.chat.text(`  §7No Duels stats`);
        return;
    }
    const streaks = s.winstreaksHidden
        ? `§7Winstreak: ${c("dark_gray", "hidden")}`
        : `§7Winstreak: ${c("white", s.currentWinstreak)}  §7Best: ${c("white", s.bestWinstreak)}`;
    session.chat.text(`  ${streaks}  §7Melee: ${c("white", `${s.meleeAccuracy}%`)}  §7Bow: ${c("white", `${s.bowAccuracy}%`)}`);
    duelsBreakdown(session, s.categories);
}

// the breakdown of all the categories and their modes
export function duelsBreakdown(session: Session, categories: DuelsCategory[]): void {
    for (const category of categories) {
        session.chat.text(`  §b${category.name}§8: ${duelsLine(category.combined)}`);
        if (category.modes.length < 2) continue;
        for (const mode of category.modes) {
            session.chat.text(`    §7${mode.variant || mode.name}§8: ${duelsLine(mode)}`);
        }
    }
}

// seperator lines
const RULE = `§b${"▬".repeat(64)}`;
const BAR = " §8| ";

const record = (wins: number, losses: number, wlr: number): string =>
    `§a${wins.toLocaleString()} W§7/§c${losses.toLocaleString()} L §7(${tierFormat(wlr, DUELS_WLR)}§f WLR§7)`;

const streak = (label: string, current: number, best: number, hidden: boolean): string =>
    hidden ? `§f${label}: ${c("dark_gray", "hidden")}` : `§f${label}: §a${current}§7/§c${best}`;

const divisionLine = (d: DuelsDivision | null, name: string): string =>
    `  §fDivision: ${d ? `§l${tierFormat(d.index, DUELS_DIVISION, `${name} ${d.label}`)}` : c("gray", "None")}`;

// combined then subqueues
export function duelsAnnounce(session: Session, title: string, category: DuelsCategory, streaksHidden: boolean, active?: string): void {
    const m = category.combined;
    session.chat.text(RULE);
    session.chat.text(`${PREFIX} §f§lYour Opponent §r${title}§f's §b${category.name} §fStats`);
    if (!m.played) {
        session.chat.text(`§7No ${category.name} stats`);
        session.chat.text(RULE);
        return;
    }
    session.chat.text(`  ${record(m.wins, m.losses, m.wlr)}${BAR}${streak("Current/Best Winstreak", m.currentWinstreak, m.bestWinstreak, streaksHidden)}`);

    const bridge = m.bridgeKills > 0 || m.bridgeDeaths > 0;
    const stats: string[] = [];
    if (bridge) stats.push(`§fGoals: §a${m.goals.toLocaleString()}`);
    if (m.kills > 0 || bridge) stats.push(`§fKDR: ${tierFormat(bridge ? m.bridgeKdr : m.kdr, DUELS_KDR)}`);
    if (m.meleeSwings > 0) stats.push(`§fAccuracy: §a${m.meleeAccuracy}%`);
    if (m.bowShots > 0) stats.push(`§fBow: §a${m.bowAccuracy}%`);
    if (stats.length > 0) session.chat.text("  " + stats.join(BAR));

    if (category.modes.length > 1) {
        session.chat.text("");
        for (const mode of category.modes) {
            const label = `${mode.key === active ? "§b" : "§7"}${mode.variant || mode.name}`;
            session.chat.text(`  ${label}§8: ${record(mode.wins, mode.losses, mode.wlr)}${BAR}${streak("WS", mode.currentWinstreak, mode.bestWinstreak, streaksHidden)}`);
        }
    }

    session.chat.text(divisionLine(m.division, category.name));
    session.chat.text(RULE);
}

export function duelsAnnounceOverview(session: Session, title: string, s: DuelsStats): void {
    session.chat.text(RULE);
    session.chat.text(`${PREFIX} §f§lYour Opponent §r${title}§f's §bDuels §fStats`);
    if (s.categories.length === 0) {
        session.chat.text(`§7No Duels stats`);
        session.chat.text(RULE);
        return;
    }
    session.chat.text(`${record(s.wins, s.losses, s.wlr)}${BAR}${streak("Current/Best Winstreak", s.currentWinstreak, s.bestWinstreak, s.winstreaksHidden)}`);
    session.chat.text(`§fKDR: ${tierFormat(s.kdr, DUELS_KDR)}${BAR}§fAccuracy: §a${s.meleeAccuracy}%${BAR}§fBow: §a${s.bowAccuracy}%`);
    session.chat.text("");
    for (const category of s.categories) {
        const m = category.combined;
        session.chat.text(`§7${category.name}§8: ${record(m.wins, m.losses, m.wlr)}${BAR}${streak("WS", m.currentWinstreak, m.bestWinstreak, s.winstreaksHidden)}`);
    }
    session.chat.text("");
    session.chat.text(divisionLine(s.division, "Duels"));
    session.chat.text(RULE);
}

export function duelsMode(session: Session, title: string, m: DuelsModeStats, streaksHidden: boolean, queues: DuelsModeStats[] = []): void {
    session.chat.text(`${PREFIX} ${title} §7- §bDuels §8(§7${m.name}§8)${division(m.division)}`);
    if (!m.played) {
        session.chat.text(`  §7No ${m.name} stats`);
        return;
    }
    session.chat.text(`  §7Wins: ${tierFormat(m.wins, DUELS_MODE_WINS)}  §7Losses: ${c("white", m.losses.toLocaleString())}  §7WLR: ${tierFormat(m.wlr, DUELS_WLR)}  §7Rounds: ${c("white", m.roundsPlayed.toLocaleString())}`);
    const streaks = streaksHidden
        ? `§7Winstreak: ${c("dark_gray", "hidden")}`
        : `§7Winstreak: ${c("white", m.currentWinstreak)}  §7Best: ${c("white", m.bestWinstreak)}`;
    session.chat.text(`  §7Kills: ${c("white", m.kills.toLocaleString())}  §7Deaths: ${c("white", m.deaths.toLocaleString())}  §7KDR: ${tierFormat(m.kdr, DUELS_KDR)}  ${streaks}`);

    // bridge stats for goals
    if (m.goals > 0 || m.bridgeKills > 0) {
        session.chat.text(`  §7Goals: ${c("white", m.goals.toLocaleString())}  §7Bridge kills: ${c("white", m.bridgeKills.toLocaleString())}  §7Bridge deaths: ${c("white", m.bridgeDeaths.toLocaleString())}  §7Bridge KDR: ${tierFormat(m.bridgeKdr, DUELS_KDR)}`);
    }

    const hit: string[] = [];
    if (m.meleeSwings > 0) hit.push(`§7Melee: ${c("white", `${m.meleeAccuracy}%`)} §8(${m.meleeHits.toLocaleString()}/${m.meleeSwings.toLocaleString()})`);
    if (m.bowShots > 0) hit.push(`§7Bow: ${c("white", `${m.bowAccuracy}%`)} §8(${m.bowHits.toLocaleString()}/${m.bowShots.toLocaleString()})`);
    if (hit.length > 0) session.chat.text(`  ${hit.join("  ")}`);

    const rest: string[] = [];
    const add = (label: string, value: number) => {
        if (value > 0) rest.push(`§7${label}: ${c("white", value.toLocaleString())}`);
    };
    add("Damage", m.damageDealt);
    add("Health regen", m.healthRegenerated);
    add("Blocks", m.blocksPlaced);
    add("Gapples", m.goldenApplesEaten);
    add("Kit wins", m.kitWins);
    for (const extra of m.extras) rest.push(`§7${extra.label}: ${c("white", extra.text)}`);
    for (let i = 0; i < rest.length; i += 3) session.chat.text(`  ${rest.slice(i, i + 3).join("  ")}`);

    if (queues.length < 2) return;
    for (const queue of queues) session.chat.text(`    §7${queue.variant || queue.name}§8: ${duelsLine(queue)}`);
}
