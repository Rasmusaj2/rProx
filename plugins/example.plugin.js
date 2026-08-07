module.exports = {
    name: "example",
    version: "1.0.0",
    description: "An example plugin for the rProx proxy.",
    
    defaultConfig: {
        enabled: true,
        reply: "pong",
    },

    setup(api) {
        const reply = api.pluginConfig.reply ?? "pong";

        api.registerCommand(
            "ping",
            async (args, session) => { session.chat.text(reply) },
            "Responds with 'pong' to test the plugin.")
    }
}
