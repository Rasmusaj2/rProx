module.exports = {
    name: "example",
    version: "1.0.0",
    description: "An example plugin for the rProx proxy.",

    setup(api) {
        
        api.registerCommand({
            name: "ping",
            description: "An example command.",
            execute: async (args, context) => {
                context.sendMessage("Pong!");
            }
        });
    }
}