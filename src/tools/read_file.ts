import { type Tool } from "./tool_system";

export const readFileTool: Tool = {
    name: "read_file",
    description: "Read a text file. Supports absolute/relative path. Optionally specify start_line (1-based) and line_count.",
    parameters: {
        type: "object",
        properties: {
            path: { type: "string", description: "File path (absolute or relative)" },
            start_line: { type: "integer", description: "Start line number (1-based)" },
            line_count: { type: "integer", description: "Number of lines to read" },
        },
        required: ["path"],
        additionalProperties: false,
    },
    handler: async (args) => {
        const { readFile, stat } = await import("node:fs/promises");
        const pathMod = await import("node:path");

        const rawPath = typeof args.path === "string" ? args.path.trim() : "";
        if (!rawPath) return "Error: 'path' is required";

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

        const lines = content.split(/\r?\n/);
        const totalLines = lines.length;
        const wantsRange = args.start_line != null || args.line_count != null;
        if (!wantsRange) {
            // Guardrail for very large files.
            if (totalLines > 500 || content.length > 100_000) {
                return (
                    `Error: file is too large to read entirely (lines=${totalLines}, chars=${content.length}). ` +
                    `Specify 'start_line' and 'line_count'.`
                );
            }
        }

        const startLineRaw = Number.isInteger(args.start_line) ? Number(args.start_line) : 1;
        const startLine = Math.max(1, startLineRaw);

        const lineCountRaw = Number.isInteger(args.line_count) ? Number(args.line_count) : undefined;
        const lineCount = lineCountRaw == null ? undefined : Math.max(1, lineCountRaw);

        if (startLine > totalLines) {
            return `Error: start_line (${startLine}) is beyond EOF (total lines: ${totalLines})`;
        }

        const endLine = Math.min(totalLines, lineCount ? startLine + lineCount - 1 : totalLines);
        const slice = lines.slice(startLine - 1, endLine);

        const width = String(endLine).length;
        const body = slice
            .map((line, idx) => {
                const n = String(startLine + idx).padStart(width, " ");
                return `${n} | ${line}`;
            })
            .join("\n");

        const header = `read_file ${rawPath} (resolved: ${resolvedPath}) lines ${startLine}-${endLine} of ${totalLines}`;
        return [header, body].join("\n");
    },
};

