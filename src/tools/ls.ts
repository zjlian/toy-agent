import { type Tool } from "./tool_system";

export const lsTool: Tool = {
    name: "ls",
    description: "List directory entries. Supports optional recursion and entry limit.",
    parameters: {
        type: "object",
        properties: {
            path: { type: "string", description: "Directory path (default: .)" },
            recursive: { type: "boolean", description: "Recursively list subdirectories (default: false)" },
            max_entries: { type: "integer", description: "Maximum number of entries to return (default: 200)" },
        },
        required: [],
        additionalProperties: false,
    },
    handler: async (args) => {
        const { readdir } = await import("node:fs/promises");
        const pathMod = await import("node:path");

        const root = typeof args.path === "string" && args.path.trim() ? args.path.trim() : ".";
        const recursive = Boolean(args.recursive);
        const maxEntries = Number.isInteger(args.max_entries) ? Number(args.max_entries) : 200;
        const limit = Math.max(1, Math.min(2000, maxEntries));

        const out: string[] = [];
        let count = 0;

        async function walk(dir: string, prefix: string) {
            const entries = await readdir(dir, { withFileTypes: true });
            for (const e of entries) {
                if (count >= limit) return;
                const label = e.isDirectory() ? `${e.name}/` : e.name;
                out.push(prefix + label);
                count++;
                if (recursive && e.isDirectory()) {
                    const child = pathMod.join(dir, e.name);
                    await walk(child, prefix + "  ");
                    if (count >= limit) return;
                }
            }
        }

        try {
            await walk(root, "");
            const header = `ls ${root}${recursive ? " --recursive" : ""} (showing ${out.length}/${limit})`;
            return [header, ...out].join("\n");
        } catch (err) {
            return `Error: failed to list '${root}' - ${err instanceof Error ? err.message : String(err)}`;
        }
    },
};

