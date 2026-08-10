import { firstColor, type McColorName } from "../util/mcColors";
import { SKYWARS_KDR, tierColor, tierFormat } from "./thresholds";

export function levelColor(levelFormatted: string): McColorName {
    return firstColor(levelFormatted) ?? "gray";
}

export function kdrColor(kdr: number): McColorName {
    return tierColor(kdr, SKYWARS_KDR);
}

export function formatKdr(kdr: number): string {
    return tierFormat(kdr, SKYWARS_KDR);
}
