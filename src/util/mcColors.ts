// static color data
export type McColorName = 
| "black"
| "dark_blue"
| "dark_green"
| "dark_aqua"
| "dark_red"
| "dark_purple"
| "gold"
| "gray"
| "dark_gray"
| "blue"
| "green"
| "aqua"
| "red"
| "light_purple"
| "yellow"
| "white";

export const COLOR_CODES: Record<McColorName, string> = {
    black: "§0",
    dark_blue: "§1",
    dark_green: "§2",
    dark_aqua: "§3",
    dark_red: "§4",
    dark_purple: "§5",
    gold: "§6",
    gray: "§7",
    dark_gray: "§8",
    blue: "§9",
    green: "§a",
    aqua: "§b",
    red: "§c",
    light_purple: "§d",
    yellow: "§e",
    white: "§f",
};

export const COLOR_RGB: Record<McColorName, number> = { 
    black: 0x000000,
    dark_blue: 0x0000AA,
    dark_green: 0x00AA00,
    dark_aqua: 0x00AAAA,
    dark_red: 0xAA0000,
    dark_purple: 0xAA00AA,
    gold: 0xFFAA00,
    gray: 0xAAAAAA,
    dark_gray: 0x555555,
    blue: 0x5555FF,
    green: 0x55FF55,
    aqua: 0x55FFFF,
    red: 0xFF5555,
    light_purple: 0xFF55FF,
    yellow: 0xFFFF55,
    white: 0xFFFFFF,
}

// strip color codes from a string
export function stripColorCodes(str: string): string {
    return str.replace(/§[0-9a-fk-or]/gi, "");
}

const CODE_TO_NAME = new Map<string, McColorName>(
    (Object.entries(COLOR_CODES) as [McColorName, string][]).map(([name, code]) => [code.slice(1), name]),
);

export function colorFromCode(code: string): McColorName | undefined {
    return CODE_TO_NAME.get(code.toLowerCase());
}

// hypixel does uppercase names so we normalize
export function colorFromName(name: string | undefined): McColorName | undefined {
    if (!name) return undefined;
    const key = name.toLowerCase() as McColorName;
    return key in COLOR_CODES ? key : undefined;
}

export function firstColor(str: string): McColorName | undefined {
    const match = /§([0-9a-f])/i.exec(str);
    return match ? colorFromCode(match[1]) : undefined;
}

// color appended to string after text, useful for when we change a prefix and need to know what color to continue with
export function lastColor(str: string): McColorName | undefined {
    const re = /§([0-9a-f])/gi;
    let found: McColorName | undefined;
    let match: RegExpExecArray | null;
    while ((match = re.exec(str)) !== null) found = colorFromCode(match[1]);
    return found;
}

export function colorToRgb(color: McColorName | undefined): number {
    return color ? COLOR_RGB[color] : COLOR_RGB.gray;
}