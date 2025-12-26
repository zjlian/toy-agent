import { type CommandAction, type CommandDefinition } from "./command_system";
import { type ChatContext } from "../chat_runner";

export const exitCommand: CommandDefinition<ChatContext> = {
    name: "exit",
    description: "Exit program",
    handler: async ({ ui }, _args): Promise<CommandAction> => {
        ui.printSystem("Goodbye!");
        return { type: "exit" };
    },
};

