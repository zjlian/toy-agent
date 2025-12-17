import { type CommandDefinition } from "./command_system";
import { type ChatContext } from "../chat_runner";
import { ensureSystemPrompt } from "../system_prompt";

export const clearCommand: CommandDefinition<ChatContext> = {
    name: "clear",
    description: "Clear conversation context",
    handler: async ({ conversationHistory, ui, notebook }, _args) => {
        conversationHistory.length = 0;
        notebook.clear();
        ensureSystemPrompt(conversationHistory);
        ui.printSystem("Cleared conversation context.");
    },
};

