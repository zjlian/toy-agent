import { mkdir } from "node:fs/promises";
import { type ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { generate } from "../llm_client";
import { type ChatContext } from "../chat_runner";
import { type CommandDefinition } from "./command_system";

export const saveCommand: CommandDefinition<ChatContext> = {
    name: "save",
    description: "Save conversation to .toyagent/docs/ directory with AI-generated title",
    handler: async ({ conversationHistory, ui, client, model }, _args) => {
        try {
            // Ensure .toyagent/docs directory exists.
            const docsDir = ".toyagent/docs";
            try {
                await mkdir(docsDir, { recursive: true });
            } catch {
                // Best-effort: directory may already exist.
            }

            ui.printSystem("Generating title for conversation...");
            const title = await generateTitleForConversation({
                client,
                model,
                history: conversationHistory,
            });

            const safeFilename = sanitizeFilename(title);
            const filename = `${safeFilename}.md`;
            const filepath = `${docsDir}/${filename}`;

            const markdownContent = formatConversationToMarkdown(conversationHistory, title);
            await Bun.write(filepath, markdownContent);

            ui.printSystem(`Conversation saved to: ${filepath}`);
        } catch (error) {
            ui.printError(`Failed to save conversation: ${error instanceof Error ? error.message : String(error)}`);
        }
    },
};

async function generateTitleForConversation(options: {
    client: ChatContext["client"];
    model: ChatContext["model"];
    history: ChatCompletionMessageParam[];
}): Promise<string> {
    const { client, model, history } = options;

    // Create a simplified subset of messages for title generation.
    const conversationForTitle: ChatCompletionMessageParam[] = history
        .filter((msg) => msg.role === "user" || msg.role === "assistant")
        .map((msg) => {
            const content = (msg as { content?: unknown })?.content;
            const text = typeof content === "string" ? content : safeStringifyContent(content);
            return {
                role: msg.role,
                content: text.slice(0, 200),
            } as ChatCompletionMessageParam;
        })
        .slice(-6);

    const titleRequest: ChatCompletionMessageParam[] = [
        {
            role: "system",
            content:
                "你是一个对话标题生成助手。请为给定的对话生成一个简洁、有意义的标题。标题应该：1) 反映对话的主要主题 2) 长度在5-15个字符之间 3) 使用中文 4) 只返回标题，不要其他解释或标点符号",
        },
        ...conversationForTitle,
        {
            role: "user",
            content: "为此次对话生成一个简单的标题",
        },
    ];

    const response = await generate(client, {
        model,
        messages: titleRequest,
        temperature: 1,
        max_tokens: 120_000,
    });

    const rawTitle = response.choices[0]?.message?.content?.trim() || "未命名对话";
    const title = rawTitle.replace(/[\r\n]+/g, " ").trim();
    return title.length > 15 ? title.substring(0, 15) : title;
}

function sanitizeFilename(filename: string): string {
    const cleaned = filename
        .replace(/[<>:\"/\\|?*]/g, "")
        .replace(/\s+/g, "-")
        .replace(/--+/g, "-")
        .replace(/^-+|-+$/g, "")
        .replace(/[. ]+$/g, "")
        .trim();

    return cleaned || "未命名对话";
}

function formatConversationToMarkdown(history: ChatCompletionMessageParam[], title?: string): string {
    const lines: string[] = [];

    lines.push(`# ${title || "Chat Conversation"}`);
    lines.push("");
    lines.push(`**Saved at:** ${new Date().toLocaleString()}`);
    lines.push(`**Total messages:** ${history.length}`);
    lines.push("");
    lines.push("---");
    lines.push("");

    history.forEach((message, index) => {
        const role = message.role;
        const header =
            role === "system"
                ? "## System Message"
                : role === "user"
                    ? "## 👤 User"
                    : role === "assistant"
                        ? "## 🤖 Assistant"
                        : role === "tool"
                            ? "## 🔧 Tool"
                            : `## ${role}`;

        lines.push(header);
        lines.push("");
        lines.push(`**#${index + 1}**`);

        // Tool message metadata (best-effort; shape differs by role).
        if (role === "tool") {
            const toolCallId = (message as any)?.tool_call_id;
            if (toolCallId) {
                lines.push("");
                lines.push(`**tool_call_id:** ${toolCallId}`);
            }
        }

        const content = (message as any)?.content;
        const bodyText = contentToMarkdownText(content);

        if (bodyText) {
            lines.push("");
            lines.push(bodyText);
        }

        // Assistant tool_calls (if any)
        const toolCalls = (message as any)?.tool_calls;
        if (toolCalls?.length) {
            lines.push("");
            lines.push("**tool_calls:**");
            lines.push("```json");
            lines.push(JSON.stringify(toolCalls, null, 2));
            lines.push("```");
        }

        lines.push("");
        lines.push("---");
        lines.push("");
    });

    return lines.join("\n");
}

function safeStringifyContent(content: unknown): string {
    if (content == null) return "";
    if (typeof content === "string") return content;
    try {
        return JSON.stringify(content);
    } catch {
        return String(content);
    }
}

function contentToMarkdownText(content: unknown): string {
    if (content == null) return "";
    if (typeof content === "string") return content.trim();

    // OpenAI content parts (array) or other structures.
    try {
        return "```json\n" + JSON.stringify(content, null, 2) + "\n```";
    } catch {
        return String(content);
    }
}

