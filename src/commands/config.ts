import { randomUUID } from "node:crypto";
import { confirm, input, select } from "@inquirer/prompts";
import { type CommandDefinition } from "./command_system";
import { type ChatContext } from "../chat_runner";
import { type ProviderProfile, type StoredConfig } from "../config/config_store";
import { type ConfigSnapshot } from "../config/runtime_config";

type MenuAction = "summary" | "add" | "edit" | "delete" | "activate" | "exit";

export const configCommand: CommandDefinition<ChatContext> = {
    name: "config",
    description: "Manage persistent LLM provider profiles",
    handler: async ({ runtimeConfig, ui }) => {
        if (!runtimeConfig) {
            ui.printError("Runtime configuration service unavailable.");
            return;
        }

        try {
            let exit = false;
            while (!exit) {
                const snapshot = runtimeConfig.getSnapshot();
                const action = await promptMenu(snapshot);

                switch (action) {
                    case "summary":
                        printSummary(snapshot, runtimeConfig.getConfigFilePath(), ui);
                        break;
                    case "add":
                        await handleAdd(runtimeConfig, ui);
                        break;
                    case "edit":
                        await handleEdit(runtimeConfig, ui);
                        break;
                    case "delete":
                        await handleDelete(runtimeConfig, ui);
                        break;
                    case "activate":
                        await handleActivate(runtimeConfig, ui);
                        break;
                    case "exit":
                        exit = true;
                        break;
                    default:
                        exit = true;
                        break;
                }
            }
        } finally {
            ui.resetPrompt?.();
        }
    },
};

async function promptMenu(snapshot: ConfigSnapshot): Promise<MenuAction> {
    const hasProfiles = snapshot.stored.profiles.length > 0;
    const activeLabel = snapshot.activeProfile?.label ?? "环境变量";
    return await select<MenuAction>({
        message: `当前激活配置：${activeLabel}\n请选择要执行的操作`,
        choices: [
            { name: "查看配置摘要", value: "summary" },
            { name: "新增配置", value: "add" },
            { name: "修改配置", value: "edit", disabled: hasProfiles ? false : "暂无配置" },
            { name: "删除配置", value: "delete", disabled: hasProfiles ? false : "暂无配置" },
            { name: "切换激活配置", value: "activate", disabled: hasProfiles ? false : "暂无配置" },
            { name: "返回", value: "exit" },
        ],
    });
}

function printSummary(snapshot: ConfigSnapshot, filePath: string, ui: ChatContext["ui"]): void {
    const lines: string[] = [];
    lines.push(`配置文件路径: ${filePath}`);
    lines.push(`当前激活: ${snapshot.activeProfile?.label ?? "环境变量"}`);
    lines.push("");
    lines.push("生效字段:");
    lines.push(formatEffective("BASE_URL", snapshot.effective.baseUrl, snapshot.effective.sources.baseUrl));
    lines.push(formatEffective("API_KEY", maskSecret(snapshot.effective.apiKey), snapshot.effective.sources.apiKey));
    lines.push(formatEffective("MODEL", snapshot.effective.model, snapshot.effective.sources.model));
    lines.push(
        formatEffective("FAST_MODEL", snapshot.effective.fastModel ?? "(未配置)", snapshot.effective.sources.fastModel)
    );
    lines.push("");
    lines.push("已保存的配置:");
    if (snapshot.stored.profiles.length === 0) {
        lines.push("  (暂无配置，当前使用环境变量)");
    } else {
        for (const profile of snapshot.stored.profiles) {
            const isActive = snapshot.activeProfile?.id === profile.id;
            lines.push(`- ${profile.label}${isActive ? " (active)" : ""}`);
            lines.push(`    id: ${profile.id}`);
            lines.push(`    baseUrl: ${profile.baseUrl ?? "(继承)"}`);
            lines.push(`    model: ${profile.model ?? "(继承)"}`);
            lines.push(`    fastModel: ${profile.fastModel ?? "(继承)"}`);
            lines.push(`    apiKey: ${maskSecret(profile.apiKey) ?? "(继承)"}`);
        }
    }
    ui.printSystem(lines.join("\n"));
}

function formatEffective(label: string, value: string | undefined, source: "profile" | "env" | "missing"): string {
    const resolved = value ?? "(缺失)";
    const suffix = source === "profile" ? "来自配置" : source === "env" ? "来自环境变量" : "缺失";
    return `  ${label}: ${resolved} [${suffix}]`;
}

function maskSecret(value?: string): string | undefined {
    if (!value) return undefined;
    if (value.length <= 4) return "****";
    return `${value.slice(0, 4)}****${value.slice(-2)}`;
}

async function handleAdd(runtimeConfig: ChatContext["runtimeConfig"], ui: ChatContext["ui"]): Promise<void> {
    const profile: ProviderProfile = {
        id: randomUUID(),
        label: await promptLabel(),
        baseUrl: await promptOptionalUrl("基础 Base URL"),
        apiKey: await promptOptionalString("API Key"),
        model: await promptOptionalString("模型名称"),
        fastModel: await promptOptionalString("Fast Model (可选)"),
    };

    await runtimeConfig.update((current) => {
        const nextProfiles = [...current.profiles, profile];
        return {
            ...current,
            version: current.version ?? 1,
            profiles: nextProfiles,
            activeProfileId: current.activeProfileId ?? profile.id,
        } satisfies StoredConfig;
    });

    ui.printSystem(`新增配置完成：${profile.label}`);
}

