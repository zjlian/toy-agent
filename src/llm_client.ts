import OpenAI from "openai";
import { type ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { appendFile } from "node:fs/promises";
import { resolve } from "node:path";

export type ChatRequest = OpenAI.Chat.ChatCompletionCreateParamsNonStreaming;
export type ChatResponse = OpenAI.Chat.ChatCompletion;


export async function generate(
    client: OpenAI,
    request: ChatRequest
): Promise<ChatResponse>;


export async function generate(
    client: OpenAI | any,
    request: ChatRequest | any
): Promise<ChatResponse | any> {
    if (client instanceof OpenAI) {
        // 这里需要断言 request 是 OpenAI 类型，因为重载签名已经保证了这一点
        return await openai_generate(client, request as ChatRequest);
    }
    throw new Error("Unsupported Client Type");
}

async function appendDebugLog(payload: unknown): Promise<void> {
    // Write to the process working directory.
    const logPath = resolve(process.cwd(), "debug.log");
    const timestamp = new Date().toISOString();

    // Best-effort logging: never fail the request due to logging issues.
    try {
        const body = JSON.stringify(payload, null, 2);
        await appendFile(
            logPath,
            `\n----- ${timestamp} | LLM Request Payload -----\n${body}\n`,
            "utf8"
        );
    } catch (err) {
        // Avoid throwing from logging.
        // If payload contains non-serializable values, fall back to a simple string.
        try {
            await appendFile(
                logPath,
                `\n----- ${timestamp} | LLM Request Payload (non-serializable) -----\n${String(
                    err
                )}\n`,
                "utf8"
            );
        } catch {
            // ignore
        }
    }
}

async function openai_generate(
    client: OpenAI,
    request: ChatRequest
): Promise<ChatResponse> {
    try {
        await appendDebugLog(request);
        const response = await client.chat.completions.create(request);

        return response;

    } catch (error) {
        // 3. 结构化错误处理
        // OpenAI SDK 会抛出特定类型的 APIError，这里可以做拦截或日志
        if (error instanceof OpenAI.APIError) {
            const status = error.status; // e.g. 401, 429, 500
            const code = error.code;     // e.g. 'context_length_exceeded'

            console.error(`[OpenAI Driver Error] Status: ${status} | Code: ${code}`);

            // 你可以选择在这里抛出自定义错误，或者原样抛出
            throw new Error(`OpenAI request failed: ${error.message}`);
        }

        // 处理网络中断或其他未知错误
        throw error;
    }
}
