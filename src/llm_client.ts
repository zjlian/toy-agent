import OpenAI from "openai";
import { appendFile } from "node:fs/promises";
import { resolve } from "node:path";

export type ChatRequest = OpenAI.Chat.ChatCompletionCreateParamsNonStreaming;
export type ChatResponse = OpenAI.Chat.ChatCompletion;
export type ChatStreamRequest = OpenAI.Chat.ChatCompletionCreateParamsStreaming;
export type ChatStream = AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;

export async function generate(client: OpenAI, request: ChatRequest): Promise<ChatResponse> {
    return await openai_generate(client, request);
}

export async function generate_stream(client: OpenAI, request: ChatStreamRequest): Promise<ChatStream> {
    return await openai_generate_stream(client, request);
}

async function appendDebugLog(payload: unknown): Promise<void> {
    // Write to the process working directory.
    const logPath = resolve(process.cwd(), "debug.log");
    const timestamp = new Date().toISOString();

    try {
        const body = JSON.stringify(
            payload,
            (key, value) => (key === "tools" ? undefined : value),
            2
        );
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

async function openai_generate(client: OpenAI, request: ChatRequest): Promise<ChatResponse> {
    try {
        await appendDebugLog(request);
        return await client.chat.completions.create(request);
    } catch (error) {
        handleOpenAIError(error);
    }
}

async function openai_generate_stream(client: OpenAI, request: ChatStreamRequest): Promise<ChatStream> {
    try {
        await appendDebugLog(request);
        return await client.chat.completions.create({ ...request, stream: true });
    } catch (error) {
        handleOpenAIError(error);
    }
}

function handleOpenAIError(error: unknown): never {
    if (error instanceof OpenAI.APIError) {
        const status = error.status;
        const code = error.code;
        console.error(`[OpenAI Driver Error] Status: ${status} | Code: ${code}`);
        throw new Error(`OpenAI request failed: ${error.message}`);
    }
    throw error;
}
