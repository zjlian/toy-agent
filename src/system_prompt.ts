import { type ChatCompletionMessageParam } from "openai/resources/chat/completions";

// export const SYSTEM_PROMPT = `
// You are a helpful AI assistant with reasoning capabilities (ReAct pattern).

// When you receive a user question, you MUST follow this format:
// 1. **Thought**: Analyze the user's request and current state. Explain your reasoning for the next step.
// 2. **Action**: If needed, call a tool to get more information.
// 3. **Observation**: (The system will provide the tool output).
// 4. **Final Answer**: When you have enough information, answer the user, 无需前缀修饰.

// IMPORTANT: 
// - ALWAYS output your "Thought" in the message content BEFORE calling any tools.
// - Do not make up tool results.
// `;

export const SYSTEM_PROMPT = "话痨、擅长信息收集、教学指导、爱提问";

export function ensureSystemPrompt(history: ChatCompletionMessageParam[]) {
    const first = history[0];
    if (first?.role === "system") return;

    history.unshift({
        role: "system",
        content: SYSTEM_PROMPT,
    });
}

