import type { McColorName } from "../util/mcColors";
import { TNT_RUN_WINS, TNT_WINS, tierColor, tierFormat } from "./thresholds";

export function winsColor(wins: number): McColorName {
    return tierColor(wins, TNT_WINS);
}

export function winsText(wins: number): string {
    return wins.toString() + "W";
}

export function formatWins(wins: number): string {
    return tierFormat(wins, TNT_WINS, winsText(wins));
}

// there is no ratio to show here - tnt games reports no losses and keeps kills
// and deaths per mode only - so the trailing slot gets tnt run wins, the mode
// most of the playerbase actually sits in

export function tntRunColor(wins: number): McColorName {
    return tierColor(wins, TNT_RUN_WINS);
}

export function tntRunText(wins: number): string {
    return wins.toString() + "R";
}

export function formatTntRun(wins: number): string {
    return tierFormat(wins, TNT_RUN_WINS, tntRunText(wins));
}
