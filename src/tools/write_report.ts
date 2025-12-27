import { type Tool } from "./tool_system";
import type { ChatContext } from "../chat_runner";
import { mkdir, writeFile } from "node:fs/promises";
import * as pathMod from "node:path";

function normalizeNonEmptyString(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

function createSlug(input: string): string {
    const lower = input.toLowerCase();
    const slug = lower.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return slug || "report";
}

export const writeReportTool: Tool<ChatContext> = {
    name: "write_report",
    description:
        "将最终报告写入 Markdown 文件。仅用于输出面向用户的总结性文档。",
    parameters: {
        type: "object",
        properties: {
            title: { type: "string", description: "报告标题，将写入文件名和文档正文" },
            body: {
                type: "string",
                description: "报告正文，必须是 Markdown 格式内容（不含前置元数据）",
            },
        },
        required: ["title", "body"],
        additionalProperties: false,
    },
    handler: async (_ctx, args) => {
        const title = normalizeNonEmptyString(args.title);
        const body = normalizeNonEmptyString(args.body);

        if (!title) return "Error: 'title' is required";
        if (!body) return "Error: 'body' is required";

        const cwd = process.cwd();
        const dir = pathMod.resolve(cwd, ".toyagent", "docs");

        try {
            await mkdir(dir, { recursive: true });
        } catch (err) {
            return `Error: failed to ensure report directory '${dir}' - ${
                err instanceof Error ? err.message : String(err)
            }`;
        }

        const slug = createSlug(title);
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const filename = `${timestamp}-${slug}.md`;
        const filepath = pathMod.join(dir, filename);

        const lines = [`# ${title}`, "", body];
        const content = lines.join("\n");

        try {
            await writeFile(filepath, content, "utf8");
        } catch (err) {
            return `Error: failed to write report file '${filepath}' - ${
                err instanceof Error ? err.message : String(err)
            }`;
        }

        const relativePath = pathMod.relative(cwd, filepath).replace(/\\/g, "/");
        return `Success: report written to '${relativePath}'`;
    },
};
