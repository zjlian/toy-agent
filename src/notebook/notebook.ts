export interface Note {
    key: string;
    title: string;
    content: string;
    tags: string[];
}

/**
 * In-memory notebook store (V1).
 *
 * - Preserves insertion order for rendering.
 * - No size limit enforcement (per current V1 spec decision).
 */
export class Notebook {
    private readonly notesByKey = new Map<string, Note>();
    private readonly insertionOrder: string[] = [];

    has(key: string): boolean {
        return this.notesByKey.has(key);
    }

    get(key: string): Note | undefined {
        return this.notesByKey.get(key);
    }

    add(note: Note): void {
        if (this.notesByKey.has(note.key)) {
            throw new Error(`Key '${note.key}' already exists`);
        }
        this.notesByKey.set(note.key, note);
        this.insertionOrder.push(note.key);
    }

    update(key: string, patch: Partial<Pick<Note, "title" | "content" | "tags">>): void {
        const existing = this.notesByKey.get(key);
        if (!existing) {
            throw new Error(`Note with key '${key}' not found`);
        }

        const next: Note = {
            ...existing,
            ...(patch.title != null ? { title: patch.title } : null),
            ...(patch.content != null ? { content: patch.content } : null),
            ...(patch.tags != null ? { tags: patch.tags } : null),
        };
        this.notesByKey.set(key, next);
    }

    delete(key: string): void {
        const existed = this.notesByKey.delete(key);
        if (!existed) {
            throw new Error(`Note with key '${key}' not found`);
        }
        const idx = this.insertionOrder.indexOf(key);
        if (idx >= 0) this.insertionOrder.splice(idx, 1);
    }

    clear(): void {
        this.notesByKey.clear();
        this.insertionOrder.length = 0;
    }

    /** Notes in insertion order (stable). */
    toArray(): Note[] {
        const out: Note[] = [];
        for (const key of this.insertionOrder) {
            const note = this.notesByKey.get(key);
            if (note) out.push(note);
        }
        return out;
    }

    /** Pretty JSON for prompt injection. */
    toPrettyJSON(indent = 2): string {
        return JSON.stringify(this.toArray(), null, indent);
    }
}

