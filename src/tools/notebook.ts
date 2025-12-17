import { type Tool } from "./tool_system";
import type { ChatContext } from "../chat_runner";
import { Notebook } from "../notebook/notebook";

function normalizeNonEmptyString(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

function normalizeOptionalString(value: unknown): string | undefined {
    if (value == null) return undefined;
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
}

function normalizeTags(value: unknown): string[] | undefined {
    if (value == null) return undefined;
    if (!Array.isArray(value)) return undefined;
    const tags: string[] = [];
    for (const t of value) {
        if (typeof t !== "string") continue;
        const trimmed = t.trim();
        if (trimmed) tags.push(trimmed);
    }
    return tags;
}

function getNotebook(ctx: ChatContext): Notebook {
    const nb = (ctx as any).notebook;
    if (!nb || !(nb instanceof Notebook)) {
        throw new Error(
            "Notebook store is not initialized on ChatContext. Expected ctx.notebook to be a Notebook instance."
        );
    }
    return nb;
}

export const addNoteTool: Tool<ChatContext> = {
    name: "add_note",
    description: "Add a new note to Notebook (in-memory).",
    parameters: {
        type: "object",
        properties: {
            key: { type: "string", description: "Unique key (semantic id)" },
            title: { type: "string", description: "Short title" },
            content: { type: "string", description: "Note content" },
            tags: { type: "array", items: { type: "string" }, description: "Tags array" },
        },
        required: ["key", "title", "content"],
        additionalProperties: false,
    },
    handler: async (ctx, args) => {
        const key = normalizeNonEmptyString(args.key);
        const title = normalizeNonEmptyString(args.title);
        const content = normalizeNonEmptyString(args.content);
        const tags = normalizeTags(args.tags) ?? [];

        if (!key) return "Error: 'key' is required";
        if (!title) return "Error: 'title' is required";
        if (!content) return "Error: 'content' is required";

        const notebook = getNotebook(ctx);
        if (notebook.has(key)) {
            return `Error: Key '${key}' already exists. Use update_note to modify.`;
        }

        notebook.add({ key, title, content, tags });
        return `Success: Note '${key}' added.`;
    },
};

export const updateNoteTool: Tool<ChatContext> = {
    name: "update_note",
    description: "Update fields of an existing note (partial update).",
    parameters: {
        type: "object",
        properties: {
            key: { type: "string", description: "Target note key" },
            title: { type: "string", description: "New title" },
            content: { type: "string", description: "New content" },
            tags: {
                type: "array",
                items: { type: "string" },
                description: "New tags array (overwrites existing tags)",
            },
        },
        required: ["key"],
        additionalProperties: false,
    },
    handler: async (ctx, args) => {
        const key = normalizeNonEmptyString(args.key);
        if (!key) return "Error: 'key' is required";

        const title = normalizeOptionalString(args.title);
        const content = normalizeOptionalString(args.content);
        const tags = normalizeTags(args.tags);

        const notebook = getNotebook(ctx);
        if (!notebook.has(key)) {
            return `Error: Note with key '${key}' not found.`;
        }

        notebook.update(key, {
            ...(title != null ? { title } : null),
            ...(content != null ? { content } : null),
            ...(tags != null ? { tags } : null),
        });

        return `Success: Note '${key}' updated.`;
    },
};

export const deleteNoteTool: Tool<ChatContext> = {
    name: "delete_note",
    description: "Delete a note from Notebook.",
    parameters: {
        type: "object",
        properties: {
            key: { type: "string", description: "Target note key" },
        },
        required: ["key"],
        additionalProperties: false,
    },
    handler: async (ctx, args) => {
        const key = normalizeNonEmptyString(args.key);
        if (!key) return "Error: 'key' is required";

        const notebook = getNotebook(ctx);
        if (!notebook.has(key)) {
            return `Error: Note with key '${key}' not found.`;
        }

        notebook.delete(key);
        return `Success: Note '${key}' deleted.`;
    },
};
