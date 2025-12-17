import { type Tool } from "./tool_system";
import type { ChatContext } from "../chat_runner";
import { globby } from "globby";
import * as pathMod from "node:path";
import * as fs from "node:fs/promises";

function escapeRegex(string: string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const grepTool: Tool<ChatContext> = {
    name: "grep",
    description: "Search for patterns in files. Supports regex, gitignore, context lines, and searching specific files or directories.",
    parameters: {
        type: "object",
        properties: {
            pattern: { type: "string", description: "Regex pattern or string to search for" },
            path: { type: "string", description: "File or directory path to search in (default: .)" },
            include: { type: "string", description: "Glob pattern to include files (e.g. '**/*.ts'). Only used if path is a directory." },
            ignore_case: { type: "boolean", description: "Case insensitive search (default: false)" },
            context_lines: { type: "integer", description: "Number of context lines to show before and after match (default: 0)" },
            max_files: { type: "integer", description: "Max number of files to return matches for (default: 50)" },
        },
        required: ["pattern"],
        additionalProperties: false,
    },
    handler: async (_ctx, args) => {
        const patternRaw = args.pattern;
        if (!patternRaw) return "Error: pattern is required";

        const inputPath = args.path ? args.path.trim() : ".";
        const ignoreCase = !!args.ignore_case;
        const contextLines = typeof args.context_lines === 'number' ? Math.max(0, Math.min(10, args.context_lines)) : 0;
        const maxFiles = args.max_files || 50;

        try {
            // 1. 准备正则
            let regex: RegExp;
            try {
                regex = new RegExp(patternRaw, ignoreCase ? "im" : "m");
            } catch {
                regex = new RegExp(escapeRegex(patternRaw), ignoreCase ? "im" : "m");
            }

            const inputAbs = pathMod.resolve(inputPath);
            let searchCwd: string;
            let searchPatterns: string[];

            // 2. 智能判断 path 是文件还是目录
            try {
                const stats = await fs.stat(inputAbs);

                if (stats.isFile()) {
                    // 情况 A: 用户指定了特定文件 (grep path="src/index.ts")
                    searchCwd = pathMod.dirname(inputAbs);
                    searchPatterns = [pathMod.basename(inputAbs)];
                } else if (stats.isDirectory()) {
                    // 情况 B: 用户指定了目录 (grep path="src")
                    searchCwd = inputAbs;
                    searchPatterns = [args.include ? args.include : "**"];
                } else {
                    return `Error: path '${inputPath}' is neither a file nor a directory.`;
                }
            } catch (err) {
                return `Error: cannot access path '${inputPath}'. It may not exist.`;
            }

            // 3. 使用 globby 查找
            // 注意：如果指定了单文件，我们仍然使用 globby，这样可以统一处理 gitignore 逻辑
            const files = await globby(searchPatterns, {
                cwd: searchCwd,
                gitignore: true, // 依然尊重 gitignore，哪怕是单文件。如果文件被忽略，将不会被搜到，这通常是正确的行为。
                dot: false,
                onlyFiles: true,
                absolute: true,
            });

            const results: string[] = [];
            let filesWithMatches = 0;

            for (const fileAbs of files) {
                if (filesWithMatches >= maxFiles) break;

                try {
                    // 再次检查文件大小
                    const stats = await fs.stat(fileAbs);
                    if (stats.size > 1_000_000) continue;

                    const content = await fs.readFile(fileAbs, "utf-8");
                    if (content.includes('\0')) continue;

                    const lines = content.split(/\r?\n/);
                    const fileMatches: string[] = [];

                    for (let i = 0; i < lines.length; i++) {
                        const line = lines[i];
                        if (line && regex.test(line)) {
                            // 获取上下文
                            const start = Math.max(0, i - contextLines);
                            const end = Math.min(lines.length - 1, i + contextLines);

                            const matchBlock: string[] = [];
                            for (let j = start; j <= end; j++) {
                                const prefix = j === i ? ">" : " ";
                                matchBlock.push(`${String(j + 1).padStart(4)} | ${lines[j]}`);
                            }

                            fileMatches.push(matchBlock.join("\n"));
                            i = end;
                        }
                    }

                    if (fileMatches.length > 0) {
                        filesWithMatches++;
                        // 返回相对于原始 inputPath 的路径，或者相对于 CWD 的路径，这里统一用相对于 CWD 更清晰
                        const relPath = pathMod.relative(process.cwd(), fileAbs).replace(/\\/g, "/");
                        results.push(`file: ${relPath}\n${fileMatches.join("\n---\n")}`);
                    }

                } catch (err) {
                    continue;
                }
            }

            if (results.length === 0) {
                return "No matches found.";
            }

            const header = `Found matches in ${filesWithMatches} files (showing top ${maxFiles}):`;
            return [header, ...results].join("\n\n");

        } catch (err) {
            return `Grep failed: ${err instanceof Error ? err.message : String(err)}`;
        }
    },
};
