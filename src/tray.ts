import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import net from "node:net";
import readline from "node:readline";
import type { Config } from "./config";
import { createLogger } from "./util/log";
import { baseDir, fromBase } from "./util/paths";
import { style } from "./util/term";

// keep the proxy alive in the background even without a console

const BACKGROUND_FLAG = "--background";
const CONSOLE_TITLE = "rProx console"; // tray icon locates this
const BACKLOG_CHUNKS = 1000; // output kept for a console that gets opened later
const STARTUP_TIMEOUT_MS = 15000;

const log = createLogger("tray");

export function trayEnabled(config: Config): boolean {
    return process.platform === "win32" && config.tray.enabled && !process.argv.includes("--no-tray");
}

export function isBackground(): boolean {
    return process.argv.includes(BACKGROUND_FLAG);
}

// one pipe per install folder, so it doubles as the "already running" check
function pipePath(): string {
    const id = createHash("md5").update(baseDir().toLowerCase()).digest("hex").slice(0, 12);
    return `\\\\.\\pipe\\rprox-${id}`;
}

// what it takes to restart the proxy in the background
function selfArgs(): string[] {
    return [...process.execArgv, process.argv[1]];
}

function connect(): Promise<net.Socket | undefined> {
    return new Promise((resolve) => {
        const socket = net.connect(pipePath());
        socket.once("connect", () => resolve(socket));
        socket.once("error", () => resolve(undefined));
    });
}

// attach to a running background copy, start if none is running
export async function attachConsole(socket?: net.Socket): Promise<boolean> {
    socket ??= await connect();
    if (!socket) return false;

    if (process.stdout.isTTY) process.stdout.write(`\x1b]0;${CONSOLE_TITLE}\x07`);
    console.log("rProx is running in the background");
    socket.pipe(process.stdout, { end: false });
    socket.on("error", () => {});
    socket.on("close", () => {
        console.log("rProx stopped");
        process.exit(0);
    });
    return true;
}

// start detached copy
export async function launchBackground(config: Config): Promise<void> {
    const child = spawn(process.execPath, [...selfArgs(), ...process.argv.slice(2), BACKGROUND_FLAG], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
    });
    let alive = true;
    child.once("exit", () => (alive = false));
    child.once("error", () => (alive = false));
    child.unref();

    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    while (alive && Date.now() < deadline) {
        const socket = await connect();
        if (socket && config.tray.startMinimized) process.exit(0);
        if (socket) {
            await attachConsole(socket);
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error("rProx not in background, try --no-tray");
}

// a new console window running a viewer
function openConsole(): void {
    const command = [process.execPath, ...selfArgs()].map((part) => `"${part}"`).join(" ");
    // start takes its first quoted argument as the window title, so there has to be one
    spawn("cmd.exe", ["/c", `start "${CONSOLE_TITLE}" ${command}`], {
        stdio: "ignore",
        windowsHide: true,
        windowsVerbatimArguments: true,
    }).on("error", (error) => log.warn(`could not open a console: ${error.message}`));
}

function trayIcon(config: Config): string {
    if (!config.tray.icon) return "";
    const path = fromBase(config.tray.icon);
    if (existsSync(path)) return path;
    log.warn(`tray.icon ${path} does not exist, using the default icon`);
    return "";
}

// Icon done through powershell because idk
function trayScript(config: Config): string {
    const quote = (text: string) => `'${text.replace(/'/g, "''")}'`;
    return `
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type -Namespace RProx -Name Win -MemberDefinition @'
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string cls, string title);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd, int cmd);
[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hwnd);
'@

$icon = $null
$custom = ${quote(trayIcon(config))}
if ($custom) {
    try {
        if ($custom -like '*.ico') { $icon = New-Object System.Drawing.Icon($custom) }
        else { $icon = [System.Drawing.Icon]::FromHandle((New-Object System.Drawing.Bitmap([System.Drawing.Image]::FromFile($custom), 32, 32)).GetHicon()) }
    } catch {}
}
if (-not $icon) { $icon = [System.Drawing.Icon]::ExtractAssociatedIcon(${quote(process.execPath)}) }

$global:viewers = 0
$show = {
    if ($global:viewers -gt 0) {
        $hwnd = [RProx.Win]::FindWindow([NullString]::Value, ${quote(CONSOLE_TITLE)})
        if ($hwnd -ne [IntPtr]::Zero) {
            if ([RProx.Win]::IsIconic($hwnd)) { [void][RProx.Win]::ShowWindow($hwnd, 9) }
            if ([RProx.Win]::SetForegroundWindow($hwnd)) { return }
        }
    }
    [Console]::Out.WriteLine('show')
}

$tray = New-Object System.Windows.Forms.NotifyIcon
$tray.Icon = $icon
$tray.Text = 'rProx'
$menu = New-Object System.Windows.Forms.ContextMenuStrip
$menu.Items.Add('Show console').add_Click($show)
$menu.Items.Add('Quit rProx').add_Click({ [Console]::Out.WriteLine('quit') })
$tray.ContextMenuStrip = $menu
$tray.add_MouseClick({ if ($_.Button -eq 'Left') { & $show } })
$tray.Visible = $true
if (${config.tray.notify && config.tray.startMinimized ? "$true" : "$false"}) {
    $tray.ShowBalloonTip(3000, 'rProx', 'Running in the background - click the icon for the console', 'Info')
}

$stdin = New-Object System.IO.StreamReader([Console]::OpenStandardInput())
$global:line = $stdin.ReadLineAsync()
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 200
$timer.add_Tick({
    while ($global:line.IsCompleted) {
        $text = $global:line.Result
        if ($null -eq $text) { [System.Windows.Forms.Application]::Exit(); return }
        if ($text -match '^viewers (\\d+)$') { $global:viewers = [int]$Matches[1] }
        $global:line = $stdin.ReadLineAsync()
    }
})
$timer.Start()
[System.Windows.Forms.Application]::Run()
$tray.Visible = $false
$tray.Dispose()
`;
}

export function startBackground(config: Config): void {
    const clients = new Set<net.Socket>();
    const backlog: string[] = [];

    // everything printed goes to tray icon so we can use it later
    for (const stream of [process.stdout, process.stderr]) {
        const write = stream.write.bind(stream) as (...args: unknown[]) => boolean;
        stream.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
            const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
            backlog.push(text);
            if (backlog.length > BACKLOG_CHUNKS) backlog.shift();
            for (const client of clients) client.write(text);
            return write(chunk, ...rest);
        }) as typeof stream.write;
    }

    const tray = spawn(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-STA", "-WindowStyle", "Hidden", "-EncodedCommand", Buffer.from(trayScript(config), "utf16le").toString("base64")],
        { stdio: ["pipe", "pipe", "ignore"], windowsHide: true },
    );
    tray.on("error", (error) => log.warn(`tray icon failed to start: ${error.message}`));
    tray.on("exit", (code) => log.warn(`tray icon exited (${code}), rProx is still running`));
    tray.stdin.on("error", () => {});
    readline.createInterface({ input: tray.stdout }).on("line", (line) => {
        if (line === "show") openConsole();
        if (line === "quit") process.exit(0);
    });

    const server = net.createServer((client) => {
        const drop = () => {
            if (clients.delete(client)) tray.stdin.write(`viewers ${clients.size}\n`);
        };
        client.on("error", drop);
        client.on("close", drop);
        client.write(backlog.join(""));
        clients.add(client);
        tray.stdin.write(`viewers ${clients.size}\n`);
    });
    server.on("error", (error) => log.warn(`console pipe failed: ${error.message}`));
    server.listen(pipePath());
}
