import { type CommandDefinition } from "./command_system";
import { type ChatContext } from "../chat_runner";

export const toolsCommand: CommandDefinition<ChatContext> = {
    name: "tools",
    description: "List available tools",
    handler: async ({ ui, toolSystem }) => {
        const lines = toolSystem.list().map((t) => `  - ${t.name}: ${t.description}`);
        ui.printSystem(["Available tools:", ...lines].join("\n"));
    },
};

