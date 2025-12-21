import { ConfigStore, DEFAULT_STORED_CONFIG, type ProviderProfile, type StoredConfig } from "./config_store";

type ValueSource = "profile" | "env" | "missing";

export interface EffectiveConfig {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    fastModel?: string;
    sources: Record<"apiKey" | "baseUrl" | "model" | "fastModel", ValueSource>;
}

export interface ConfigSnapshot {
    stored: StoredConfig;
    activeProfile?: ProviderProfile;
    effective: EffectiveConfig;
}

export interface ReadyLLMConfig {
    apiKey: string;
    baseUrl: string;
    model: string;
    fastModel?: string;
}

type SnapshotListener = (snapshot: ConfigSnapshot) => void;

export class RuntimeConfigService {
    private readonly store: ConfigStore;
    private stored: StoredConfig = DEFAULT_STORED_CONFIG;
    private snapshot: ConfigSnapshot = this.buildSnapshot(this.stored);
    private readonly listeners = new Set<SnapshotListener>();

    constructor(store = new ConfigStore()) {
        this.store = store;
    }

    getConfigFilePath(): string {
        return this.store.getFilePath();
    }

    async init(): Promise<ConfigSnapshot> {
        this.stored = await this.store.load();
        this.snapshot = this.buildSnapshot(this.stored);
        return this.snapshot;
    }

    getSnapshot(): ConfigSnapshot {
        return this.snapshot;
    }

    subscribe(listener: SnapshotListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    async update(mutator: (current: StoredConfig) => StoredConfig | Promise<StoredConfig>): Promise<ConfigSnapshot> {
        const next = await mutator(this.stored);
        const normalized: StoredConfig = {
            ...next,
            version: 1,
        };
        await this.store.save(normalized);
        this.stored = await this.store.load();
        this.snapshot = this.buildSnapshot(this.stored);
        this.emit();
        return this.snapshot;
    }

    async reload(): Promise<ConfigSnapshot> {
        this.stored = await this.store.load();
        this.snapshot = this.buildSnapshot(this.stored);
        this.emit();
        return this.snapshot;
    }

    private emit(): void {
        for (const listener of this.listeners) {
            listener(this.snapshot);
        }
    }

    private buildSnapshot(stored: StoredConfig): ConfigSnapshot {
        const activeProfile = stored.activeProfileId
            ? stored.profiles.find((profile) => profile.id === stored.activeProfileId)
            : undefined;
        const envVars = readEnvLLMConfig();

        const effectiveValue = <K extends keyof EffectiveConfig>(
            profileValue: string | undefined,
            envValue: string | undefined,
            field: K
        ): { value: string | undefined; source: ValueSource } => {
            if (profileValue) {
                return { value: profileValue, source: "profile" };
            }
            if (envValue) {
                return { value: envValue, source: "env" };
            }
            return { value: undefined, source: "missing" };
        };

        const apiKeyField = effectiveValue(activeProfile?.apiKey, envVars.apiKey, "apiKey");
        const baseUrlField = effectiveValue(activeProfile?.baseUrl, envVars.baseUrl, "baseUrl");
        const modelField = effectiveValue(activeProfile?.model, envVars.model, "model");
        const fastModelField = effectiveValue(activeProfile?.fastModel, envVars.fastModel, "fastModel");

        const effective: EffectiveConfig = {
            apiKey: apiKeyField.value,
            baseUrl: baseUrlField.value,
            model: modelField.value,
            fastModel: fastModelField.value,
            sources: {
                apiKey: apiKeyField.source,
                baseUrl: baseUrlField.source,
                model: modelField.source,
                fastModel: fastModelField.source,
            },
        };

        return { stored, activeProfile, effective };
    }
}

export function requireLLMConfig(snapshot: ConfigSnapshot): ReadyLLMConfig {
    const missing: string[] = [];
    if (!snapshot.effective.apiKey) missing.push("API_KEY");
    if (!snapshot.effective.baseUrl) missing.push("BASE_URL");
    if (!snapshot.effective.model) missing.push("MODEL");

    if (missing.length > 0) {
        throw new Error(
            `Missing required fields (${missing.join(", ")}). 请通过 /config 或环境变量提供这些值。`
        );
    }

    return {
        apiKey: snapshot.effective.apiKey!,
        baseUrl: snapshot.effective.baseUrl!,
        model: snapshot.effective.model!,
        fastModel: snapshot.effective.fastModel,
    };
}

function readEnvLLMConfig(): Record<"apiKey" | "baseUrl" | "model" | "fastModel", string | undefined> {
    return {
        apiKey: trim(process.env.TOY_API_KEY),
        baseUrl: trim(process.env.TOY_BASE_URL),
        model: trim(process.env.TOY_MODEL),
        fastModel: trim(process.env.TOY_FAST_MODEL),
    };
}

function trim(value: string | undefined): string | undefined {
    if (typeof value !== "string") return undefined;
    const out = value.trim();
    return out.length > 0 ? out : undefined;
}

