// defines thresholds for every color across every game (except stars)
import { COLOR_CODES, type McColorName } from "../util/mcColors";
export type Threshold = [limit: number, color: McColorName];
export type Thresholds = ReadonlyArray<Threshold>;

const OVERFLOW: McColorName = "dark_purple"; // top tier

// the one function every stat color goes through
export function tierColor(num: number, thresholds: Thresholds): McColorName {
    for (const [limit, color] of thresholds) {
        if (num < limit) return color;
    }
    return OVERFLOW;
}


export function tierFormat(num: number, thresholds: Thresholds, text: string | number = num): string {
    return COLOR_CODES[tierColor(num, thresholds)] + text;
}

// lowkey idk why they have different colors
const RATIO_RUN: McColorName[] = ["gray", "white", "yellow", "light_purple", "red", "dark_red", "dark_purple"];
const COUNT_RUN: McColorName[] = ["gray", "white", "gold",   "aqua", "dark_green", "dark_red", "dark_purple"];

const ladder = (run: McColorName[]) => (...limits: number[]): Thresholds =>
    run.map((color, i) => [limits[i] ?? Infinity, color] as Threshold);

export const ratioTiers = ladder(RATIO_RUN);
export const countTiers = ladder(COUNT_RUN);

// single mode
export const BEDWARS_FKDR = ratioTiers(0.75, 1.5, 3, 7, 15, 35);
export const SKYWARS_KDR = ratioTiers(0.75, 1.5, 3, 5, 8, 12);

export const DUELS_WINS = countTiers(100, 500, 1000, 2000, 5000, 10000);
export const DUELS_WLR = ratioTiers(0.75, 1.5, 2.5, 4, 6, 10);

export const MM_WINS = countTiers(50, 150, 400, 1000, 2500, 5000);
export const MM_WLR = ratioTiers(0.2, 0.4, 0.7, 1.2, 2, 3);

export const FISHING_MYTHICAL = countTiers(100, 500, 1000, 2000, 5000, 10000);
export const FISHING_CATCHES = countTiers(500, 2500, 10000, 25000, 60000, 150000);

export const BLITZ_WINS = countTiers(10, 50, 150, 400, 1000, 2500);
export const BLITZ_KDR = ratioTiers(0.75, 1.5, 2.5, 4, 6, 10);

export const CVC_WINS = countTiers(25, 100, 250, 750, 1500, 3000);
export const CVC_KDR = ratioTiers(0.75, 1.5, 2.5, 4, 6, 10);

export const MEGAWALLS_WINS = countTiers(10, 50, 150, 400, 1000, 2500);
export const MEGAWALLS_FKDR = ratioTiers(0.75, 1.5, 3, 5, 8, 15);

export const SMASH_LEVEL = countTiers(5, 15, 30, 60, 120, 250);
export const SMASH_KDR = ratioTiers(0.75, 1.5, 2.5, 4, 6, 10);

export const WARLORDS_WINS = countTiers(25, 100, 300, 750, 2000, 5000);
export const WARLORDS_KDR = ratioTiers(0.75, 1.5, 2.5, 4, 6, 10);

export const BUILDBATTLE_WINS = countTiers(25, 100, 250, 600, 1500, 3000);
export const BUILDBATTLE_SCORE = countTiers(2500, 10000, 25000, 50000, 100000, 250000);
export const GUESSTHEBUILD_WINS = countTiers(25, 100, 250, 600, 1500, 3000);
export const GUESSTHEBUILD_SCORE = countTiers(2500, 10000, 25000, 50000, 100000, 250000);


// uhc
export const UHC_WINS = countTiers(5, 15, 40, 100, 250, 500);
export const UHC_KDR = ratioTiers(0.75, 1.5, 2.5, 4, 6, 10);
export const SPEEDUHC_WINS = countTiers(5, 20, 50, 150, 400, 1000);
export const SPEEDUHC_KDR = ratioTiers(0.75, 1.5, 2.5, 4, 6, 10);


