import { PREFIX } from "../core/chat";
import type { Session } from "../core/types";
import { COLOR_CODES, type McColorName } from "../util/mcColors";
import { tierFormat, BEDWARS_FKDR } from "./thresholds";
import { BEDWARS_MODE_INFO, type BedwarsMode, type BedwarsModeStats, type BedwarsQueueStats } from "./hypixel";

// rendering for //bw lives here so a mode reads the same no matter where from
const c = (color: McColorName, value: string | number) => COLOR_CODES[color] + value;

const played = (s: BedwarsModeStats) =>
    s.finalKills + s.finalDeaths + s.kills + s.wins + s.losses + s.bedsBroken > 0;

const queueLine = (s: BedwarsModeStats): string =>
    `§7Wins: ${c("white", s.wins.toLocaleString())}  §7WLR: ${c("white", s.wlr)}` +
    `  §7FKDR: ${tierFormat(s.fkdr, BEDWARS_FKDR)}  §7BBLR: ${c("white", s.bblr)}`;

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
    session.chat.text(`  §7Wins: ${c("white", s.wins.toLocaleString())}  §7Losses: ${c("white", s.losses.toLocaleString())}  §7WLR: ${c("white", s.wlr)}`);
    session.chat.text(`  §7Final kills: ${c("white", s.finalKills.toLocaleString())}  §7Final deaths: ${c("white", s.finalDeaths.toLocaleString())}  §7FKDR: ${tierFormat(s.fkdr, BEDWARS_FKDR)}`);
    session.chat.text(`  §7Kills: ${c("white", s.kills.toLocaleString())}  §7Deaths: ${c("white", s.deaths.toLocaleString())}  §7KDR: ${c("white", s.kdr)}`);
    session.chat.text(`  §7Beds broken: ${c("white", s.bedsBroken.toLocaleString())}  §7Beds lost: ${c("white", s.bedsLost.toLocaleString())}  §7BBLR: ${c("white", s.bblr)}`);

    // a dreams mode can have several submodes too (solos, doubles, 4s)
    const parts = queues.filter((queue) => played(queue.stats));
    if (parts.length < 2) return;
    for (const queue of parts) session.chat.text(`    §4§l[${queue.name}] ${queueLine(queue.stats)}`);
}

export function bedwarsModeHelp(session: Session): void {
    const of = (dream: boolean) => BEDWARS_MODE_INFO.filter((mode) => mode.dream === dream).map((mode) => mode.name);
    session.chat.text(`  §7Core: §f${of(false).join("§7, §f")}`);
    session.chat.text(`  §7Dreams: §f${of(true).join("§7, §f")}`);
    session.chat.text(`  §8dreams add up every queue they ran in, ie. rush is solo + doubles + fours`);
}
