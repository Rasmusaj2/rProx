
# rProx
rProx is a Hypixel Proxy Service, acting as a middleman between your client & the Hypixel Network.

rProx watches who joins your games & lobbies, and looks up playerdata and stats

## Public Service
rProx runs a public test-proxy available at `temp.rasmus.zip`

Please be aware that this server will store your Session Token when logging in. Use it with caution. 

⚠️**Do not use third party hosts. These can be malicious and steal your account and/or session token.**

It is recommended to run rProx locally, as this also reduces your latency. This test proxy is hosted in Germany, so your ping will increase accordingly to routing through a VPN in Germany, then back to the Hypixel Network.

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

`//duels [user] [gamemode]` - Shows a players Duels statistics

**Misc.**

`//who` - Alias for Hypixel /who

`//plugins` - View loaded and available plugins

### Extendable plugins
rProx supports custom Plugins to add extended functionality and stat checking features.

Writing a plugin is simple. Add a file in the [`./plugins/`](plugins/) directory (Or whats set in `pluginDirectory` in the config). Plugins support javascript code. 

An example is supplied in [`plugins/example.plugin.js`](plugins/example.plugin.js).

⚠️ **Please be aware that plugins can execute arbitrary code on your machine. Only install plugins you trust.**