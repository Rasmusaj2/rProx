// combined plugin for all bedwars utilities

import type { Plugin } from "../core/types";
import { DIAMOND_SHOP_DEFAULTS, registerDiamondShop } from "./bedwarsUtils/diamondShop";
import { TEAM_STATS_ANNOUNCER_DEFAULTS, registerTeamStatsAnnouncer } from "./bedwarsUtils/teamStatsAnnouncer";

export const bedwarsUtilsPlugin: Plugin = {
    name: "bedwarsUtils",
    version: "0.3.0",
    description:
        "Bedwars utilities: teamStatsAnnouncer (team stats to party chat on game start), diamondShop (customizable Upgrades & Traps shop layout).",

    configMoves: [
        { from: "partyTeams", to: "teamStatsAnnouncer" }, // used to be called partyTeams as a standalone plugin
    ],

    defaultConfig: {
        enabled: true,
        teamStatsAnnouncer: TEAM_STATS_ANNOUNCER_DEFAULTS,
        diamondShop: DIAMOND_SHOP_DEFAULTS,
    },

    setup(api) {
        registerTeamStatsAnnouncer(api);
        registerDiamondShop(api);
    },
};

export default bedwarsUtilsPlugin;
