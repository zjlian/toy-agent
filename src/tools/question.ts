import { type Tool } from "./tool_system";
import type { ChatContext } from "../chat_runner";

const MAX_SUGGESTIONS = 4;

type SuggestionsResult = { values: string[]; truncated: boolean };

function normalizeQuestion(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

function normalizeSuggestions(value: unknown): SuggestionsResult {
    if (!Array.isArray(value)) {
        return { values: [], truncated: false };
    }

    const flattened: string[] = [];
    for (const entry of value) {
        if (typeof entry !== "string") continue;
        const trimmed = entry.trim();
        if (trimmed) flattened.push(trimmed);
    }

    const truncated = flattened.length > MAX_SUGGESTIONS;
    return { values: flattened.slice(0, MAX_SUGGESTIONS), truncated };
}

function formatPrompt(question: string, suggestions: string[], truncated: boolean): string {
    const lines = [question];
    if (suggestions.length) {
        lines.push("", "参考回复：");
        suggestions.forEach((opt, idx) => {
            lines.push(`${idx + 1}. ${opt}`);
        });
        if (truncated) {
            lines.push("(提示：参考回复已根据上限截断，仅显示前 4 个)");
        }
    }
    return lines.join("\n");
}

export const questionTool: Tool<ChatContext> = {
    name: "question",
    description:
        "向真实用户发起提问，等待其输入回复。可选传入不超过 4 个推荐答案以辅助判断，返回用户的实际回答。",
    parameters: {
        type: "object",
        properties: {
            question: { type: "string", description: "要询问用户的问题，必须是非空字符串" },
            suggestions: {
                type: "array",
                description: "可选推荐答案（最多 4 个），将以列表形式展示给用户",
                items: { type: "string" },
                maxItems: MAX_SUGGESTIONS,
            },
        },
        required: ["question"],
        additionalProperties: false,
    },
    handler: async (ctx, args) => {
        const question = normalizeQuestion(args.question);
        if (!question) {
            return "Error: 'question' is required and must be a non-empty string";
        }

        const { values: suggestions, truncated } = normalizeSuggestions(args.suggestions);
        const prompt = formatPrompt(question, suggestions, truncated);
        ctx.ui.printSystem(prompt);
        const answerRaw = await ctx.ui.promptUser();
        const answer = answerRaw.trim();

        const payload = {
            question,
            suggestions,
            suggestions_truncated: truncated,
            answer,
        };

        return JSON.stringify(payload, null, 2);
    },
};
