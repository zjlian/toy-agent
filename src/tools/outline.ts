import OpenAI from "openai";
import { encodingForModel, getEncoding, type Tiktoken } from "js-tiktoken";
import { type Tool } from "./tool_system";

const OUTLINE_SYSTEM_PROMPT = `
You are a precise Code Outline Extractor.
Goal: Produce a compact, structured Markdown outline of the file's *top-level API surface*.

### Hard Rules
1. **Output Format**: Strict Markdown. No code blocks, no intro/outro text.
2. **Scope**: Extract ONLY top-level exported/public definitions. Ignore local variables inside functions.
3. **Detail Level**:
   - For \`Interfaces/Types/Classes\`: You **MUST** list their properties/methods as sub-items.
   - For \`Functions\`: You **MUST** preserve the exact argument types and return types.
4. **Brevity**: Keep summaries to 5 words or less. If in doubt, include a brief summary.
5. Do not overthink. Prefer output over analysis.

### Formatting Template & Example (Follow this strictly!)

**Input Code:**
\`\`\`typescript
interface User {
  id: string; // The user id
  name: string;
}
export function login(user: User): Promise<boolean> { ... }
\`\`\`

**Output:**
## Types
- **Interface**: \`User\`
  - \`id: string\` — The user id
  - \`name: string\`

## Functions
- **Function**: \`login(user: User): Promise<boolean>\`

---

### Now process the following input:

[INPUT FILE CONTENT HERE]
`;

const MAX_CONTEXT_TOKENS = 100_000;

function toOneLine(text: string): string {
    // Keep streaming output compact in a single terminal line.
    // - Replace newlines with spaces
    // - Collapse repeated whitespace
    return text.replace(/\r?\n/g, " ").replace(/\s+/g, " ");
}

function createRollingLineWriter(options: { prefix: string; window: number }) {
    const prefix = options.prefix;
    const window = options.window;
    let buffer = "";

    const write = (chunk: string) => {
        if (!chunk) return;
        buffer += chunk;
        // Prevent unbounded growth from extremely long generations.
        if (buffer.length > window * 50) buffer = buffer.slice(-window * 50);

        const view = buffer.slice(-window);
        // Overwrite the same terminal line, padding to fully clear previous output.
        process.stdout.write(`\r${prefix}${view.padEnd(window, " ")}`);
    };

    const end = () => {
        // Move to next line after streaming.
        process.stdout.write("\n");
    };

    return { write, end };
}

