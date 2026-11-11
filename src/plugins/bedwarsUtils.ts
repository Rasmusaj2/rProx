// combined plugin for all bedwars utilities

import type { Plugin } from "../core/types";
import { TEAM_STATS_ANNOUNCER_DEFAULTS, registerTeamStatsAnnouncer } from "./bedwarsUtils/teamStatsAnnouncer";

export const bedwarsUtilsPlugin: Plugin = {
    name: "bedwarsUtils",
    version: "0.2.0",
    description: "Bedwars utilities: teamStatsAnnouncer (team stats to party chat on game start).",

    configMoves: [
        { from: "partyTeams", to: "teamStatsAnnouncer" }, // used to be called partyTeams as a standalone plugin
    ],

    defaultConfig: {
        enabled: true,
        teamStatsAnnouncer: TEAM_STATS_ANNOUNCER_DEFAULTS,
    },

    setup(api) {
        registerTeamStatsAnnouncer(api);
    },
};

export default bedwarsUtilsPlugin;
