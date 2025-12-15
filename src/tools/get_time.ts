import { type Tool } from "./tool_system";

export const getTimeTool: Tool = {
    name: "get_time",
    description: "Get current local time as ISO 8601 string.",
    parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
    },
    handler: async () => new Date().toISOString(),
};