function normalizePath(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

function createTokenizer(model: string): Tiktoken {
    // Best-effort mapping. If the exact model is unknown to js-tiktoken, fall back.
    try {
        return encodingForModel(model as any);
    } catch {
        // cl100k_base is the safest general-purpose fallback for many OpenAI chat models.
        return getEncoding("cl100k_base");
    }
}

function guessFenceLanguage(filePath: string): string {
    // A small, practical mapping for Markdown fenced code blocks.
    const lower = filePath.toLowerCase();
    if (lower.endsWith(".ts")) return "typescript";
    if (lower.endsWith(".tsx")) return "tsx";
    if (lower.endsWith(".js")) return "javascript";
    if (lower.endsWith(".jsx")) return "jsx";
    if (lower.endsWith(".py")) return "python";
    if (lower.endsWith(".go")) return "go";
    if (lower.endsWith(".rs")) return "rust";
    if (lower.endsWith(".java")) return "java";
    if (lower.endsWith(".kt") || lower.endsWith(".kts")) return "kotlin";
    if (lower.endsWith(".cs")) return "csharp";
    if (
        lower.endsWith(".c")
    )
        return "c";
    if (
        lower.endsWith(".cc") ||
        lower.endsWith(".cpp") ||
        lower.endsWith(".cxx") ||
        lower.endsWith(".h") ||
        lower.endsWith(".hpp")
    ) {
        return "cpp";
    }
    if (lower.endsWith(".json")) return "json";
    if (lower.endsWith(".yaml") || lower.endsWith(".yml")) return "yaml";
    if (lower.endsWith(".toml")) return "toml";
    if (lower.endsWith(".md")) return "markdown";

    return "";
}

function countTokens(encoder: Tiktoken, text: string): number {
    // `encode()` returns an array of token ids.
    return encoder.encode(text).length;
}

export const outlineTool: Tool = {
    name: "outline",
    description:
        "Generate a structured Markdown outline for a source file (types/globals/classes/structs/functions) via a dedicated LLM call.",
    parameters: {
        type: "object",
        properties: {
            path: { type: "string", description: "File path (absolute or relative)" },
        },
        required: ["path"],
        additionalProperties: false,
    },
    handler: async (args) => {
        const rawPath = normalizePath(args.path);
        if (!rawPath) return "Error: 'path' is required";

        const { readFile, stat } = await import("node:fs/promises");
        const pathMod = await import("node:path");

        const resolvedPath = pathMod.isAbsolute(rawPath) ? pathMod.normalize(rawPath) : pathMod.resolve(rawPath);

        let st: { isFile(): boolean };
        try {
            st = await stat(resolvedPath);
        } catch (err) {
            return `Error: failed to stat '${rawPath}' (resolved: ${resolvedPath}) - ${err instanceof Error ? err.message : String(err)}`;
        }
        if (!st.isFile()) return `Error: '${rawPath}' (resolved: ${resolvedPath}) is not a file`;

        let content: string;
        try {
            content = await readFile(resolvedPath, "utf8");
        } catch (err) {
            return `Error: failed to read '${rawPath}' (resolved: ${resolvedPath}) - ${err instanceof Error ? err.message : String(err)}`;
        }
        if (content.includes("\0")) return `Error: '${rawPath}' appears to be a binary file (NUL byte found)`;

        const apiKey = process.env.TOY_API_KEY;
        const baseURL = process.env.TOY_BASE_URL;
        const fastModel = process.env.TOY_FAST_MODEL?.trim();
        const model = fastModel || process.env.TOY_MODEL;

        if (!apiKey || !baseURL || !model) {
            return "Error: missing environment variables. Require TOY_API_KEY, TOY_BASE_URL, and (TOY_MODEL or TOY_FAST_MODEL).";
        }

        const fenceLang = guessFenceLanguage(rawPath);
        const userContent = `File: ${rawPath}\n\n\`\`\`${fenceLang}\n${content}\n\`\`\`\n`;

        let encoder: Tiktoken | null = null;
        try {
            encoder = createTokenizer(model);
            const tokens = countTokens(encoder, OUTLINE_SYSTEM_PROMPT) + countTokens(encoder, userContent);
            if (tokens > MAX_CONTEXT_TOKENS) {
                return `Error: input too large (${tokens} tokens) exceeds limit (${MAX_CONTEXT_TOKENS}).`;
            }
        } catch (err) {
            return `Error: token counting failed - ${err instanceof Error ? err.message : String(err)}`;
        } finally {
            try {
                const free = (encoder as any)?.free;
                if (typeof free === "function") free.call(encoder);
            } catch {
                // ignore
            }
        }

        try {
            const client = new OpenAI({ apiKey, baseURL });

            // Stream the LLM response and print it (including reasoning/CoT) as it arrives.
            // Note: The tool's returned value remains the *final outline content* (no reasoning),
            // but we still print the reasoning stream for observability.
            const stream: any = await client.chat.completions.create({
                model,
                messages: [
                    { role: "system", content: OUTLINE_SYSTEM_PROMPT },
                    { role: "user", content: userContent },
                ],
                temperature: 0.7,
                stream: true,
            } as any);

            let reasoning = "";
            let contentOut = "";

            const rolling = createRollingLineWriter({ prefix: "[outline stream] ", window: 80 });
            let emittedThinkingMarker = false;
            let emittedOutlineMarker = false;
            let wroteAnything = false;

            for await (const chunk of stream) {
                const delta = chunk?.choices?.[0]?.delta ?? {};

                const reasoningDelta: unknown =
                    (delta as any).reasoning_content ??
                    (delta as any).reasoning ??
                    (delta as any).thinking;
                if (typeof reasoningDelta === "string" && reasoningDelta.length) {
                    reasoning += reasoningDelta;
                    if (!emittedThinkingMarker) {
                        rolling.write("[T] ");
                        emittedThinkingMarker = true;
                    }
                    rolling.write(toOneLine(reasoningDelta));
                    wroteAnything = true;
                }

                const contentDelta: unknown = (delta as any).content;
                if (typeof contentDelta === "string" && contentDelta.length) {
                    contentOut += contentDelta;
                    if (!emittedOutlineMarker) {
                        rolling.write("[O] ");
                        emittedOutlineMarker = true;
                    }
                    rolling.write(toOneLine(contentDelta));
                    wroteAnything = true;
                }
            }

            if (wroteAnything) rolling.end();

            if (!contentOut.trim()) return "Error: no outline returned by the model";
            return contentOut.trim();
        } catch (err) {
            return `Error: outline LLM call failed - ${err instanceof Error ? err.message : String(err)}`;
        }
    },
};

