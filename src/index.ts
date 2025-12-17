#!/usr/bin/env bun

import { z } from "zod";
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
import { ChatRunner, type ChatContext } from "./chat_runner";
import { ensureSystemPrompt } from "./system_prompt";
import { clearCommand } from "./commands/clear";
import { exitCommand } from "./commands/exit";
import { toolsCommand } from "./commands/tools";
import { saveCommand } from "./commands/save";
import { questionTool } from "./tools/question";

const envSchema = z.object({
    TOY_API_KEY: z.string().min(1),
    TOY_BASE_URL: z.string().url(),
    TOY_MODEL: z.string().min(1),
});

const env = envSchema.parse(process.env);

const client = new OpenAI({
    apiKey: env.TOY_API_KEY,
    baseURL: env.TOY_BASE_URL,
});

// 历史记录上下文
const conversationHistory: ChatCompletionMessageParam[] = [];

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
    .register(questionTool);


// 命令系统
const commandSystem = new CommandSystem<ChatContext>({
    prefix: "/",
    helpHeader: "Available commands:",
});
commandSystem.register(clearCommand).register(exitCommand).register(toolsCommand).register(saveCommand);

async function main() {
    const ui = new CliUI();
    ui.printBanner({ model: env.TOY_MODEL });

    try {
        const runner = new ChatRunner({
            client,
            model: env.TOY_MODEL,
            conversationHistory,
            commandSystem,
            toolSystem,
            ui,
        });
        await runner.run();
    } finally {
        ui.close();
    }
}

main().catch(console.error);
