import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

/**
 * Outline file cache (project-local).
 *
 * Policy (as confirmed):
 * - key: sha256(file_content) only (ignore model/path)
 * - value: plain text outline only
 * - valid: cache file exists and is readable
 * - location: ./.toyagent/cache/outline/{sha256}.cache (relative to process.cwd())
 * - failure: best-effort; any read/write error should behave like cache-miss.
 */

export type OutlineCache = {
    get(content: string): Promise<string | null>;
    set(content: string, outline: string): Promise<void>;
};

const CACHE_DIR = resolve(process.cwd(), ".toyagent", "cache", "outline");

function sha256Hex(text: string): string {
    return createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
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
        async get(content: string): Promise<string | null> {
            const key = sha256Hex(content);
            const p = cachePathForKey(key);

            try {
                if (!(await fileExists(p))) return null;
                const cached = await readFile(p, "utf8");
                const out = cached.trim();
                return out ? out : null;
            } catch {
                // Treat any error as cache miss.
                return null;
            }
        },

        async set(content: string, outline: string): Promise<void> {
            const out = outline.trim();
            if (!out) return;

            const key = sha256Hex(content);
            const p = cachePathForKey(key);

            try {
                await ensureCacheDir();
                await atomicWriteText(p, out);
            } catch {
                // Best-effort: never fail the tool due to caching.
            }
        },
    };
}

