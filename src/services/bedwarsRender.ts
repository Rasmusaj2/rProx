import { PREFIX } from "../core/chat";
import type { Session } from "../core/types";
import { COLOR_CODES, type McColorName } from "../util/mcColors";
import { tierFormat, BEDWARS_FKDR } from "./thresholds";
import { bedwarsStar } from "./prestige";
import { BEDWARS_MODE_INFO, type BedwarsMode, type BedwarsModeStats, type BedwarsQueueStats, type BedwarsStats } from "./hypixel";

// rendering for //bw lives here so a mode reads the same no matter where from
const c = (color: McColorName, value: string | number) => COLOR_CODES[color] + value;

const played = (s: Omit<BedwarsModeStats, "name">) =>
    s.finalKills + s.finalDeaths + s.kills + s.wins + s.losses + s.bedsBroken > 0;

type Totals = Omit<BedwarsModeStats, "name">;

const pair = (label: string, ratio: string, a: number, b: number): string =>
    `§7${label} ${ratio} §8(${c("white", a.toLocaleString())}§8/${c("white", b.toLocaleString())}§8)`;

const summary = (s: Totals): string[] => [
    `${pair("FKDR", tierFormat(s.fkdr, BEDWARS_FKDR), s.finalKills, s.finalDeaths)}  ${pair("WLR", c("white", s.wlr), s.wins, s.losses)}`,
    `${pair("KDR", c("white", s.kdr), s.kills, s.deaths)}  ${pair("BBLR", c("white", s.bblr), s.bedsBroken, s.bedsLost)}`,
];

const queueLine = (name: string, s: Totals): string =>
    `§b§l[${name}]§r §7FKDR ${tierFormat(s.fkdr, BEDWARS_FKDR)} §8(${c("white", s.finalKills.toLocaleString())}§8)` +
    `  §7WLR ${c("white", s.wlr)} §8(${c("white", s.wins.toLocaleString())}§8)  §7BBLR ${c("white", s.bblr)}`;

export const bedwarsOverviewLines = (s: BedwarsStats): string[] => [
    ...summary(s),
    `§7Winstreak ${c("white", s.winstreak.toLocaleString())}  §7Games ${c("white", s.gamesPlayed.toLocaleString())}`,
    ...s.modes.filter(played).map((mode) => queueLine(mode.name, mode)),
];

export function bedwarsOverview(session: Session, title: string, s: BedwarsStats): void {
    session.chat.text(`${PREFIX} ${title} §7- §bBedwars §7[${bedwarsStar(s.level).formatted}§7]`);
    if (s.level === 0 && s.finalKills === 0) {
        session.chat.text(`  §7No Bedwars stats`);
        return;
    }
    for (const line of bedwarsOverviewLines(s)) session.chat.text(`  ${line}`);
}

export function bedwarsMode(
    session: Session,
    title: string,
    mode: BedwarsMode,
    s: BedwarsModeStats,
    queues: BedwarsQueueStats[] = [],
): void {
    const tag = mode.dream ? " §8(dreams)" : "";
    session.chat.text(`${PREFIX} ${title} §7- §bBedwars §8(§7${mode.name}§8)${tag}`);
    if (!played(s)) {
        session.chat.text(`  §7No ${mode.name} stats`);
        return;
    }
    for (const line of summary(s)) session.chat.text(`  ${line}`);

    // a dreams mode can have several submodes too (solos, doubles, 4s)
    const parts = queues.filter((queue) => played(queue.stats));
    if (parts.length < 2) return;
    for (const queue of parts) session.chat.text(`  ${queueLine(queue.name, queue.stats)}`);
}

export function bedwarsModeHelp(session: Session): void {
    const of = (dream: boolean) => BEDWARS_MODE_INFO.filter((mode) => mode.dream === dream).map((mode) => mode.name);
    session.chat.text(`  §7Core: §f${of(false).join("§7, §f")}`);
    session.chat.text(`  §7Dreams: §f${of(true).join("§7, §f")}`);
    session.chat.text(`  §8dreams add up every queue they ran in, ie. rush is solo + doubles + fours`);
}