// tnt games
export const TNT_TOTAL_WINS = countTiers(50, 200, 500, 1500, 3000, 6000);
export const TNT_RUN_WINS = countTiers(25, 100, 250, 750, 1500, 3000);
export const PVPRUN_WINS = countTiers(10, 50, 150, 400, 1000, 2500);
export const TNTTAG_WINS = countTiers(25, 100, 300, 800, 2000, 4000); 
export const WIZARDS_WINS = countTiers(10, 50, 150, 400, 1000, 2500);
export const BOWSPLEEF_WINS = countTiers(10, 50, 150, 400, 1000, 2500);

// wool games
// i define 2 for each here but i might end up only using one cause of stars
export const WOOL_WARS_WINS = countTiers(25, 100, 250, 750, 1500, 3000);
export const WOOL_WARS_KDR = ratioTiers(0.75, 1.5, 2.5, 4, 6, 10);
export const SHEEPWARS_WINS = countTiers(10, 50, 150, 400, 1000, 2500);
export const SHEEPWARS_KDR = ratioTiers(0.75, 1.5, 2.5, 4, 6, 10);
export const CTW_WINS = countTiers(5, 25, 75, 200, 500, 1000); // ctw games run long, nobody has thousands
export const CTW_KDR = countTiers(1, 5, 15, 40, 100, 250);


// arcade
export const ARCADE_WINS = countTiers(50, 250, 750, 2000, 5000, 10000); // every arcade game added up
export const ARCADE_COINS = countTiers(10_000, 50_000, 150_000, 500_000, 1_500_000, 5_000_000);

export const BLOCKINGDEAD_WINS = countTiers(10, 50, 150, 400, 1000, 2500);
export const BLOCKINGDEAD_KILLS = countTiers(500, 2500, 10000, 30000, 75000, 200000);
export const BOUNTYHUNTERS_WINS = countTiers(10, 50, 150, 400, 1000, 2500);
export const BOUNTYHUNTERS_KDR = ratioTiers(0.75, 1.5, 2.5, 4, 6, 10);
export const CREEPERATTACK_MAXWAVES = countTiers(5, 10, 15, 20, 25, 30);
export const DISASTERS_WINS = countTiers(10, 50, 150, 400, 1000, 2500);
export const DRAGONWARS_WINS = countTiers(10, 50, 150, 400, 1000, 2500);
export const DRAGONWARS_KILLS = countTiers(500, 2500, 10000, 30000, 75000, 200000);
export const DROPPERS_WINS = countTiers(10, 50, 150, 400, 1000, 2500);
export const DROPPER_FLAWLESS = countTiers(5, 10, 15, 20, 25, 30);
export const ENDERSPLEEF_WINS = countTiers(10, 50, 150, 400, 1000, 2500);
export const ENDERSPLEEF_BLOCKSBROKEN = countTiers(500, 2500, 10000, 30000, 75000, 200000);
export const FARMHUNT_WINS = countTiers(10, 50, 150, 400, 1000, 2500);
export const FARMHUNT_KILLS = countTiers(500, 2500, 10000, 30000, 75000, 200000);
export const FOOTBALL_WINS = countTiers(10, 50, 150, 400, 1000, 2500);
export const FOOTBALL_GOALS = countTiers(500, 2500, 10000, 30000, 75000, 200000);
export const GALAXYWARS_WINS = countTiers(10, 50, 150, 400, 1000, 2500);
export const GALAXYWARS_KDR = ratioTiers(0.75, 1.5, 2.5, 4, 6, 10);
export const HIDEANDSEEK_WINS = countTiers(10, 50, 150, 400, 1000, 2500);
export const HOLEINTHEWALLS_WINS = countTiers(10, 50, 150, 400, 1000, 2500);
export const HOLEINTHEWALLS_WALLS = countTiers(500, 2500, 10000, 30000, 75000, 200000);
export const HYPIXELSAYS_WINS = countTiers(10, 50, 150, 400, 1000, 2500);
export const HYPIXELSAYS_ROUNDS = countTiers(500, 2500, 10000, 30000, 75000, 200000);
export const MINIWALLS_WINS = countTiers(10, 50, 150, 400, 1000, 2500);
export const MINIWALLS_KDR = ratioTiers(0.75, 1.5, 2.5, 4, 6, 10);
export const PARTYGAMES_WINS = countTiers(10, 50, 150, 400, 1000, 2500);
export const PARTYGAMES_STARS = countTiers(500, 2500, 10000, 30000, 75000, 200000);
export const PIXELPAINTERS_WINS = countTiers(10, 50, 150, 400, 1000, 2500);
export const PIXELPARTY_WINS = countTiers(10, 50, 150, 400, 1000, 2500);
export const PIXELPARTY_WLR = ratioTiers(0.75, 1.5, 2.5, 4, 6, 10);
export const THROWOUT_WINS = countTiers(10, 50, 150, 400, 1000, 2500);
export const THROWOUT_KDR = ratioTiers(0.75, 1.5, 2.5, 4, 6, 10);
export const ZOMBIES_WINS = countTiers(10, 50, 150, 400, 1000, 2500);
export const ZOMBIES_KILLS = countTiers(500, 2500, 10000, 30000, 75000, 200000);


