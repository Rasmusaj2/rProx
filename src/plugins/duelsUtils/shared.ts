// what more than one duels utility needs
import type { SidebarInjector } from "../../core/sidebar";
import { stripColorCodes } from "../../util/mcColors";

// the game start line naming who you are up against
export const OPPONENT = /^\s+Opponents?:\s*(.+)$/i;

// check if its a duels sidebar
export const isDuelsTitle = (title: string | undefined): boolean =>
    !!title && /DUELS?/i.test(stripColorCodes(title));

// feed a read only sidebar off the scoreboard packets
export function trackSidebar(sidebar: SidebarInjector, name: string, data: any): void {
    switch (name) {
        case "scoreboard_objective":
            sidebar.applyObjective(data);
            break;
        case "scoreboard_display_objective":
            sidebar.applyDisplayObjective(data);
            break;
        case "scoreboard_score":
            sidebar.applyScore(data);
            break;
        case "scoreboard_team":
            sidebar.applyTeam(data);
            break;
        case "login":
            sidebar.clear();
            break;
    }
}
