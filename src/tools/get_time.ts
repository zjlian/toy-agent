import { type Tool } from "./tool_system";
import type { ChatContext } from "../chat_runner";

function formatLocalISOString(date: Date): string {
    const pad = (n: number, width = 2) => String(n).padStart(width, "0");

    const year = date.getFullYear();
    const month = pad(date.getMonth() + 1);
    const day = pad(date.getDate());
    const hour = pad(date.getHours());
    const minute = pad(date.getMinutes());
    const second = pad(date.getSeconds());
    const ms = pad(date.getMilliseconds(), 3);

    // getTimezoneOffset() is minutes to add to local time to get UTC.
    // We want the local offset from UTC (e.g. +08:00), hence the negation.
    const offsetMinutes = -date.getTimezoneOffset();
    const sign = offsetMinutes >= 0 ? "+" : "-";
    const abs = Math.abs(offsetMinutes);
    const offsetHH = pad(Math.floor(abs / 60));
    const offsetMM = pad(abs % 60);

    return `${year}-${month}-${day}T${hour}:${minute}:${second}.${ms}${sign}${offsetHH}:${offsetMM}`;
}

export const getTimeTool: Tool<ChatContext> = {
    name: "get_time",
    description: "Get current local time as an ISO 8601 string (includes timezone offset).",
    parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
    },
    handler: async () => formatLocalISOString(new Date()),
};
