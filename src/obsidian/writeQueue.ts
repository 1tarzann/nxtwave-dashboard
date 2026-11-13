// Table edits for the host: one write at a time per note, and a read-back about 2 s after each one. No Obsidian
// import (the host passes vault.process and vault.read in), so the browser preview and the tests run this same code.

import { stillHolds } from "../data/readBack";
import { applyTableOp, TableOp } from "../data/tableEdit";
import { readFrontmatterRaw, setFrontmatterRaw } from "../data/templates";

/** What `settled` says when the read-back finds a partner's change on top of ours. */
export const PARTNER_WARNING = "Your partner changed the same spot at the same time. Open the note and check it says what you want.";

/** How long after a save the note is read back: long enough for Relay to merge a change made at the same moment. */
export const CHECK_AFTER_MS = 2000;

/** Runs tasks one at a time per key (a note's path). Tasks for different keys run side by side. */
export class WriteQueue {
  private tails = new Map<string, Promise<void>>();

  /** Runs `task` once every task queued earlier for `key` has finished, failed ones too. Settles like the task. */
  run<T>(key: string, task: () => Promise<T> | T): Promise<T> {
    const result = (this.tails.get(key) ?? Promise.resolve()).then(() => task());
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return result;
  }

  /** A task for `key` is running or waiting. */
  busy(key: string): boolean {
    return this.tails.has(key);
  }
}

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---/;

/**
 * Sets last_updated to `today` when the frontmatter already has that key (it's never added). The value keeps its
 * quotes ("2026-11-04" stays quoted, as the v2 templates write it), and a CRLF frontmatter keeps its line endings,
 * so only that one line changes.
 */
