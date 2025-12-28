import OpenAI from "openai";
import { encodingForModel, getEncoding, type Tiktoken } from "js-tiktoken";
import { type Tool } from "./tool_system";
import type { ChatContext } from "../chat_runner";
import { createOutlineCache } from "./outline_cache";

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

export const outlineTool: Tool<ChatContext> = {
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
    handler: async (ctx, args) => {
        const rawPath = normalizePath(args.path);
        if (!rawPath) return "Error: 'path' is required";

        const { readFile, stat } = await import("node:fs/promises");
        const pathMod = await import("node:path");

        const resolvedPath = pathMod.isAbsolute(rawPath) ? pathMod.normalize(rawPath) : pathMod.resolve(rawPath);
        const relativePath = pathMod.relative(process.cwd(), resolvedPath);

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

        const cache = createOutlineCache();
        const cached = await cache.get(relativePath, content);
        if (cached) return cached;

        const fastModel = ctx.fastModel?.trim();
        const model = fastModel || ctx.model;
        if (!model) {
            return "Error: missing model for outline tool. Ensure TOY_FAST_MODEL or the main model is configured.";
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
            const client = ctx.client;

            const stream: any = await client.chat.completions.create({
                model,
                messages: [
                    { role: "system", content: OUTLINE_SYSTEM_PROMPT },
                    { role: "user", content: userContent },
                ],
                temperature: 0.7,
                stream: true,
                thinking: { type: "disabled" }
            } as any);

            const { content: contentOut } = await ctx.ui.previewStream("outline stream", stream);

            if (!contentOut.trim()) return "Error: no outline returned by the model";
            const out = contentOut.trim();
            await cache.set(relativePath, content, out);
            return out;
        } catch (err) {
            return `Error: outline LLM call failed - ${err instanceof Error ? err.message : String(err)}`;
        }
    },
};
