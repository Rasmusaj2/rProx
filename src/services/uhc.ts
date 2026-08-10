import type { McColorName } from "../util/mcColors";
import { UHC_KDR, UHC_WINS, tierColor, tierFormat } from "./thresholds";

export function winsColor(wins: number): McColorName {
    return tierColor(wins, UHC_WINS);
}

export function winsText(wins: number): string {
    return wins.toString() + "W";
}

export function formatWins(wins: number): string {
    return tierFormat(wins, UHC_WINS, winsText(wins));
}

export function kdrColor(kdr: number): McColorName {
    return tierColor(kdr, UHC_KDR);
}

export function formatKdr(kdr: number): string {
    return tierFormat(kdr, UHC_KDR);
}
