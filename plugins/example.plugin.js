module.exports = {
    name: "example",
    version: "1.0.0",
    description: "An example plugin for the rProx proxy.",

    setup(api) {
        api.registerCommand(
            "ping",
            async (args, session) => { session.chat.text("pong") },
            "Responds with 'pong' to test the plugin.")
    }
}