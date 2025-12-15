import { type Tool } from "./tool_system";
import { globby } from "globby";

export const lsTool: Tool = {
    name: "ls",
    description: "List directory entries. Supports optional depth-based traversal, entry limit, gitignore filtering, and hidden files.",
    parameters: {
        type: "object",
        properties: {
            path: { type: "string", description: "Directory path (default: .)" },
            depth: { type: "integer", description: "Maximum depth to traverse" },
            max_entries: { type: "integer", description: "Maximum number of entries to return (default: 100)" },
            gitignore: { type: "boolean", description: "Enable .gitignore file filtering (default: true)" },
            dot: { type: "boolean", description: "Enable hidden files traversal (default: false)" },
        },
        required: [],
        additionalProperties: false,
    },
    handler: async (args) => {
        const pathMod = await import("node:path");
        const { stat } = await import("node:fs/promises");

        const root = typeof args.path === "string" && args.path.trim() ? args.path.trim() : ".";
        const depth = Number.isInteger(args.depth) ? Math.max(1, Number(args.depth)) : 1;
        const maxEntries = Number.isInteger(args.max_entries) ? Number(args.max_entries) : 100;
        const limit = Math.max(1, Math.min(2000, maxEntries));
        const gitignore = typeof args.gitignore === "boolean" ? args.gitignore : true;
        const dot = typeof args.dot === "boolean" ? args.dot : false;

        try {
            // 构建 globby 的 glob 模式
            const globPattern = depth === 0 ? "*" : `**/*`;
            const fullPattern = pathMod.join(root, globPattern);

            // 使用 globby 获取文件列表
            const entries = await globby(fullPattern, {
                gitignore,
                dot,
                deep: depth === 0 ? 0 : depth,
                onlyFiles: false,
                markDirectories: false,
                stats: false,
            });

            // 限制返回的条目数量
            const limitedEntries = entries.slice(0, limit);

            // 格式化输出，保持相对于 root 的路径，并标记目录
            const out: string[] = [];
            for (const entry of limitedEntries) {
                const relativePath = pathMod.relative(root, entry);
                // 检查是否为目录
                try {
                    const stats = await stat(entry);
                    const label = stats.isDirectory() ? `${relativePath}/` : relativePath;
                    out.push(label);
                } catch {
                    // 如果无法获取状态，直接使用路径
                    out.push(relativePath);
                }
            }

            // 按路径排序以获得更好的可读性
            out.sort();

            const header = `ls ${root} (depth ${depth}, showing ${out.length}/${entries.length})`;
            const result = [header, ...out];
            
            // 如果条目数量超出限制，添加提示信息
            if (entries.length > limit) {
                result.push("...");
                result.push("[WARN] Too many entries! Consider using depth=1 and progressively explore subdirectories as needed.");
            }
            
            return result.join("\n");
        } catch (err) {
            return `Error: failed to list '${root}' - ${err instanceof Error ? err.message : String(err)}`;
        }
    },
};
