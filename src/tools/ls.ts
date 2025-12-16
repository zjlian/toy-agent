import { type Tool } from "./tool_system";
import { globby } from "globby";
import * as pathMod from "node:path";

export const lsTool: Tool = {
    name: "ls",
    description: "List directory entries. Supports optional depth-based traversal, entry limit, gitignore filtering, and hidden files.",
    parameters: {
        type: "object",
        properties: {
            path: { type: "string", description: "Directory path (default: .)" },
            depth: { type: "integer", description: "Maximum depth to traverse (1 means direct children only)" },
            max_entries: { type: "integer", description: "Maximum number of entries to return (default: 100)" },
            gitignore: { type: "boolean", description: "Enable .gitignore file filtering (default: true)" },
            dot: { type: "boolean", description: "Enable hidden files traversal (default: false)" },
        },
        required: [],
        additionalProperties: false,
    },
    handler: async (args) => {
        const root = typeof args.path === "string" && args.path.trim() ? args.path.trim() : ".";

        // 参数归一化
        // depth=1: 仅当前目录; depth>1: 递归; 
        const depthRaw = Number.isInteger(args.depth) ? Number(args.depth) : 1;
        // fast-glob 的 deep 选项: 1 表示只看当前层级 (如果是 ** 模式)，或者指定递归层数
        // 注意：globby 的 deep 默认可能是 Infinity，这里我们需要显式控制
        const depth = Math.max(1, Math.min(50, depthRaw));

        const maxEntries = Number.isInteger(args.max_entries) ? Number(args.max_entries) : 100;
        const limit = Math.max(1, Math.min(2000, maxEntries));
        const gitignore = typeof args.gitignore === "boolean" ? args.gitignore : true;
        const dot = typeof args.dot === "boolean" ? args.dot : false;

        try {
            const rootAbs = pathMod.resolve(root);

            // '**' 匹配所有文件/目录，deep 控制遍历深度
            // 在 windows 下，cwd 处理绝对路径，pattern 保持 POSIX 风格
            const patterns = ["**"];

            const entries = await globby(patterns, {
                cwd: rootAbs,
                gitignore,
                dot,
                deep: depth, // 直接使用 globby 的深度控制
                onlyFiles: false, // 同时返回文件和目录
                markDirectories: true, // 优化 2: 自动给目录追加 '/'，无需手动 stat
                stats: false, // 不需要详细 stat 信息，节省性能
                unique: true,
                followSymbolicLinks: false, // 通常建议 false 以防死循环，视需求而定
                absolute: false, // 返回相对路径
            });

            // 排序 (让同目录下的文件聚在一起)
            entries.sort();

            // 截断
            const limitedEntries = entries.slice(0, limit);

            // 格式化输出
            // 不需要再做 path.join，直接显示相对于查询目录的路径对 Agent 更友好
            const header = `ls ${root} (depth=${depth}, showing ${limitedEntries.length}/${entries.length} items)`;
            const result = [header, ...limitedEntries];

            if (entries.length > limit) {
                result.push("...");
                result.push(`[WARN] Output truncated. Total entries: ${entries.length}. Narrow your search or decrease depth.`);
            }

            return result.join("\n");
        } catch (err) {
            return `Error: failed to list '${root}' - ${err instanceof Error ? err.message : String(err)}`;
        }
    },
};
