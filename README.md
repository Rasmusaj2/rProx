
# rProx
rProx is a Hypixel Proxy Service, acting as a middleman between your client & the Hypixel Network.

rProx watches who joins your games & lobbies, and looks up playerdata and stats

## Setup & Download
Clone the reposity & install the required dependencies.
```bash
npm install
cp  config.example.json  config.json  # then edit config.json - On Windows, copy the file config.example.json file
npm  run  dev  # or: npm run build && npm run serve
```
After this rProx will be running on localhost:25565



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

### Core Plugin Configuration

rProx comes with 5 inbuilt plugins for basic tooling, such as the stat commands mentioned previously, nametagStats, antiAfk & a daily reward handler

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
    "maxTablistPlayers": 32, // max amount of people to check at once
    "cacheTtlSeconds": 120
} // NOTE: API Key here leeches from hypixelStats
```
* **dailyRewards**

Automatically claims daily reward links in chat
```json
"dailyRewards": {
    "enabled": true,
    "mode": "chat", // chat or auto - Decides if it should automatically claim a link when seen, or give the option to pick in chat
    "prefer": [], // which specific game to prefer, ie. "uhc", "skywars", "walls3". Will autopick this incase of ties
    "timeoutMs": 10000
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
    "targetUser": null // what user to message. If null, will message yourself.
}
```

### Extendable plugins
rProx supports custom Plugins to add extended functionality and stat checking features.

Writing a plugin is simple. Add a file in the [`./plugins/`](plugins/) directory (Or whats set in `pluginDirectory` in the config). Plugins support javascript code. 

An example is supplied in [`plugins/example.plugin.js`](plugins/example.plugin.js).

⚠️ **Please be aware that plugins can execute arbitrary code on your machine. Only install plugins you trust.**