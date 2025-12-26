#!/usr/bin/env bun

import OpenAI from "openai";
import { type ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { CommandSystem } from "./commands/command_system";
import { ToolSystem } from "./tools/tool_system";
import { getTimeTool } from "./tools/get_time";
import { pwdTool } from "./tools/pwd";
import { lsTool } from "./tools/ls";
import { readFileTool } from "./tools/read_file";
import { grepTool } from "./tools/grep";
import { outlineTool } from "./tools/outline";
import { CliUI } from "./cli_ui";
import { ChatRunner, type ChatContext, type LLMRuntime } from "./chat_runner";
import { ensureSystemPrompt } from "./system_prompt";
import { clearCommand } from "./commands/clear";
import { exitCommand } from "./commands/exit";
import { toolsCommand } from "./commands/tools";
import { saveCommand } from "./commands/save";
import { questionTool } from "./tools/question";
import { Notebook } from "./notebook/notebook";
import { addNoteTool, deleteNoteTool, updateNoteTool } from "./tools/notebook";
import { configCommand } from "./commands/config";
import { multilineCommand } from "./commands/m";
import { RuntimeConfigService, requireLLMConfig, type ConfigSnapshot } from "./config/runtime_config";

// 历史记录上下文
const conversationHistory: ChatCompletionMessageParam[] = [];

// Notebook (in-memory)
const notebook = new Notebook();

// 初始化 system prompt（确保模型始终以命令行助手风格输出）
ensureSystemPrompt(conversationHistory);


// 工具系统（OpenAI tool calling）
const toolSystem = new ToolSystem<ChatContext>()
    .register(getTimeTool)
    .register(pwdTool)
    .register(lsTool)
    .register(readFileTool)
    .register(outlineTool)
    .register(grepTool)
    .register(questionTool)
    .register(addNoteTool)
    .register(updateNoteTool)
    .register(deleteNoteTool);


// 命令系统
const commandSystem = new CommandSystem<ChatContext>({
    prefix: "/",
    helpHeader: "Available commands:",
});
commandSystem
    .register(clearCommand)
    .register(exitCommand)
    .register(toolsCommand)
    .register(saveCommand)
    .register(multilineCommand)
    .register(configCommand);

const runtimeConfig = new RuntimeConfigService();

async function main() {
    const ui = new CliUI();
    let unsubscribe: (() => void) | null = null;
    try {
        const snapshot = await runtimeConfig.init();
        const llm = createLLMRuntimeFromSnapshot(snapshot);
        ui.printBanner({ model: llm.primaryModel });

        const runner = new ChatRunner({
            llm,
            conversationHistory,
            commandSystem,
            toolSystem,
            ui,
            notebook,
            runtimeConfig,
        });

        unsubscribe = runtimeConfig.subscribe((nextSnapshot) => {
            try {
                const nextRuntime = createLLMRuntimeFromSnapshot(nextSnapshot);
                runner.updateLLMRuntime(nextRuntime);
                ui.printSystem(`配置已激活：${nextSnapshot.activeProfile?.label ?? "环境变量"}`);
            } catch (error) {
                ui.printError(`配置更新失败：${error instanceof Error ? error.message : String(error)}`);
            }
        });

        await runner.run();
    } catch (error) {
        ui.printError(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    } finally {
        if (unsubscribe) unsubscribe();
        ui.close();
    }
}

main().catch(console.error);

function createLLMRuntimeFromSnapshot(snapshot: ConfigSnapshot): LLMRuntime {
    const ready = requireLLMConfig(snapshot);
    const client = new OpenAI({
        apiKey: ready.apiKey,
        baseURL: ready.baseUrl,
    });
    return {
        client,
        primaryModel: ready.model,
        fastModel: ready.fastModel,
    };
}