export function touchLastUpdated(note: string, today: string): string {
  const fm = readFrontmatterRaw(note);
  if (!Object.prototype.hasOwnProperty.call(fm, "last_updated")) return note;
  const old = fm.last_updated.trim();
  const quote = /^["']/.exec(old)?.[0] ?? "";
  const value = `${quote}${today}${quote}`;
  if (old === value) return note;
  const block = FRONTMATTER.exec(note)?.[0];
  if (!block) return note;
  // setFrontmatterRaw joins frontmatter lines with "\n", so a CRLF block goes through it as LF and gets its "\r" back.
  const crlf = block.includes("\r\n");
  const next = crlf
    ? setFrontmatterRaw(block.replace(/\r\n/g, "\n"), { last_updated: value }).replace(/\n/g, "\r\n")
    : setFrontmatterRaw(block, { last_updated: value });
  return next + note.slice(block.length);
}

/** Ops that change a note's content. Marker ops (Ask for research, Looks good) don't count as an update. */
const CONTENT_OPS: ReadonlySet<TableOp["kind"]> = new Set(["set", "insert", "delete", "restore"]);

/**
 * applyTableOp, plus last_updated = today when a content op (set, insert, delete, restore) changed the note.
 * Throws whatever applyTableOp throws (ConflictError, TableNotFoundError, RowNotFoundError), before any change.
 */
export function editNote(note: string, op: TableOp, today: string): { text: string; inverse: TableOp } {
  const r = applyTableOp(note, op);
  if (!CONTENT_OPS.has(op.kind) || r.text === note) return r;
  return { text: touchLastUpdated(r.text, today), inverse: r.inverse };
}

/** How the writer reaches a note. Obsidian: vault.read and vault.process. */
export interface NoteIO {
  /** The note's text, fresh from the file. */
  read(path: string): Promise<string>;
  /** One atomic read-modify-write. `fn` never throws: when an edit can't apply it returns the text unchanged. */
  process(path: string, fn: (data: string) => string): Promise<unknown>;
  /** Today as YYYY-MM-DD, for last_updated. */
  today(): string;
}

export interface Written {
  /** The op that undoes this edit (TableWriter.edit it to undo). */
  inverse: TableOp;
  /** About CHECK_AFTER_MS after the write: null when the note still holds the edit, else PARTNER_WARNING. Never rejects. */
  settled: Promise<string | null>;
}

/** One saved edit waiting for its read-back. */
interface Check {
  op: TableOp;
  /** The note just before the write, so stillHolds is exact. */
  before: string;
  /** "partner": a partner's change was seen on top of it. "ours": a later write of ours changed it (an Undo, a second edit). */
  state: "waiting" | "partner" | "ours";
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Writes table ops into notes: one vault.process per edit, one at a time per note, and a read-back about 2 s later.
 * Our own later writes to the same cells (an Undo, editing the same field again) never count as a partner's change.
 */
export class TableWriter {
  private queue = new WriteQueue();
  private checks = new Map<string, Set<Check>>();

  constructor(
    private io: NoteIO,
    private checkAfterMs = CHECK_AFTER_MS,
  ) {}

  /**
   * Applies `op` to the note at `path` once earlier writes to it have finished. Content ops also set last_updated to
   * today. When the op doesn't apply, nothing is written and the error applyTableOp threw is thrown as it is (so
   * `instanceof ConflictError` works). `check: false` skips the read-back (an Undo has no one to tell).
   */
  async edit(path: string, op: TableOp, opts: { check?: boolean } = {}): Promise<Written> {
    const check: Check | null = opts.check === false ? null : { op, before: "", state: "waiting" };
    const inverse = await this.queue.run(path, () => this.write(path, op, check));
    return { inverse, settled: check ? this.settle(path, check) : Promise.resolve(null) };
  }

  /** Read-backs still waiting for this note (for tests). */
  waiting(path: string): number {
    return this.checks.get(path)?.size ?? 0;
  }

  private async write(path: string, op: TableOp, check: Check | null): Promise<TableOp> {
    // Most conflicts show here, so the note isn't written at all, not even with its own text.
    editNote(await this.io.read(path), op, this.io.today());

    // Assigned inside the callback; the casts keep TypeScript from narrowing them to null.
    let failed = null as { error: unknown } | null;
    let inverse = null as TableOp | null;
    let ours: Check[] = [];
    try {
      await this.io.process(path, (data) => {
        this.see(path, data, "partner");
        let r: { text: string; inverse: TableOp };
        try {
          r = editNote(data, op, this.io.today());
        } catch (error) {
          // A partner's change landed since the read above: hand the text back unchanged.
          failed = { error };
          return data;
        }
        ours = this.see(path, r.text, "ours");
        if (check) {
          check.before = data;
          this.pending(path).add(check);
        }
        inverse = r.inverse;
        return r.text;
      });
    } catch (e) {
      // The write didn't land, so it changed none of our earlier edits after all.
      for (const c of ours) if (c.state === "ours") c.state = "waiting";
      if (check) this.forget(path, check);
      throw e;
    }
    if (failed) throw failed.error;
    if (!inverse) throw new Error("Couldn't save the change. Open the note and try again.");
    return inverse;
  }

  /**
   * Marks earlier edits of ours that `text` no longer holds, and returns them. Before our write, that's a partner's
   * change ("partner"); after it, it's our own write that changed them ("ours"), which is never worth a warning.
   */
  private see(path: string, text: string, who: "partner" | "ours"): Check[] {
    const marked: Check[] = [];
    for (const c of this.checks.get(path) ?? []) {
      if (c.state === "waiting" && !stillHolds(text, c.op, c.before)) {
        c.state = who;
        marked.push(c);
      }
    }
    return marked;
  }

  private async settle(path: string, check: Check): Promise<string | null> {
    try {
      await delay(this.checkAfterMs);
      // Queued, so the read never lands in the middle of one of our own writes.
      return await this.queue.run(path, async () => {
        if (check.state === "waiting" && !stillHolds(await this.io.read(path), check.op, check.before)) check.state = "partner";
        return check.state === "partner" ? PARTNER_WARNING : null;
      });
    } catch {
      // The note can't be read (renamed or deleted): there's nothing to compare, and the dashboard shows the note missing.
      return null;
    } finally {
      this.forget(path, check);
    }
  }

  private pending(path: string): Set<Check> {
    let set = this.checks.get(path);
    if (!set) {
      set = new Set();
      this.checks.set(path, set);
    }
    return set;
  }

  private forget(path: string, check: Check): void {
    const set = this.checks.get(path);
    if (!set) return;
    set.delete(check);
    if (!set.size) this.checks.delete(path);
  }
}
