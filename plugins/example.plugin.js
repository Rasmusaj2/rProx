const { createSidebarApi } = require("rprox"); // handed out by the proxy
// this import is not needed, but allows you to use the types in your plugin code, along with the various api interfaces available in the proxy (ie. Session, Chat, and in this case, the SidebarApi)

module.exports = {
    name: "example",
    version: "1.0.0",
    description: "An example plugin for the rProx proxy.",

    defaultConfig: {
        enabled: false,
        reply: "pong",
    },

    setup(api) {
        const config = api.pluginConfig ?? this.defaultConfig;
        const bars = new Map(); // sidebars

        const sidebarFor = (session) => { // get or create a sidebar for this session
            let sidebar = bars.get(session.id);
            if (!sidebar) {
                sidebar = createSidebarApi(
                    { sendPacket: (name, data) => session.sendPacket(name, data) },
                    { onError: (error) => api.log.error(`sidebar: ${error}`) },
                ); 
                bars.set(session.id, sidebar);
            }
            return sidebar;
        };

        api.registerCommand("ping", async (args, session) => { session.chat.text(config.reply) },
            "Responds with 'pong' to test the plugin.");

        api.registerCommand("togglesidebar", async (args, session) => {
            const sidebar = sidebarFor(session);
            sidebar.setVisible(!sidebar.enabled ? true : false); 
            sidebar.setEnabled(!sidebar.enabled);
            session.chat.text(`Sidebar is now ${sidebar.enabled ? "enabled" : "disabled"}.`);
        }, "Toggles the sidebar on or off.");

        api.on("serverPacket", (name, data, session) => sidebarFor(session).handlePacket(name, data));
        api.on("sessionEnd", (session) => { // clean up
            bars.get(session.id)?.dispose();
            bars.delete(session.id);
        });
    },
};