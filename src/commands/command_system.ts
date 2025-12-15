export type CommandAction = "continue" | "exit";

export type CommandHandler<Ctx> = (
    ctx: Ctx,
    args: string[]
) => void | CommandAction | Promise<void | CommandAction>;

export interface CommandDefinition<Ctx> {
    /** Command name without prefix, e.g. "clear" for "/clear" */
    name: string;
    description: string;
    aliases?: string[];
    handler: CommandHandler<Ctx>;
}

export interface CommandSystemOptions {
    prefix?: string;
    helpHeader?: string;
}

export class CommandSystem<Ctx> {
    private readonly prefix: string;
    private readonly helpHeader: string;
    private readonly commandsInOrder: CommandDefinition<Ctx>[] = [];
    private readonly lookup: Map<string, CommandDefinition<Ctx>> = new Map();

    constructor(options: CommandSystemOptions = {}) {
        this.prefix = options.prefix ?? "/";
        this.helpHeader = options.helpHeader ?? "Available commands:";
    }

    register(def: CommandDefinition<Ctx>): this {
        const name = def.name.trim().toLowerCase();
        if (!name) throw new Error("Command name cannot be empty");
        if (name.includes(" ")) throw new Error(`Command name cannot contain spaces: ${name}`);
        if (this.lookup.has(name)) throw new Error(`Command already registered: ${name}`);

        const normalized: CommandDefinition<Ctx> = {
            ...def,
            name,
            aliases: (def.aliases ?? []).map((a) => a.trim().toLowerCase()).filter(Boolean),
        };

        this.commandsInOrder.push(normalized);

        // primary name
        this.lookup.set(normalized.name, normalized);

        // aliases
        for (const alias of normalized.aliases ?? []) {
            if (this.lookup.has(alias)) throw new Error(`Command/alias already registered: ${alias}`);
            this.lookup.set(alias, normalized);
        }

        return this;
    }

    /**
     * If input is a command, handles it and returns an action.
     * If input is not a command, returns null.
     */
    async tryHandle(input: string, ctx: Ctx): Promise<CommandAction | null> {
        const parsed = this.parse(input);
        if (!parsed) return null;

        // "/" -> show help
        if (!parsed.name) {
            console.log(this.formatHelp() + "\n");
            return "continue";
        }

        const def = this.lookup.get(parsed.name);
        if (!def) {
            console.log(`Unknown command: ${this.prefix}${parsed.name}\nType '${this.prefix}' to see available commands.\n`);
            return "continue";
        }

        const result = await def.handler(ctx, parsed.args);
        return result ?? "continue";
    }

    private parse(input: string): { name: string; args: string[] } | null {
        if (!input.startsWith(this.prefix)) return null;

        const parts = input.slice(this.prefix.length).trim().split(/\s+/).filter(Boolean);
        const name = (parts[0] ?? "").toLowerCase();
        const args = parts.slice(1);
        return { name, args };
    }

    private formatHelp(): string {
        const lines: string[] = [this.helpHeader];
        for (const def of this.commandsInOrder) {
            lines.push(`  ${this.prefix}${def.name}  ${def.description}`);
        }
        return lines.join("\n");
    }
}


