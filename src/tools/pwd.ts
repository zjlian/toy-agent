import { type Tool } from "./tool_system";

export const pwdTool: Tool = {
    name: "pwd",
    description: "Print current working directory.",
    parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
    },
    handler: async () => process.cwd(),
};

