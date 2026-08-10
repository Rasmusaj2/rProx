import type { McColorName } from "../util/mcColors";
import { DUELS_WINS, DUELS_WLR, tierColor, tierFormat } from "./thresholds";

// duels has no star to lean on, using wins as sudo "levels"

export function winsColor(wins: number): McColorName {
    return tierColor(wins, DUELS_WINS);
}

export function winsText(wins: number): string {
    return wins.toString() + "W";
}

export function formatWins(wins: number): string {
    return tierFormat(wins, DUELS_WINS, winsText(wins));
}

export function wlrColor(wlr: number): McColorName {
    return tierColor(wlr, DUELS_WLR);
}

export function formatWlr(wlr: number): string {
    return tierFormat(wlr, DUELS_WLR);
}
