// combined plugin for all duels utilities

import type { Plugin } from "../core/types";
import { OPPONENT_STATS_DEFAULTS, registerOpponentStats } from "./duelsUtils/opponentStats";
import { PREGAME_RANKS_DEFAULTS, registerPregameRanks } from "./duelsUtils/pregameRanks";

// duelsStats was one plugin doing both jobs, standalone at first and then as duelsUtils.duelsStats
const OLD_DUELS_STATS = ["duelsStats", "duelsUtils.duelsStats"];

export const duelsUtilsPlugin: Plugin = {
    name: "duelsUtils",
    version: "0.2.0",
    description: "Duels utilities: opponentStats (opponent stats on game start), pregameRanks (rank tally of the pregame queue).",

    configMoves: [
        { from: OLD_DUELS_STATS, to: "opponentStats", keys: ["enabled", "apiKey", "delaySeconds"] },
        { from: OLD_DUELS_STATS, to: "pregameRanks", keys: ["enabled", "includeSelf"] },
    ],

    defaultConfig: {
        enabled: true,
        opponentStats: OPPONENT_STATS_DEFAULTS,
        pregameRanks: PREGAME_RANKS_DEFAULTS,
    },

    setup(api) {
        registerOpponentStats(api);
        registerPregameRanks(api);
    },
};

export default duelsUtilsPlugin;
