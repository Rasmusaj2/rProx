
# rProx
rProx is a Hypixel Proxy Service, acting as a middleman between your client & the Hypixel Network.

rProx watches who joins your games & lobbies, and looks up playerdata and stats

## Setup & Download
Clone the reposity & install the required dependencies.
```bash
git clone https://github.com/Rasmusaj2/rProx.git
cd rProx
npm install
npm start
```
*Otherwise, a Windows binary is available [`here`](https://github.com/Rasmusaj2/rProx/releases)*

After this rProx will be running on localhost:25565

On first boot, rProx creates a config.json file. Close rProx, and edit the config file.

Here it is recommended to set your Hypixel, Urchin and Seraph API Keys.

After the config is edited, reopen rProx, connect to `127.0.0.1:25565` on Minecraft, and [`link`](https://microsoft.com/link) your Microsoft account.

New settings are automatically filled into your config from new updates or plugins.

## Default Commands
() -  Required  arguments
[] - Optional Arguments

**Stat Commands:**

`//help` - Shows the ingame help menu

`//bw [user]` - Shows a players Bedwars statistics

`//sw [user]` - Shows a players SkyWars statistics

`//mm [user]` - Shows a players Murder Mystery statistics

`//fish [user]` - Shows a players Lobby Fishing statistics

`//tnt [user]` - Shows a players TNT Games statistics

`//uhc [user]` - Shows a players UHC statistics
 
`//duels [user] [gamemode]` - Shows a players Duels statistics

**Misc.**

`//who` - Alias for Hypixel /who

`//plugins` - View loaded and available plugins

`//reward [link]` - Show the daily reward options for the last link seen in chat 

`//reward claim [1-3]` - Claim a daily reward, highest tier if no option is given

`//afk [on|off]` - Toggle anti-afk, which DMs you a random string every `intervalSeconds` and hides the To/From echo

`//session [reset]` - Full breakdown of what you have fished in this session, per category and per hour

`//bossbar [info|test [seconds]|off|mode <replace|adopt|own>|entity <dragon|wither>]` - Put a test boss bar up, print what the injector is holding, or change how it draws without a restart

`//urchin [user]` - Check a users Urchin & Seraph tags

### Core Plugin Configuration

rProx comes with 7 inbuilt plugins for basic tooling, such as the stat commands mentioned previously, nametagStats, antiAfk, lobbyFishing & a daily reward handler

Configuration for these are set in [`config.json`](config.json) section called `builtInPlugins` - This section also works for configuration for external plugins, but the tooling for this is uncomplete.

The built in plugins include:

* **hypixelStats**

Allows usage of //bw, //sw, //uhc, etc.
```json
{
    "enabled": true, 
    "apiKey": "", // Hypixel API Key
    "cacheTtlSeconds": 300
}
```
* **nametagStats**

Shows player statistics in the tab menu or above their playerhead in lobbies & games
```json
"nametagStats": {
    "enabled": true,
    "aboveHead": true, // show stats above the players head
    "tablist": true, // show stats in the tablist
    "maxTablistPlayers": 32, // player list size above which we stop looking anyone new up, tablist and above-head alike. raise it to cover big hubs, at the cost of the API ratelimit
    "cacheTtlSeconds": 120,
    "lookupConcurrency": 4 // how many lookups are allowed to be in flight at once
} // NOTE: API Key here leeches from hypixelStats
```
* **dailyRewards**

Automatically claims daily reward links in chat
```json
"dailyRewards": {
    "enabled": true,
    "mode": "chat", // chat or auto - Decides if it should automatically claim a link when seen, or give the option to pick in chat
    "prefer": [], // which specific game to prefer, ie. "uhc", "skywars", "walls3". Will autopick this incase of ties
    "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) rProx/0.1", // what the reward page is asked as
    "timeoutMs": 10000
}
```
* **lobbyFishing**

Counts what you catch while lobby fishing and puts the session totals on the sidebar, underneath Hypixels own fishing lines

Also helps with a mythical fish boss bar

```json
"lobbyFishing": {
    "enabled": true,
    "sidebar": true, // false counts catches for //catches without touching the sidebar
    "maxSidebarLines": 15, // rows your client actually renders. raise it if yours draws more than vanilla, and none of Hypixels rows get hidden
    "spacer": true, // blank row between Hypixels rows and ours
    "hideRows": ["hypixel level"], // Hypixel rows to drop to make room, matched as regex, colorless and case insensitively
    "colors": { // the number color per row, a name like "gold" or a code like "§6"
        "total": "green",
        "fish": "yellow",
        "plant": "dark_green",
        "mythical": "gold",
        "treasure": "aqua",
        "junk": "gray",
        "creature": "light_purple"
    },
    "mythical": {
        "enabled": true, 
        "bossBar": true, // show heat on bossbar
        "debug": false, // allow //bossbar debug commands
        "bar": "heat", // what bar progress fills with, "heat" or "progress
        "bossBarMode": "replace", // "replace", "adopt" or "own". use replace
        "bossEntity": "dragon", // "wither" or "dragon"
        "heatPerClick": 10, 
        "heatDecayPerSecond": 15, 
        "heatMax": 100,
        "safeHeat": 40 // when to start saying HOLD instead of CLICK
    }
}
```
* **antiAfk**

Prevents you from being afk-kicked in lobbies

Can be toggled with `//afk on` & `//afk off`
```json
"antiAfk": {
    "enabled": false, // NOTE - by default this is the only plugin thats deactivated
    "intervalSeconds": 150, // time between triggering
    "prefix": "[AFK] ", // message prefix
    "charset": "abcdefghijklmnopqrstuvwxyz0123456789", // characters to pick from when designing a random message
    "messageLength": 16, // how long the random message should be
    "hideMessages": true, // if the messages should be hidden from you
    "autoStart": true, // if should be enabled on login, or you have to use //afk on
    "lobbyOnly": true, // only message while in a lobby, held back during games (needs nametagStats on)
    "targetUser": null // what user to message. If null, will message yourself.
}
```
* **Urchin**

Urchin (Coral) & Seraph API support for cheaters

Players can be looked up with `//urchin`
```json
"urchin": {
            "enabled": true,
            "apiKey": "", // urchin api key gotten through the Urchin discord bot /dashboard
            "baseUrl": "https://api.urchin.gg",
            "cacheTtlSeconds": 600,
            "ignoreTypes": [], // tags to ignore
            "timeoutMs": 6000,
            "types": {},
            "alerts": {
                "enabled": true, // if chat messages should be sent
                "onJoin": true, // when a new player joins a lobby
                "onLobby": true, // when you join a new lobby
                "repeatSeconds": 300 // gap between sending an alert for the same player
            },
            "seraph": {
                "enabled": true, // use seraph as well
                "apiKey": "", // seraph api key
                "baseUrl": "https://api.seraph.si",
                "scoreFactors": "",
                "scoreThreshold": 0 // when to show a SNIPER tag based on seraphs sniper score
            }
        }
```

### Extendable plugins
rProx supports custom Plugins to add extended functionality and stat checking features.

Writing a plugin is simple. Add a file in the [`./plugins/`](plugins/) directory (Or whats set in `pluginDirectory` in the config). Plugins support javascript code. 

An example is supplied in [`plugins/example.plugin.js`](plugins/example.plugin.js).

A plugin can ship its own settings by exporting a `defaultConfig` alongside `name`
and `setup`. It gets written into `builtInPlugins` under the plugins name the first
time it loads, and handed back as `api.pluginConfig`:

```js
module.exports = {
    name: "example",

    defaultConfig: {
        enabled: true,
        reply: "pong",
    },

    setup(api) {
        const reply = api.pluginConfig.reply ?? "pong"; // already filled in from config.json
        // ...
    },
}
```

A plugin without a `defaultConfig` still gets an `"enabled": true` block written for it, so anything in the directory can be switched off from `config.json`.

⚠️ **Please be aware that plugins can execute arbitrary code on your machine. Only install plugins you trust.**

#### Proxy Apis for plugins

Higher level helpers like the sidebar api are handed out by the proxy under the
name `rprox`, so a plugin never has to know where they sit on disk:

```js
const { createSidebarApi, colors } = require("rprox"); // or "rprox/sidebar", "rprox/colors" if you wish to import only certain functionality.
```

Do not require them by path. `require("../src/interface/sidebarApi")` only works when running from source, not as a packaged `.exe` 
