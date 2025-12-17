import * as readline from "node:readline";

export interface ChatUI {
    printBanner(meta?: { model?: string }): void;
    promptUser(): Promise<string>;
    printThinking(): void;
    printCoTContext(text: string | null): void;
    printAssistant(text: string): void;
    printToolCall(name: string, argText: string): void;
    printToolResult(name: string, output: string): void;
    printSystem(text: string): void;
    printError(text: string): void;
    previewStream(title: string, stream: AsyncIterable<any>): Promise<{ reasoning: string; content: string }>;
    close(): void;
}

type TruncateOptions = { maxChars?: number; maxLines?: number };

export class CliUI implements ChatUI {
    private readonly rl: readline.Interface;
    private readonly supportsColor = Boolean(process.stdout.isTTY);

    constructor() {
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            terminal: true,
        });
    }

    printBanner(meta?: { model?: string }) {
        const model = meta?.model ? `  model=${meta.model}` : "";
        console.log(this.bold(this.c(ANSI.cyan, "Toy Agent CLI")) + this.dim(model));
        console.log(this.dim("Type / for help.  /clear to reset context.  /tools to list tools.  /exit to quit."));
        console.log();
    }

    async promptUser(): Promise<string> {
        const prompt = this.bold(this.c(ANSI.blue, "You")) + this.dim(" › ");
        return new Promise<string>((resolve) => {
            this.rl.question(prompt, (answer) => resolve(answer.trim()));
        });
    }

    printThinking(): void {
        // Keep it subtle; avoids noisy “Thinking...” blocks.
        console.log(this.dim("…"));
    }

    printCoTContext(text: string | null): void {
        if (text !== null) {
            this.printBox("🤔", text, (s) => this.bold(this.c(ANSI.cyan, s)));
        }
    }

    printAssistant(text: string): void {
        this.printBox("AI", text, (s) => this.bold(this.c(ANSI.cyan, s)));
    }

    printToolCall(name: string, argText: string): void {
        const argsPreview = safeJsonPreview(argText);
        const label = this.bold(this.c(ANSI.yellow, `🔧 ${name}`));
        console.log(`${label} ${this.dim(argsPreview)}`);
        console.log();
    }

    printToolResult(name: string, output: string): void {
        const { text, truncated } = truncateForDisplay(output);
        const suffix = truncated ? `\n${this.dim("(truncated)")}` : "";
        this.printBox(`Tool result: ${name}`, text + suffix, (s) => this.bold(this.c(ANSI.green, s)));
    }

    printSystem(text: string): void {
        this.printBox("System", text, (s) => this.bold(this.c(ANSI.magenta, s)));
    }

    printError(text: string): void {
        this.printBox("Error", text, (s) => this.bold(this.c(ANSI.red, s)));
    }

    async previewStream(title: string, stream: AsyncIterable<any>): Promise<{ reasoning: string; content: string }> {
        const prefix = `[${title}] `;
        const window = 80;

        let buffer = "";
        let pendingLine = "";
        let reasoning = "";
        let content = "";
        let emittedThinkingMarker = false;
        let emittedOutlineMarker = false;

        const flushLine = (line: string) => {
            const cols = typeof process.stdout.columns === "number" && process.stdout.columns > 0 ? process.stdout.columns : window;
            const maxTextWidth = Math.max(10, cols - prefix.length);
            const text = previewToOneLine(line);
            const truncated = sliceToDisplayWidth(text, maxTextWidth);
            const padLen = Math.max(0, maxTextWidth - stringDisplayWidth(truncated));
            const padded = truncated + " ".repeat(padLen);
            process.stdout.write(`\x1b[2K\r${prefix}${padded}`);
        };

        for await (const chunk of stream as any) {
            const delta = (chunk as any)?.choices?.[0]?.delta ?? {};

            const reasoningDelta: unknown =
                (delta as any).reasoning_content ??
                (delta as any).reasoning ??
                (delta as any).thinking;
            if (typeof reasoningDelta === "string" && reasoningDelta.length) {
                reasoning += reasoningDelta;
                if (!emittedThinkingMarker) {
                    pendingLine += "[T] ";
                    emittedThinkingMarker = true;
                }
                buffer += reasoningDelta;
            }

            const contentDelta: unknown = (delta as any).content;
            if (typeof contentDelta === "string" && contentDelta.length) {
                content += contentDelta;
                if (!emittedOutlineMarker) {
                    pendingLine += "[O] ";
                    emittedOutlineMarker = true;
                }
                buffer += contentDelta;
            }

            while (true) {
                const idx = buffer.indexOf("\n");
                if (idx === -1) break;
                pendingLine += buffer.slice(0, idx);
                buffer = buffer.slice(idx + 1);
                if (pendingLine) {
                    flushLine(pendingLine);
                    pendingLine = "";
                }
            }
        }

        if (buffer || pendingLine) {
            pendingLine += buffer;
            if (pendingLine) {
                flushLine(pendingLine);
            }
        }
        process.stdout.write("\n\n");

        return { reasoning, content };
    }

    close(): void {
        this.rl.close();
    }

    // -------------------------
    // rendering internals
    // -------------------------

    private c(code: string, text: string): string {
        return this.supportsColor ? `${code}${text}${ANSI.reset}` : text;
    }

    private dim(text: string): string {
        return this.c(ANSI.dim, text);
    }

    private bold(text: string): string {
        return this.c(ANSI.bold, text);
    }

    private wrapLines(text: string, width: number, indent = ""): string[] {
        const maxWidth = Math.max(20, width - indent.length);
        const out: string[] = [];
        for (const rawLine of text.split(/\r?\n/)) {
            let line = rawLine;
            if (!line) {
                out.push(indent);
                continue;
            }
            while (line.length > maxWidth) {
                // Prefer breaking on whitespace.
                let cut = line.lastIndexOf(" ", maxWidth);
                if (cut < 10) cut = maxWidth;
                out.push(indent + line.slice(0, cut));
                line = line.slice(cut).trimStart();
            }
            out.push(indent + line);
        }
        return out;
    }

    private printBox(title: string, body: string, titleColor: (s: string) => string) {
        const columns = process.stdout.columns ?? 100;
        const border = (s: string) => this.dim(s);

        console.log(`${border("┌─")} ${titleColor(title)}`);
        const lines = this.wrapLines(body, columns - 4, "");
        for (const line of lines) console.log(`${border("│")} ${line}`);
        console.log(`${border("└─")}`);
        console.log();
    }
}

