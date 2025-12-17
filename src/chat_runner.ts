import OpenAI from "openai";
import { type ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { generate } from "./llm_client";
import { type CommandAction, type CommandSystem } from "./commands/command_system";
import { type ToolCallLike, ToolSystem } from "./tools/tool_system";
import { type ChatUI } from "./cli_ui";
import { Notebook } from "./notebook/notebook";

export type ChatContext = {
    client: OpenAI;
    model: string;
    conversationHistory: ChatCompletionMessageParam[];
    ui: ChatUI;
    toolSystem: ToolSystem<ChatContext>;
    notebook: Notebook;
};

export type ChatRunnerOptions = {
    client: OpenAI;
    model: string;
    conversationHistory: ChatCompletionMessageParam[];
    commandSystem: CommandSystem<ChatContext>;
    toolSystem: ToolSystem<ChatContext>;
    ui: ChatUI;
    notebook: Notebook;
    maxToolRounds?: number;
};

export class ChatRunner {
    private readonly client: OpenAI;
    private readonly model: string;
    private readonly conversationHistory: ChatCompletionMessageParam[];
    private readonly commandSystem: CommandSystem<ChatContext>;
    private readonly toolSystem: ToolSystem<ChatContext>;
    private readonly ui: ChatUI;
    private readonly maxToolRounds: number;
    private readonly notebook: Notebook;

    /**
     * 构造并初始化 ChatRunner。
     *
     * 负责注入 OpenAI 客户端、模型名、对话历史、命令系统、工具系统与 UI，
     * 并设置工具调用的最大轮数上限（避免陷入无限 tool loop）。
     */
    constructor(options: ChatRunnerOptions) {
        this.client = options.client;
        this.model = options.model;
        this.conversationHistory = options.conversationHistory;
        this.commandSystem = options.commandSystem;
        this.toolSystem = options.toolSystem;
        this.ui = options.ui;
        this.notebook = options.notebook;
        this.maxToolRounds = options.maxToolRounds ?? 100;
    }

    /**
     * 创建命令系统/工具系统执行所需的上下文对象。
     *
     * 将当前的会话历史、UI 与工具系统打包，供命令处理器读取与操作。
     */
    private createChatContext(): ChatContext {
        return {
            client: this.client,
            model: this.model,
            conversationHistory: this.conversationHistory,
            ui: this.ui,
            toolSystem: this.toolSystem,
            notebook: this.notebook,
        };
    }


    private formatLocalDateTime(date: Date): string {
        const pad = (n: number) => String(n).padStart(2, "0");
        const y = date.getFullYear();
        const m = pad(date.getMonth() + 1);
        const d = pad(date.getDate());
        const hh = pad(date.getHours());
        const mm = pad(date.getMinutes());
        const ss = pad(date.getSeconds());
        return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
    }

    private getLastUserQuery(): string {
        for (let i = this.conversationHistory.length - 1; i >= 0; i--) {
            const msg = this.conversationHistory[i];
            if (!msg) continue;
            if (msg.role !== "user") continue;
            const content = (msg as any)?.content;
            if (typeof content === "string") return content;
            try {
                return JSON.stringify(content);
            } catch {
                return String(content ?? "");
            }
        }
        return "";
    }

    private buildDynamicNotebookSystemText(): string {
        const now = this.formatLocalDateTime(new Date());
        const cwd = process.cwd();
        const lastQuery = this.getLastUserQuery();
        const notesJson = this.notebook.toPrettyJSON(2);

        return [
            "=== 🔒 环境上下文 (只读区域 - 不可修改) ===",
            `[Current Time]: ${now}`,
            `[Current WorkDir]: ${cwd}`,
            `[User Last Query]: ${lastQuery}`,
            "[Tool Guide]:",
            "- 使用 add_note 新增笔记",
            "- 使用 update_note 更新笔记 (支持修改 tags 状态)",
            "- 使用 delete_note 删除不再需要的笔记",
            "",
            "=== 📝 你的草稿本 (可编辑区域 - Notebook) ===",
            "这是你的短期工作记忆，用于记录关键线索、任务规划或状态（不是对话存档）。",
            "Notebook 使用约束：",
            "- 禁止：把给用户的最终回复全文写入 Notebook；把整段对话/长篇推理写入 Notebook。",
            "- 只记录关键片段：关键事实/约束、后续要复用的信息、3-7 条以内的工作计划、状态变化。",
            "- key 用语义化名称；tags 用于 TODO/IN_PROGRESS/DONE、Verified/Uncertain、Source:* 等维度。",
            "示例（好的笔记更像便签而不是正文）：",
            "- key: plan_v1 | title: 执行计划 | content: 1) 先 outline 再 grep 2) 实现 notebook 工具 3) 加入 prompt 注入 | tags: [TODO]",
            "当前存储的笔记 (JSON格式):",
            notesJson,
            "",
            "==============================================",
        ].join("\n");
    }

    private buildRequestMessages(): ChatCompletionMessageParam[] {
        const dynamicSystem: ChatCompletionMessageParam = {
            role: "system",
            content: this.buildDynamicNotebookSystemText(),
        };

        const history = this.conversationHistory;

        // Insert the dynamic block right before the latest user query (as requested).
        const lastUserIdx = (() => {
            for (let i = history.length - 1; i >= 0; i--) {
                if (history[i]?.role === "user") return i;
            }
            return -1;
        })();

        if (lastUserIdx >= 0) {
            return [...history.slice(0, lastUserIdx), dynamicSystem, ...history.slice(lastUserIdx)];
        }

        // No user message yet: place dynamic block after the base system prompt (if present).
        if (history[0]?.role === "system") {
            return [history[0], dynamicSystem, ...history.slice(1)];
        }
        return [dynamicSystem, ...history];
    }

    /**
     * 从 CLI UI 读取一行用户输入。
     *
     * 如果输入为空白（仅空格/换行），返回 null 并打印一个空行以保持交互间距友好。
     */
    private async promptUserInput(): Promise<string | null> {
        const userInput = await this.ui.promptUser();
        if (!userInput.trim()) {
            // Keep prompt spacing pleasant.
            console.log();
            return null;
        }
        return userInput;
    }

    /**
     * 尝试把用户输入当作命令处理。
     *
     * 如果命令系统能够识别并处理该输入，则返回对应动作；否则返回 null。
     */
    private async tryHandleCommand(userInput: string): Promise<CommandAction | null> {
        return this.commandSystem.tryHandle(userInput, this.createChatContext());
    }

    /**
     * 将用户输入追加到对话历史中，作为下一次模型请求的上下文。
     */
    private appendUserMessage(userInput: string): void {
        this.conversationHistory.push({ role: "user", content: userInput });
    }

    /**
     * 构建一次 OpenAI Chat Completions 请求参数。
     *
     * 会带上历史消息与工具定义，并启用自动 tool_choice，以便模型按需调用工具。
     */
    private buildChatRequest() {
        return {
            model: this.model,
            messages: this.buildRequestMessages(),
            tools: this.toolSystem.toOpenAITools(),
            tool_choice: "auto" as const,
            // temperature: 0,
            // max_tokens: 120000,
        };
    }

    /**
     * 发送请求给模型并取回一条 assistant 消息。
     *
     * 同时对 SDK 返回的 message 类型做结构兼容的转换，以便能直接写回 conversationHistory。
     */
    private async requestModelMessage() {
        const request = this.buildChatRequest();
        const response = await generate(this.client, request);
        const msg = response.choices[0]?.message;
        if (!msg) throw new Error("No message received from AI");

        // The OpenAI SDK returns a message object type that is slightly different from
        // the request-side `ChatCompletionMessageParam` union, but it's structurally compatible
        // for our usage (we only append it back into history for the next request).
        return msg as unknown as ChatCompletionMessageParam
            & {
                tool_calls?: ToolCallLike[];
                content?: string | null;
                reasoning_content?: string | null;
            };
    }

    /**
     * 将模型返回的 assistant 消息追加到对话历史中。
     */
    private appendAssistantMessage(message: ChatCompletionMessageParam): void {
        this.conversationHistory.push(message);
    }

    /**
     * 从模型消息中提取 tool_calls（如果存在）。
     */
    private getToolCalls(message: { tool_calls?: ToolCallLike[] }): ToolCallLike[] | undefined {
        return message.tool_calls;
    }

    /**
     * 将即将调用的工具及其参数打印到 UI，用于可观测性/调试。
     */
    private printToolCalls(toolCalls: ToolCallLike[]): void {
        for (const call of toolCalls) {
            const name = call?.function?.name ?? "(unknown)";
            const args = call?.function?.arguments ?? "{}";
            this.ui.printToolCall(name, args);
        }
    }

    /**
     * 执行模型请求的工具调用，并把每个工具执行结果以 role=tool 的消息形式追加回对话历史。
     *
     * 这样模型在下一轮推理时就能看到工具输出，从而继续推理或给出最终回答。
     */
    private async appendToolResults(toolCalls: ToolCallLike[]): Promise<void> {
        const ctx = this.createChatContext();
        const results = await this.toolSystem.handleToolCalls(toolCalls, ctx);
        for (const r of results) {
            // Tool results are request-side message params, so we can push without `any`.
            this.conversationHistory.push({
                role: "tool",
                tool_call_id: r.tool_call_id,
                content: r.content,
            });
        }
    }

    /**
     * 从模型消息中提取最终要展示给用户的文本内容。
     *
     * 若 content 为 null/undefined，返回 null，表示该轮没有直接给出可展示的最终文本。
     */
    private getFinalText(message: { content?: string | null }): string | null {
        return message.content ?? null;
    }

    /**
     * 运行“模型 ↔ 工具”循环。
     *
     * 每一轮先向模型请求消息；若包含 tool_calls，则执行工具并将结果写回历史后继续；
     * 若不包含 tool_calls，则认为得到最终文本并返回。
     * 超过最大轮数仍未得到最终文本时返回 null。
     */
    private async runToolLoop(): Promise<string | null> {
        for (let round = 0; round < this.maxToolRounds; round++) {
            const msg = await this.requestModelMessage();

            if (msg.reasoning_content) {
                this.printCoTContext(msg.reasoning_content);
            }

            const toolCalls = this.getToolCalls(msg);

            // 交错思维，将 thinking 的内容写入到 content 并入上下文
            if (toolCalls?.length) {
                msg.content = msg.reasoning_content;
            }
            this.appendAssistantMessage(msg);

            if (toolCalls?.length) {
                this.printToolCalls(toolCalls);
                await this.appendToolResults(toolCalls);
                continue;
            }

            const finalText = this.getFinalText(msg);
            if (finalText == null) {
                console.log(msg);
            }

            return finalText;
        }

        return null;
    }

    /**
     * 将思考过程文本输出到 UI。
     * 
     * 注意：思考过程文本可能为空字符串，表示没有思考过程可展示。
     */
    private printCoTContext(text: string | null): void {
        if (text !== null) {
            this.ui.printCoTContext(text);
        }
    }


    /**
     * 将最终文本输出到 UI。
     *
     * 注意：空字符串是合法的最终回答；只有 null 才表示未获得最终回答（可能是 tool loop 超限）。
     */
    private printFinalResponse(finalText: string | null): void {
        // Note: `msg.content` can legally be an empty string. Treat that as a valid final response.
        if (finalText !== null) {
            this.ui.printAssistant(finalText);
        } else {
            this.ui.printError("No final response received from AI (maybe tool loop exceeded).");
        }
    }

    /**
     * 将捕获到的异常转换为可读文本并输出到 UI。
     */
    private reportError(err: unknown): void {
        this.ui.printError(err instanceof Error ? err.message : String(err));
    }

    /**
     * 启动交互式聊天主循环。
     *
     * 流程：读取用户输入 → 优先处理命令 → 追加用户消息 → 请求模型/处理工具循环 → 打印最终回复。
     * 遇到 exit 命令则退出循环；发生异常时打印错误并继续下一轮。
     */
    async run(): Promise<void> {
        while (true) {
            try {
                const userInput = await this.promptUserInput();
                if (userInput == null) continue;

                // Commands first.
                const action = await this.tryHandleCommand(userInput);
                if (action) {
                    if (action === "exit") break;
                    continue;
                }

                this.appendUserMessage(userInput);
                this.ui.printThinking();

                const finalText = await this.runToolLoop();
                this.printFinalResponse(finalText);
            } catch (err) {
                this.reportError(err);
            }
        }
    }
}
