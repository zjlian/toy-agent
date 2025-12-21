import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir, platform } from "node:os";
import { randomUUID } from "node:crypto";
import { z } from "zod";

const rawProfileSchema = z.object({
    id: z.string().optional(),
    label: z.string().optional(),
    baseUrl: z.string().optional(),
    apiKey: z.string().optional(),
    model: z.string().optional(),
    fastModel: z.string().optional(),
});

const storedConfigSchema = z.object({
    version: z.number().optional(),
    activeProfileId: z.string().optional(),
    profiles: z.preprocess((value) => {
        if (Array.isArray(value)) return value;
        if (value && typeof value === "object") {
            return Object.values(value as Record<string, unknown>);
        }
        return [];
    }, z.array(rawProfileSchema)),
});

type RawStoredConfig = z.infer<typeof storedConfigSchema>;
type RawProviderProfile = z.infer<typeof rawProfileSchema>;

export type ProviderProfile = {
    id: string;
    label: string;
    baseUrl?: string;
    apiKey?: string;
    model?: string;
    fastModel?: string;
};

export interface StoredConfig {
    version: 1;
    activeProfileId?: string;
    profiles: ProviderProfile[];
}

export const DEFAULT_STORED_CONFIG: StoredConfig = {
    version: 1,
    profiles: [],
};

function cloneDefault(): StoredConfig {
    return { version: 1, profiles: [] };
}

function resolveConfigDirectory(): string {
    const home = homedir();
    const platformName = platform();

    if (platformName === "win32") {
        const appData = process.env.APPDATA;
        if (appData && appData.trim().length > 0) {
            return join(appData, "toy-agent");
        }
        return join(home, "AppData", "Roaming", "toy-agent");
    }

    if (platformName === "darwin") {
        return join(home, "Library", "Application Support", "toy-agent");
    }

    const xdg = process.env.XDG_CONFIG_HOME?.trim();
    if (xdg && xdg.length > 0) {
        return join(xdg, "toy-agent");
    }
    return join(home, ".config", "toy-agent");
}

function trimOrUndefined(value?: string | null): string | undefined {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeStoredConfig(raw: RawStoredConfig): StoredConfig {
    const unique = new Set<string>();
    const profiles = (raw.profiles ?? []).map((profile) => {
        const normalized: ProviderProfile = {
            id: trimOrUndefined(profile.id) || randomUUID(),
            label: trimOrUndefined(profile.label) || trimOrUndefined(profile.id) || randomUUID(),
            baseUrl: trimOrUndefined(profile.baseUrl),
            apiKey: trimOrUndefined(profile.apiKey),
            model: trimOrUndefined(profile.model),
            fastModel: trimOrUndefined(profile.fastModel),
        };
        if (unique.has(normalized.id)) {
            throw new Error(`Duplicate profile id detected in config file: ${normalized.id}`);
        }
        unique.add(normalized.id);
        return normalized;
    });

    const activeProfileId = trimOrUndefined(raw.activeProfileId);
    const fixedActive = activeProfileId && profiles.some((p) => p.id === activeProfileId) ? activeProfileId : undefined;

    return {
        version: 1,
        activeProfileId: fixedActive,
        profiles,
    };
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
    const dir = dirname(filePath);
    await mkdir(dir, { recursive: true });
    const tmpPath = join(dir, `.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    await writeFile(tmpPath, content, "utf8");
    await rename(tmpPath, filePath);
}

export class ConfigStore {
    private readonly filePath: string;

    constructor(filePath?: string) {
        this.filePath = filePath ?? join(resolveConfigDirectory(), "config.json");
    }

    getFilePath(): string {
        return this.filePath;
    }

    async load(): Promise<StoredConfig> {
        try {
            const raw = await readFile(this.filePath, "utf8");
            const json = JSON.parse(raw);
            const parsed: RawStoredConfig = storedConfigSchema.parse(json);
            return normalizeStoredConfig(parsed);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                return cloneDefault();
            }
            if (error instanceof SyntaxError) {
                throw new Error(`Failed to parse config file at ${this.filePath}: ${error.message}`);
            }
            throw error;
        }
    }

    async save(config: StoredConfig): Promise<void> {
        const parsed: RawStoredConfig = storedConfigSchema.parse(config);
        const normalized = normalizeStoredConfig(parsed);
        const payload = `${JSON.stringify(normalized, null, 2)}\n`;
        await atomicWrite(this.filePath, payload);
    }
}

