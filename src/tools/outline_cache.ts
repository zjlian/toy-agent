import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export type OutlineCache = {
    get(relativePath: string, content: string): Promise<string | null>;
    set(relativePath: string, content: string, outline: string): Promise<void>;
};

const CACHE_DIR = resolve(process.cwd(), ".toyagent", "cache", "outline");

function sha256Hex(text: string): string {
    return createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
}

function md5Hex(text: string): string {
    return createHash("md5").update(Buffer.from(text, "utf8")).digest("hex");
}

function cachePathForKey(key: string): string {
    return join(CACHE_DIR, `${key}.cache`);
}

async function ensureCacheDir(): Promise<void> {
    await mkdir(CACHE_DIR, { recursive: true });
}

async function fileExists(path: string): Promise<boolean> {
    try {
        const st = await stat(path);
        return st.isFile();
    } catch {
        return false;
    }
}

async function bestEffortUnlink(path: string): Promise<void> {
    try {
        await unlink(path);
    } catch {
        // ignore
    }
}

async function atomicWriteText(targetPath: string, text: string): Promise<void> {
    // Write temp file then rename over (best effort, last-write-wins).
    const tmpPath = `${targetPath}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`;
    try {
        await writeFile(tmpPath, text, "utf8");
        await rename(tmpPath, targetPath);
    } catch (err) {
        // Try to clean up temp file, but never throw from cache writing.
        await bestEffortUnlink(tmpPath);
        throw err;
    }
}

export function createOutlineCache(): OutlineCache {
    return {
        async get(relativePath: string, content: string): Promise<string | null> {
            const key = md5Hex(relativePath);
            const p = cachePathForKey(key);

            try {
                if (!(await fileExists(p))) return null;
                const cached = await readFile(p, "utf8");
                const [firstLine, , ...rest] = cached.split(/\r?\n/);
                const expectedSha = firstLine?.trim();
                if (!expectedSha) return null;
                const actualSha = sha256Hex(content);
                if (expectedSha !== actualSha) return null;
                const out = rest.join("\n").trim();
                return out ? out : null;
            } catch {
                return null;
            }
        },

        async set(relativePath: string, content: string, outline: string): Promise<void> {
            const out = outline.trim();
            if (!out) return;

            const key = md5Hex(relativePath);
            const p = cachePathForKey(key);
            const payload = `${sha256Hex(content)}\n\n${out}\n`;

            try {
                await ensureCacheDir();
                await atomicWriteText(p, payload);
            } catch {
            }
        },
    };
}
