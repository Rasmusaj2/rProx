import type { McColorName } from "../util/mcColors";
import { MM_WINS, MM_WLR, tierColor, tierFormat } from "./thresholds";

export function winsColor(wins: number): McColorName {
    return tierColor(wins, MM_WINS);
}

export function winsText(wins: number): string {
    return wins.toString() + "W";
}

export function formatWins(wins: number): string {
    return tierFormat(wins, MM_WINS, winsText(wins));
}

export function wlrColor(wlr: number): McColorName {
    return tierColor(wlr, MM_WLR);
}

export function formatWlr(wlr: number): string {
    return tierFormat(wlr, MM_WLR);
}