async function handleEdit(runtimeConfig: ChatContext["runtimeConfig"], ui: ChatContext["ui"]): Promise<void> {
    const target = await selectProfile(runtimeConfig, "选择要修改的配置");
    if (!target) {
        ui.printSystem("暂无配置可修改。");
        return;
    }

    const updated: ProviderProfile = {
        ...target,
        label: await promptLabel(target.label),
        baseUrl: await promptOptionalUrl("基础 Base URL", target.baseUrl),
        apiKey: await promptOptionalString("API Key", target.apiKey),
        model: await promptOptionalString("模型名称", target.model),
        fastModel: await promptOptionalString("Fast Model (可选)", target.fastModel ?? undefined),
    };

    await runtimeConfig.update((current) => {
        const nextProfiles = current.profiles.map((profile) => (profile.id === updated.id ? updated : profile));
        return {
            ...current,
            version: current.version ?? 1,
            profiles: nextProfiles,
        } satisfies StoredConfig;
    });

    ui.printSystem(`配置已更新：${updated.label}`);
}

async function handleDelete(runtimeConfig: ChatContext["runtimeConfig"], ui: ChatContext["ui"]): Promise<void> {
    const target = await selectProfile(runtimeConfig, "选择要删除的配置");
    if (!target) {
        ui.printSystem("暂无配置可删除。");
        return;
    }

    const confirmed = await confirm({
        message: `确认删除配置 “${target.label}”? 此操作不可撤销。`,
        default: false,
    });
    if (!confirmed) return;

    await runtimeConfig.update((current) => {
        const nextProfiles = current.profiles.filter((profile) => profile.id !== target.id);
        const nextActive = current.activeProfileId === target.id ? nextProfiles[0]?.id : current.activeProfileId;
        return {
            ...current,
            version: current.version ?? 1,
            profiles: nextProfiles,
            activeProfileId: nextActive,
        } satisfies StoredConfig;
    });

    ui.printSystem(`已删除配置：${target.label}`);
}

async function handleActivate(runtimeConfig: ChatContext["runtimeConfig"], ui: ChatContext["ui"]): Promise<void> {
    const snapshot = runtimeConfig.getSnapshot();
    if (snapshot.stored.profiles.length === 0) {
        ui.printSystem("暂无配置，默认使用环境变量。");
        return;
    }

    const choice = await select<string>({
        message: "选择要激活的配置（或切换到纯环境变量）",
        choices: [
            { name: "仅使用环境变量", value: "__env__" },
            ...snapshot.stored.profiles.map((profile) => ({ name: profile.label, value: profile.id })),
        ],
        default: snapshot.activeProfile?.id ?? "__env__",
    });

    await runtimeConfig.update((current) => {
        const nextActive = choice === "__env__" ? undefined : choice;
        return {
            ...current,
            version: current.version ?? 1,
            activeProfileId: nextActive,
        } satisfies StoredConfig;
    });

    ui.printSystem(choice === "__env__" ? "已切换至环境变量配置" : "激活配置成功");
}

async function selectProfile(runtimeConfig: ChatContext["runtimeConfig"], message: string): Promise<ProviderProfile | undefined> {
    const snapshot = runtimeConfig.getSnapshot();
    if (snapshot.stored.profiles.length === 0) return undefined;

    const value = await select<string>({
        message,
        choices: snapshot.stored.profiles.map((profile) => ({ name: profile.label, value: profile.id })),
    });

    return snapshot.stored.profiles.find((profile) => profile.id === value);
}

async function promptLabel(defaultValue?: string): Promise<string> {
    const answer = await input({
        message: "配置名称",
        default: defaultValue ?? "",
        validate: (value) => (value.trim().length === 0 ? "名称不能为空" : true),
    });
    return answer.trim();
}

async function promptOptionalString(message: string, current?: string): Promise<string | undefined> {
    const answer = await input({
        message: `${message} (留空沿用现有/环境，输入 - 清除)`,
        default: current ?? "",
    });
    const trimmed = answer.trim();
    if (trimmed === "-") return undefined;
    if (trimmed.length === 0) {
        return current;
    }
    return trimmed;
}

async function promptOptionalUrl(message: string, current?: string): Promise<string | undefined> {
    const answer = await input({
        message: `${message} (留空沿用现有/环境) | 输入 - 清除`,
        default: current ?? "",
        validate: (value) => {
            const trimmed = value.trim();
            if (!trimmed || trimmed === "-") return true;
            try {
                new URL(trimmed);
                return true;
            } catch {
                return "请输入合法的 URL";
            }
        },
    });
    const trimmed = answer.trim();
    if (!trimmed) return current;
    if (trimmed === "-") return undefined;
    return trimmed;
}

