import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { type CommandDefinition } from "./command_system";
import { type ChatContext } from "../chat_runner";

export const multilineCommand: CommandDefinition<ChatContext> = {
    name: "m",
    description: "Compose multi-line message in external editor",
    handler: async ({ ui }) => {
        const editor = resolveDefaultEditor();
        const tempDir = await mkdtemp(path.join(tmpdir(), "toy-agent-m-"));
        const filePath = path.join(tempDir, "message.txt");

        let draft = "";
        try {
            while (true) {
                await writeFile(filePath, withUtf8BomRemoved(draft), "utf8");
                const ok = await openEditor(ui, editor, filePath);
                if (!ok) {
                    ui.printError(`Failed to launch editor: ${editor.command}`);
                    return { type: "continue" };
                }

                const edited = await readFile(filePath, "utf8");
                draft = withUtf8BomRemoved(edited);

                ui.printSystem(
                    ["Multi-line draft:", "", draft || "(empty)", "", "Enter=send  /m=edit  /cancel=discard"].join("\n")
                );

                const answer = await ui.promptUser();
                const decision = answer.trim().toLowerCase();
                if (decision === "") return { type: "replace_input", input: draft };
                if (decision === "/m") continue;
                if (decision === "/cancel") return { type: "continue" };

                ui.printSystem("Invalid choice. Use Enter to send, /m to edit, /cancel to discard.");
            }
        } finally {
            await rm(tempDir, { recursive: true, force: true });
        }
    },
};

type EditorSpec = { command: string; args: (filePath: string) => string[] };

function resolveDefaultEditor(): EditorSpec {
    if (process.platform === "win32") {
        return { command: "notepad.exe", args: (filePath) => [filePath] };
    }
    return { command: "vi", args: (filePath) => [filePath] };
}

async function openEditor(ui: ChatContext["ui"], editor: EditorSpec, filePath: string): Promise<boolean> {
    ui.suspendPrompt?.();
    try {
        await new Promise<void>((resolve, reject) => {
            const child = spawn(editor.command, editor.args(filePath), { stdio: "inherit" });
            child.once("error", reject);
            child.once("exit", () => resolve());
        });
        return true;
    } catch {
        return false;
    } finally {
        if (ui.resumePrompt) {
            ui.resumePrompt();
        } else {
            ui.resetPrompt?.();
        }
    }
}

function withUtf8BomRemoved(text: string): string {
    if (text.charCodeAt(0) === 0xfeff) return text.slice(1);
    return text;
}
