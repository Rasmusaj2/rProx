import { stripColorCodes } from "../util/mcColors";
import type { Tag } from "./types";

// which hypixel game the client is currently looking at
export type GameMode = // this is kinda annoying to keep as a string union should've probably been like an enum but whatever
// single gamemode games
  "bedwars" 
| "skywars" 
| "duels" 
| "murdermystery"
| "blitz"
| "cvc"
| "megawalls"
| "smashheroes"
| "warlords"

// build battle
| "buildbattle"
| "guessthebuild"

// uhc
| "uhc"
| "speeduhc"

// tnt games
| "tntgames"
| "tntrun"
| "tnttag"
| "pvprun"
| "tntwizards"
| "bowspleef"

// wool games
| "woolgames"
| "woolwars"
| "sheepwars"
| "ctw"

// arcade
| "arcade"
| "blockingdead"
| "bountyhunters"
| "creeperattack"
| "disasters"
| "dragonwars"
| "dropper"
| "enderspleef"
| "farmhunt"
| "football"
| "galaxywars"
| "hideandseek"
| "holeinthewall"
| "hypixelsays"
| "miniwalls"
| "partygames"
| "pixelpainters"
| "pixelparty"
| "throwout"
| "zombies"

// simulators
| "grinchsim"
| "santasim"
| "scubasim"
| "eastersim"
| "halloweensim"

// classic games
| "classic"
| "quake"
| "arena"
| "thewalls"
| "vampirez"
| "tkr"
| "paintball"

// other
| "housing" 
| "lobby" // fishing primarily
| "unknown";

// get from sidebar
// REMEMBER: this matches first regex. keep simpler regexes later to avoid overlapping (ie. "hypixel" for the hypixel lobby, but that regex also gets triggered by hypixel says - same with (s)uhc)
const TITLES: Array<[pattern: RegExp, game: GameMode]> = [
    [/BED\s*WARS/, "bedwars"],
    [/SKY\s*WARS/, "skywars"],
    [/DUELS?/, "duels"],
    [/MURDER\s*MYSTERY/, "murdermystery"],
    [/BLITZ\s*SG/, "blitz"],
    [/COPS\s*AND\s*CRIMS/, "cvc"],
    [/MEGA\s*WALLS?/, "megawalls"],
    [/SMASH\s*HEROES?/, "smashheroes"],
    [/WARLORDS?/, "warlords"],


    [/BUILD\s*BATTLE/, "buildbattle"],
    [/GUESS\s*THE\s*BUILD/, "guessthebuild"],
    
    [/SPEED\s*UHC/, "speeduhc"],
    [/UHC/, "uhc"],


    [/TNT\s*GAMES?/, "tntgames"],
    [/TNT\s*RUN/, "tntrun"],
    [/TNT\s*TAG/, "tnttag"],
    [/PVP\s*RUN/, "pvprun"],
    [/TNT\s*WIZARDS?/, "tntwizards"],
    [/BOW\s*SPLEEF/, "bowspleef"],


    [/WOOL\s*GAMES?/, "woolgames"],
    [/WOOL\s*WARS?/, "woolwars"],
    [/SHEEP\s*WARS?/, "sheepwars"],
    [/CAPTURE\s*THE\s*WOOL/, "ctw"],


    [/ARCADE\s*GAMES?/, "arcade"],
    [/BLOCKING\s*DEAD/, "blockingdead"],
    [/BOUNTY\s*HUNTERS?/, "bountyhunters"],
    [/CREEPER\s*ATTACK/, "creeperattack"],
    [/DISASTERS?/, "disasters"],
    [/DRAGON\s*WARS?/, "dragonwars"],
    [/DROPPER/, "dropper"],
    [/ENDER\s*SPLEEF/, "enderspleef"],
    [/FARM\s*HUNT/, "farmhunt"],
    [/FOOTBALL/, "football"],
    [/GALAXY\s*WARS?/, "galaxywars"],
    [/HIDE\s*AND\s*SEEK/, "hideandseek"],
    [/HOLE\s*IN\s*THE\s*WALL/, "holeinthewall"],
    [/HYPIXEL\s*SAYS?/, "hypixelsays"],
    [/MINI\s*WALLS?/, "miniwalls"],
    [/PARTY\s*GAMES?/, "partygames"],
    [/PIXEL\s*PAINTERS?/, "pixelpainters"],
    [/PIXEL\s*PARTY/, "pixelparty"],
    [/THROW\s*OUT/, "throwout"],
    [/ZOMBIES?/, "zombies"],


    [/GRINCH\s*SIM/, "grinchsim"],
    [/SANTA\s*SIM/, "santasim"],
    [/SCUBA\s*SIM/, "scubasim"],
    [/EASTER\s*SIM/, "eastersim"],
    [/HALLOWEEN\s*SIM/, "halloweensim"],


    [/CLASSIC\s*GAMES?/, "classic"],
    [/QUAKE/, "quake"],
    [/ARENA/, "arena"],
    [/THE\s*WALLS?/, "thewalls"],
    [/VAMPIREZ?/, "vampirez"],
    [/TURBO\s*KART\s*RACERS/, "tkr"],
    [/PAINTBALL/, "paintball"],


    [/HOUSING/, "housing"],
    [/HYPIXEL/, "lobby"], // keep this at the bottom so it only matches if nothing else does. hypixel says matches otherwise but im not implementing it yet
];

export function gameFromTitle(title: string): GameMode {
    const clean = stripColorCodes(title).toUpperCase();
    for (const [pattern, game] of TITLES) {
        if (pattern.test(clean)) return game;
    }
    return "unknown";
}

// lobbies and games we dont know fall back to bedwars, thats what most of this
// is built around and its what used to show everywhere
export function statsGame(game: GameMode): GameMode {
    return game === "unknown" ? "bedwars" : game;
}

// tags with no game on them are game agnostic (cheater flags and the like)
export function tagsForGame(tags: Tag[], game: GameMode): Tag[] {
    const wanted = statsGame(game);
    return tags.filter((tag) => !tag.game || tag.game === wanted);
}

interface ObjectivePacket {
    name: string;
    action: number; // 0 create, 1 remove, 2 update
    displayText?: string;
}

interface DisplayObjectivePacket {
    position: number; // 1 is the sidebar
    name: string;
}

const SIDEBAR = 1;

// follows the scoreboard to work out what the client is playing. both apply
// methods return true when the active game actually changed.
export class GameTracker {
    private titles = new Map<string, string>(); // objective name -> its display title
    private sidebar?: string; // objective currently shown in the sidebar
    private current: GameMode = "unknown";

    get game(): GameMode {
        return this.current;
    }

    applyObjective(packet: ObjectivePacket): boolean {
        if (packet.action === 1) this.titles.delete(packet.name);
        else if (typeof packet.displayText === "string") this.titles.set(packet.name, packet.displayText);
        return this.refresh();
    }

    applyDisplayObjective(packet: DisplayObjectivePacket): boolean {
        if (packet.position !== SIDEBAR) return false;
        this.sidebar = packet.name || undefined;
        return this.refresh();
    }

    private refresh(): boolean {
        const title = this.sidebar ? this.titles.get(this.sidebar) : undefined;
        const next = title ? gameFromTitle(title) : "unknown";
        if (next === this.current) return false;
        this.current = next;
        return true;
    }

    clear(): void {
        this.titles.clear();
        this.sidebar = undefined;
        this.current = "unknown";
    }
}
