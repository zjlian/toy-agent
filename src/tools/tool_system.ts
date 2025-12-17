/**
 * Minimal tool system for OpenAI-style tool calling.
 *
 * Notes:
 * - `parameters` should be a JSON Schema object (draft-07-ish is fine).
 * - `handler` should return a string that will be sent back to the model as tool output.
 */

import { type ChatRequest } from "../llm_client";

export interface Tool<Ctx> {
    name: string;
    description: string;
    /** JSON Schema */
    parameters: Record<string, any>;
    handler: (ctx: Ctx, args: Record<string, any>) => Promise<string>;
}

/** The exact OpenAI request `tools` type (keeps us aligned with the SDK). */
export type OpenAITools = NonNullable<ChatRequest["tools"]>;

/** A lightweight subset of OpenAI tool_call objects we need to execute tools. */
export type ToolCallLike = {
    id: string;
    type?: string;
    function: {
        name: string;
        arguments: string;
    };
};

export type ToolResultMessageLike = {
    role: "tool";
    tool_call_id: string;
    content: string;
};

function safeJsonParse(value: string): { ok: true; data: any } | { ok: false; error: string } {
    try {
        return { ok: true, data: JSON.parse(value) };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}

export class ToolSystem<Ctx> {
    private readonly tools = new Map<string, Tool<Ctx>>();

    register(tool: Tool<Ctx>): this {
        const name = tool.name.trim();
        if (!name) throw new Error("Tool name cannot be empty");
        if (this.tools.has(name)) throw new Error(`Tool already registered: ${name}`);
        this.tools.set(name, { ...tool, name });
        return this;
    }

    list(): Tool<Ctx>[] {
        return Array.from(this.tools.values());
    }

    toOpenAITools(): OpenAITools {
        return this.list().map((t) => ({
            type: "function",
            function: {
                name: t.name,
                description: t.description,
                parameters: t.parameters,
            },
        }));
    }

    async execute(toolName: string, ctx: Ctx, args: Record<string, any>): Promise<string> {
        const tool = this.tools.get(toolName);
        if (!tool) return `Error: unknown tool '${toolName}'`;
        try {
            return await tool.handler(ctx, args);
        } catch (err) {
            return `Error: tool '${toolName}' failed - ${err instanceof Error ? err.message : String(err)}`;
        }
    }

    /**
     * Executes a batch of tool calls and returns tool-result messages
     * (to be appended to the conversation history).
     */
    async handleToolCalls(toolCalls: ToolCallLike[], ctx: Ctx): Promise<ToolResultMessageLike[]> {
        const results: ToolResultMessageLike[] = [];
        for (const call of toolCalls) {
            const name = call.function?.name;
            const argText = call.function?.arguments ?? "{}";

            const parsed = safeJsonParse(argText);
            const args = parsed.ok && typeof parsed.data === "object" && parsed.data !== null ? parsed.data : {};
            const parseError = parsed.ok ? null : parsed.error;

            const output = parseError
                ? `Error: invalid JSON arguments for tool '${name}': ${parseError}`
                : await this.execute(name, ctx, args);

            results.push({
                role: "tool",
                tool_call_id: call.id,
                content: output,
            });
        }
        return results;
    }
}
