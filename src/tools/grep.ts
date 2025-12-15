import { type Tool } from "./tool_system";

function escapeRegexLiteral(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Very small glob matcher:
 * - `*` matches any chars except `/`
 * - `?` matches any single char except `/`
 * - `**` matches any chars including `/`
 *
 * We normalize candidate paths to forward-slash separators before matching.
 */
function globToRegExp(glob: string): RegExp {
    // Normalize the glob itself to forward slashes for consistent behavior.
    const g = glob.replace(/\\/g, "/");

    let re = "^";
    for (let i = 0; i < g.length; i++) {
        const ch = g[i]!;
        if (ch === "*") {
            const next = g[i + 1];
            if (next === "*") {
                // `**`
                re += ".*";
                i++;
                continue;
            }
            // `*`
            re += "[^/]*";
            continue;
        }
        if (ch === "?") {
            re += "[^/]";
            continue;
        }
        // Escape regexp specials.
        re += escapeRegexLiteral(ch);
    }
    re += "$";
    return new RegExp(re);
}

function parseGlobList(value: unknown): string[] {
    if (typeof value !== "string") return [];
    // Allow comma/semicolon separated lists.
    return value
        .split(/[;,]/g)
        .map((s) => s.trim())
        .filter(Boolean);
}

export const grepTool: Tool = {
    name: "grep",
    description:
        "Search files under a path for a pattern (regex by default). Supports recursive search, grouped output, line numbers, include/exclude glob filters, max output limit, and optional line filter.",
    parameters: {
        type: "object",
        properties: {
            path: { type: "string", description: "File or directory path (default: .)" },
            pattern: { type: "string", description: "Search pattern (regex by default)" },
            recursive: { type: "boolean", description: "Recursively search subdirectories (default: true)" },
            regex: { type: "boolean", description: "Treat pattern as RegExp (default: true)" },
            ignore_case: { type: "boolean", description: "Case-insensitive matching (default: false)" },
            include_glob: {
                type: "string",
                description:
                    "Only search files whose relative path matches this glob (comma/semicolon-separated supported). Example: **/*.ts",
            },
            exclude_glob: {
                type: "string",
                description:
                    "Skip files whose relative path matches this glob (comma/semicolon-separated supported). Example: **/*.test.ts",
            },
            max_output_lines: {
                type: "integer",
                description: "Maximum number of matching lines to return (default: 200, max: 5000)",
            },
            filter: {
                type: "string",
                description: "Optional secondary filter applied to matching lines (regex)",
            },
            filter_ignore_case: {
                type: "boolean",
                description: "Case-insensitive matching for filter regex (default: false)",
            },
            max_file_size_bytes: {
                type: "integer",
                description: "Skip files larger than this size (default: 1000000)",
            },
        },
        required: ["pattern"],
        additionalProperties: false,
    },
    handler: async (args) => {
        const { readdir, readFile, stat } = await import("node:fs/promises");
        const pathMod = await import("node:path");

        const rawPath = typeof args.path === "string" && args.path.trim() ? args.path.trim() : ".";
        const patternRaw = typeof args.pattern === "string" ? args.pattern : "";
        if (!patternRaw.trim()) return "Error: 'pattern' is required";

        const resolvedPath = pathMod.isAbsolute(rawPath) ? pathMod.normalize(rawPath) : pathMod.resolve(rawPath);

        let rootStat: Awaited<ReturnType<typeof stat>>;
        try {
            rootStat = await stat(resolvedPath);
        } catch (err) {
            return `Error: failed to stat '${rawPath}' (resolved: ${resolvedPath}) - ${err instanceof Error ? err.message : String(err)}`;
        }

        const recursive = args.recursive == null ? true : Boolean(args.recursive);
        const regexMode = args.regex == null ? true : Boolean(args.regex);
        const ignoreCase = Boolean(args.ignore_case);
        const filterIgnoreCase = Boolean(args.filter_ignore_case);

        const maxOutputRaw = Number.isInteger(args.max_output_lines) ? Number(args.max_output_lines) : 200;
        const maxOutput = Math.max(1, Math.min(5000, maxOutputRaw));

        const maxFileSizeRaw = Number.isInteger(args.max_file_size_bytes) ? Number(args.max_file_size_bytes) : 1_000_000;
        const maxFileSize = Math.max(1_000, Math.min(50_000_000, maxFileSizeRaw));

        const includeGlobs = parseGlobList(args.include_glob);
        const excludeGlobs = parseGlobList(args.exclude_glob);

        const includeMatchers = includeGlobs.length ? includeGlobs.map(globToRegExp) : null;
        const excludeMatchers = excludeGlobs.length ? excludeGlobs.map(globToRegExp) : null;

        const defaultExcludedDirs = new Set([".git", "node_modules"]);

        let mainRegex: RegExp | null = null;
        let filterRegex: RegExp | null = null;
        try {
            if (regexMode) {
                mainRegex = new RegExp(patternRaw, ignoreCase ? "i" : "");
            }
            if (typeof args.filter === "string" && args.filter.trim()) {
                filterRegex = new RegExp(args.filter, filterIgnoreCase ? "i" : "");
            }
        } catch (err) {
            return `Error: invalid regex - ${err instanceof Error ? err.message : String(err)}`;
        }

        function matchLine(line: string): boolean {
            let ok: boolean;
            if (mainRegex) {
                ok = mainRegex.test(line);
            } else {
                if (ignoreCase) ok = line.toLowerCase().includes(patternRaw.toLowerCase());
                else ok = line.includes(patternRaw);
            }
            if (!ok) return false;
            if (filterRegex) return filterRegex.test(line);
            return true;
        }

        const rootDir = rootStat.isDirectory() ? resolvedPath : pathMod.dirname(resolvedPath);

        function toRel(absFile: string): string {
            const rel = pathMod.relative(rootDir, absFile);
            // Normalize for globs and output stability.
            return rel.replace(/\\/g, "/");
        }

        function shouldInclude(rel: string): boolean {
            const candidate = rel.replace(/\\/g, "/");
            if (excludeMatchers && excludeMatchers.some((r) => r.test(candidate))) return false;
            if (includeMatchers && !includeMatchers.some((r) => r.test(candidate))) return false;
            return true;
        }

        type FileMatch = { relPath: string; matches: Array<{ lineNo: number; text: string }> };
        const results: FileMatch[] = [];
        const indexByRel = new Map<string, FileMatch>();

        let filesScanned = 0;
        let filesSkipped = 0;
        let outputLines = 0;
        let truncated = false;

        function recordMatch(relPath: string, lineNo: number, text: string) {
            let fm = indexByRel.get(relPath);
            if (!fm) {
                fm = { relPath, matches: [] };
                indexByRel.set(relPath, fm);
                results.push(fm);
            }
            fm.matches.push({ lineNo, text });
        }

        async function scanFile(absFile: string): Promise<void> {
            if (truncated) return;

            const rel = toRel(absFile);
            if (!shouldInclude(rel)) {
                filesSkipped++;
                return;
            }

            let st: Awaited<ReturnType<typeof stat>>;
            try {
                st = await stat(absFile);
            } catch {
                filesSkipped++;
                return;
            }
            if (!st.isFile()) {
                filesSkipped++;
                return;
            }
            if (st.size > maxFileSize) {
                filesSkipped++;
                return;
            }

            let buf: Buffer;
            try {
                buf = await readFile(absFile);
            } catch {
                filesSkipped++;
                return;
            }

            // Skip likely-binary files.
            if (buf.includes(0)) {
                filesSkipped++;
                return;
            }

            filesScanned++;

            const text = buf.toString("utf8");
            const lines = text.split(/\r?\n/);
            for (let i = 0; i < lines.length; i++) {
                if (outputLines >= maxOutput) {
                    truncated = true;
                    return;
                }
                const line = lines[i] ?? "";
                if (matchLine(line)) {
                    recordMatch(rel, i + 1, line);
                    outputLines++;
                }
            }
        }

        async function walkDir(dir: string): Promise<void> {
            if (truncated) return;
            let entries: any;
            try {
                // Ensure `Dirent.name` is string (not Buffer) across runtimes.
                entries = await readdir(dir, { withFileTypes: true, encoding: "utf8" } as any);
            } catch {
                return;
            }

            for (const e of entries) {
                if (truncated) return;

                const name = String(e.name);
                const abs = pathMod.join(dir, name);
                if (e.isDirectory()) {
                    if (!recursive) continue;
                    if (defaultExcludedDirs.has(name) && !includeGlobs.some((g) => g.includes(name))) {
                        // Default skip large dirs unless user explicitly includes them in include_glob.
                        continue;
                    }
                    await walkDir(abs);
                    continue;
                }
                if (e.isFile()) {
                    await scanFile(abs);
                }
            }
        }

        if (rootStat.isFile()) {
            await scanFile(resolvedPath);
        } else if (rootStat.isDirectory()) {
            await walkDir(resolvedPath);
        } else {
            return `Error: '${rawPath}' (resolved: ${resolvedPath}) is neither a file nor a directory`;
        }

        const headerParts = [
            `grep ${patternRaw}`,
            `path=${rawPath}`,
            `recursive=${recursive}`,
            `regex=${regexMode}`,
            `ignore_case=${ignoreCase}`,
            includeGlobs.length ? `include_glob=${includeGlobs.join(",")}` : null,
            excludeGlobs.length ? `exclude_glob=${excludeGlobs.join(",")}` : null,
            typeof args.filter === "string" && args.filter.trim() ? `filter=${args.filter}` : null,
            `shown_lines=${outputLines}/${maxOutput}`,
            truncated ? "truncated=true" : "truncated=false",
        ].filter(Boolean);

        const out: string[] = [headerParts.join(" | ")];

        if (results.length === 0) {
            out.push("(no matches)");
        } else {
            for (const fm of results) {
                out.push("");
                out.push(`==> ${fm.relPath} <== (${fm.matches.length} matches)`);
                for (const m of fm.matches) {
                    out.push(`${String(m.lineNo).padStart(6, " ")} | ${m.text}`);
                }
            }
        }

        out.push("");
        out.push(
            `summary: files_scanned=${filesScanned}, files_with_matches=${results.length}, files_skipped=${filesSkipped}, matches_shown=${outputLines}${truncated ? ", NOTE: output truncated" : ""}`
        );

        return out.join("\n");
    },
};

