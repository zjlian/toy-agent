import * as readline from "node:readline";
import { type ChatUI } from "../cli_ui";
import { type Tool } from "./tool_system";

const MAX_SUGGESTIONS = 4;

let boundUI: ChatUI | null = null;

export function bindQuestionToolUI(ui: ChatUI | null): void {
    boundUI = ui;
}

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
        lines.push("", "推荐答案：");
        suggestions.forEach((opt, idx) => {
            lines.push(`${idx + 1}. ${opt}`);
        });
        if (truncated) {
            lines.push("(提示：推荐答案已根据上限截断，仅显示前 4 个)");
        }
    }
    return lines.join("\n");
}

async function askViaUI(question: string, suggestions: string[], truncated: boolean): Promise<string> {
    const ui = boundUI;
    if (!ui) return askViaReadline(question, suggestions, truncated);

    ui.printSystem(formatPrompt(question, suggestions, truncated));
    const answer = await ui.promptUser();
    return answer.trim();
}

async function askViaReadline(question: string, suggestions: string[], truncated: boolean): Promise<string> {
    const promptText = formatPrompt(question, suggestions, truncated);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise<string>((resolve) => {
        rl.question(`${promptText}\n> `, (answer) => {
            rl.close();
            resolve(answer.trim());
        });
    });
}

async function askUser(question: string, suggestions: string[], truncated: boolean): Promise<string> {
    return askViaUI(question, suggestions, truncated);
}

export const questionTool: Tool = {
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
    handler: async (args) => {
        const question = normalizeQuestion(args.question);
        if (!question) {
            return "Error: 'question' is required and must be a non-empty string";
        }

        const { values: suggestions, truncated } = normalizeSuggestions(args.suggestions);
        const answer = await askUser(question, suggestions, truncated);

        const payload = {
            question,
            suggestions,
            suggestions_truncated: truncated,
            answer,
        };

        return JSON.stringify(payload, null, 2);
    },
};
