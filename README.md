
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

### Extendable plugins
rProx supports custom Plugins to add extended functionality and stat checking features.

Writing a plugin is simple. Add a file in the [`./plugins/`](plugins/) directory (Or whats set in `pluginDirectory` in the config). Plugins support javascript code. 

An example is supplied in [`plugins/example.plugin.js`](plugins/example.plugin.js).

⚠️ **Please be aware that plugins can execute arbitrary code on your machine. Only install plugins you trust.**