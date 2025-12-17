import { type Tool } from "./tool_system";
import type { ChatContext } from "../chat_runner";

export const pwdTool: Tool<ChatContext> = {
    name: "pwd",
    description: "Print current working directory.",
    parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
    },
    handler: async () => process.cwd(),
};