// simulators
export const EASTERSIM_WINS = countTiers(10, 50, 150, 400, 1000, 2500);
export const EASTERSIM_EGGS = countTiers(10, 50, 150, 400, 1000, 2500);
export const GRINCHSIM_WINS = EASTERSIM_WINS;
export const GRINCHSIM_GIFTS = EASTERSIM_EGGS;
export const HALLOWEENSIM_WINS = EASTERSIM_WINS;
export const HALLOWEENSIM_CANDY = EASTERSIM_EGGS;
export const SCUBASIM_WINS = EASTERSIM_WINS;
export const SCUBASIM_POINTS = EASTERSIM_EGGS;


// classic games
export const CLASSIC_WINS = countTiers(50, 250, 750, 2000, 5000, 10000); // the six classics added up
export const CLASSIC_KILLS = countTiers(500, 2500, 10000, 30000, 75000, 200000);

export const QUAKE_WINS = countTiers(10, 50, 150, 400, 1000, 2500);
export const QUAKE_KILLS = countTiers(500, 2500, 10000, 30000, 75000, 200000);
export const ARENA_WINS = countTiers(10, 50, 150, 400, 1000, 2500);
export const ARENA_KDR = ratioTiers(0.75, 1.5, 2.5, 4, 6, 10);
export const WALLS_WINS = countTiers(10, 50, 150, 400, 1000, 2500);
export const WALLS_KDR = ratioTiers(0.75, 1.5, 2.5, 4, 6, 10);
export const VAMPIREZ_HUMAN_WINS = countTiers(10, 50, 150, 400, 1000, 2500);
export const VAMPIREZ_HUMAN_KILLS = countTiers(500, 2500, 10000, 30000, 75000, 200000);
export const VAMPIREZ_HUMAN_KDR = ratioTiers(0.75, 1.5, 2.5, 4, 6, 10);
export const VAMPIREZ_VAMPIRE_WINS = countTiers(10, 50, 150, 400, 1000, 2500);
export const VAMPIREZ_VAMPIRE_KILLS = countTiers(500, 2500, 10000, 30000, 75000, 200000);
export const VAMPIREZ_VAMPIRE_KDR = ratioTiers(0.75, 1.5, 2.5, 4, 6, 10);
export const TKR_WINS = countTiers(10, 50, 150, 400, 1000, 2500);
export const TKR_TROPHIES = countTiers(25, 100, 300, 750, 1500, 3000);
export const PAINTBALL_WINS = countTiers(10, 50, 150, 400, 1000, 2500);
export const PAINTBALL_KDR = ratioTiers(0.75, 1.5, 3, 5, 8, 12);


// housing
export const HOUSING_COOKIES = countTiers(10, 50, 250, 1000, 5000, 25000);