const ANSI = {
    reset: "\x1b[0m",
    bold: "\x1b[1m",
    dim: "\x1b[2m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    magenta: "\x1b[35m",
    cyan: "\x1b[36m",
} as const;

function safeJsonPreview(value: string): string {
    const trimmed = value?.trim() ?? "";
    if (!trimmed) return "{}";
    try {
        const obj = JSON.parse(trimmed);
        return JSON.stringify(obj);
    } catch {
        // Avoid flooding the screen for bad JSON.
        const preview = trimmed.length > 120 ? trimmed.slice(0, 120) + "…" : trimmed;
        return preview;
    }
}

function truncateForDisplay(text: string, options?: TruncateOptions): { text: string; truncated: boolean } {
    const maxChars = options?.maxChars ?? 1200;
    const maxLines = options?.maxLines ?? 30;

    const lines = text.split(/\r?\n/);
    let outLines = lines;
    let truncated = false;

    if (lines.length > maxLines) {
        outLines = lines.slice(0, maxLines);
        truncated = true;
    }

    let out = outLines.join("\n");
    if (out.length > maxChars) {
        out = out.slice(0, maxChars) + "…";
        truncated = true;
    }

    return { text: out, truncated };
}

function isCombining(codePoint: number): boolean {
    return (
        (codePoint >= 0x0300 && codePoint <= 0x036f) ||
        (codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
        (codePoint >= 0x1dc0 && codePoint <= 0x1dff) ||
        (codePoint >= 0x20d0 && codePoint <= 0x20ff) ||
        (codePoint >= 0xfe20 && codePoint <= 0xfe2f)
    );
}

function isFullwidth(codePoint: number): boolean {
    return (
        (codePoint >= 0x1100 && codePoint <= 0x115f) ||
        codePoint === 0x2329 ||
        codePoint === 0x232a ||
        (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
        (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
        (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
        (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
        (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
        (codePoint >= 0xff00 && codePoint <= 0xff60) ||
        (codePoint >= 0xffe0 && codePoint <= 0xffe6)
    );
}

function stringDisplayWidth(text: string): number {
    let width = 0;
    for (let i = 0; i < text.length; ) {
        const cp = text.codePointAt(i)!;
        i += cp > 0xffff ? 2 : 1;
        if (isCombining(cp)) continue;
        width += isFullwidth(cp) ? 2 : 1;
    }
    return width;
}

function sliceToDisplayWidth(text: string, maxWidth: number): string {
    let out = "";
    let width = 0;
    for (let i = 0; i < text.length; ) {
        const cp = text.codePointAt(i)!;
        const char = String.fromCodePoint(cp);
        const w = isCombining(cp) ? 0 : (isFullwidth(cp) ? 2 : 1);
        if (width + w > maxWidth) break;
        out += char;
        width += w;
        i += cp > 0xffff ? 2 : 1;
    }
    return out;
}

function previewToOneLine(text: string): string {
    return text.replace(/\r?\n/g, " ").replace(/\s+/g, " ");
}
