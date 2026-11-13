import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyTableOp, ConflictError, RowNotFoundError, RowRef, TableNotFoundError, TableOp } from "../src/data/tableEdit";
import { CHECK_AFTER_MS, editNote, NoteIO, PARTNER_WARNING, TableWriter, touchLastUpdated, WriteQueue } from "../src/obsidian/writeQueue";
import * as S from "./samples";

const R = S.MKT_V2_RESEARCHED;
const P = "HQ/02_Active_Sprints/Demo_Tool/2_Marketing_Engine.md";
const TODAY = "2026-11-21";

const set = (heading: string, row: RowRef, values: Record<string, string>, expected: Record<string, string> = {}): TableOp => ({
  kind: "set",
  heading,
  edits: [{ row, values, expect: expected }],
});

const hook6 = { key: "6", col: "#" };
/** The Marketer fills hook 6's empty CTA. */
const cta = set("hook scripts", hook6, { cta: "$29 once. Link in bio." }, { cta: "" });
/** A partner's change merged in by Relay: the same cell, or another cell of the same row. */
const theirCta = set("hook scripts", hook6, { cta: "Link in bio, today only." });
const theirDemo = set("hook scripts", hook6, { "demo shot": "Phone recording: the S's go soft" });

const save = (note: string, op: TableOp) => applyTableOp(note, op).text;

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/** Lets pending promise callbacks run. */
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

/** vault.read and vault.process over a map, counting process calls and overlapping ones. */
class FakeVault implements NoteIO {
  notes = new Map<string, string>();
  /** Paths whose text a process call changed, in order. */
  writes: string[] = [];
  processCalls = 0;
  private active = 0;
  maxActive = 0;
  /** Runs inside process before the note is read: a partner's change landing between our check and our write. */
  onProcess: (() => void) | null = null;
  /** process rejects with this (a disk error), before calling fn. */
  failProcess: Error | null = null;
  /** process rejects with this after fn ran, without saving what it returned. */
  failAfter: Error | null = null;

  constructor(notes: Record<string, string>) {
    for (const [k, v] of Object.entries(notes)) this.notes.set(k, v);
  }

  async read(path: string): Promise<string> {
    await Promise.resolve();
    const text = this.notes.get(path);
    if (text === undefined) throw new Error(`Can't find ${path}.`);
    return text;
  }

  async process(path: string, fn: (data: string) => string): Promise<string> {
    this.processCalls++;
    this.active++;
    this.maxActive = Math.max(this.maxActive, this.active);
    try {
      this.onProcess?.();
      const data = await this.read(path);
      await flush();
      if (this.failProcess) throw this.failProcess;
      const next = fn(data);
      if (this.failAfter) throw this.failAfter;
      if (next !== data) {
        this.notes.set(path, next);
        this.writes.push(path);
      }
      return next;
    } finally {
      this.active--;
    }
  }

  today(): string {
    return TODAY;
  }
}

describe("WriteQueue", () => {
  it("runs one note's tasks one at a time, in order, while another note's run alongside", async () => {
    const q = new WriteQueue();
    const first = deferred<string>();
    const log: string[] = [];
    const a = q.run("a", () => {
      log.push("a1");
      return first.promise;
    });
    const b = q.run("a", () => {
      log.push("a2");
      return "a2 done";
    });
    const c = q.run("b", () => {
      log.push("b1");
      return "b1 done";
    });
    await flush();
    expect(log).toEqual(["a1", "b1"]);
    expect(q.busy("a")).toBe(true);
    first.resolve("a1 done");
    expect(await Promise.all([a, b, c])).toEqual(["a1 done", "a2 done", "b1 done"]);
    expect(log).toEqual(["a1", "b1", "a2"]);
    await flush();
    expect(q.busy("a")).toBe(false);
  });
  it("a failed task doesn't block the next one, and its own error reaches its caller", async () => {
    const q = new WriteQueue();
    const error = new ConflictError("cta", "", "Link in bio.");
    const failed = q.run("a", () => {
      throw error;
    });
    const next = q.run("a", async () => "next");
    await expect(failed).rejects.toBe(error);
    await expect(next).resolves.toBe("next");
  });
});

describe("touchLastUpdated and editNote", () => {
  /** The lines that differ between two notes of the same length. */
  const changed = (a: string, b: string) => {
    const x = a.split("\n");
    const y = b.split("\n");
    expect(y).toHaveLength(x.length);
    return y.filter((l, i) => l !== x[i]);
  };

  it("sets last_updated to today and keeps its quotes; only that line changes", () => {
    expect(changed(S.MKT_V2_TEMPLATE, touchLastUpdated(S.MKT_V2_TEMPLATE, TODAY))).toEqual([`last_updated: "${TODAY}"`]);
    expect(changed(S.MKT_V1_FILLED, touchLastUpdated(S.MKT_V1_FILLED, TODAY))).toEqual([`last_updated: ${TODAY}`]);
    expect(touchLastUpdated(S.MKT_V1_FILLED, "2026-11-04")).toBe(S.MKT_V1_FILLED);
  });
  it("never adds the key, and leaves a note without frontmatter alone", () => {
    const none = S.MKT_V1_FILLED.replace("last_updated: 2026-11-04\n", "");
    expect(touchLastUpdated(none, TODAY)).toBe(none);
    expect(touchLastUpdated("## Brand kit\n| Asset | Link |\n|---|---|\n", TODAY)).toBe("## Brand kit\n| Asset | Link |\n|---|---|\n");
  });
  it("a CRLF frontmatter keeps its line endings", () => {
    const note = S.crlf(S.MKT_V2_TEMPLATE);
    expect(changed(note, touchLastUpdated(note, TODAY))).toEqual([`last_updated: "${TODAY}"\r`]);
  });
  it("editNote bumps last_updated for content edits that change the note, never for markers or no-ops", () => {
    const r = editNote(R, cta, TODAY);
    expect(r.text).toBe(touchLastUpdated(applyTableOp(R, cta).text, TODAY));
    expect(r.text).toContain(`last_updated: ${TODAY}`);
    // The inverse puts the table back; last_updated stays today.
    expect(applyTableOp(r.text, r.inverse).text).toBe(touchLastUpdated(R, TODAY));

    const marker: TableOp = { kind: "marker", heading: "competitor swipe", name: "nx-reviewed", attrs: { competitors: TODAY }, expect: null };
    expect(editNote(R, marker, TODAY).text).toBe(applyTableOp(R, marker).text);
    const same = set("brand kit", { key: "product", col: "asset" }, { link: "Demo Tool" }, { link: "Demo Tool" });
    expect(editNote(R, same, TODAY).text).toBe(R);
    const added: TableOp = { kind: "insert", heading: "content backlog", values: { format: "Waveform close-up, 12s" }, numberCol: "#" };
    expect(editNote(R, added, TODAY).text).toContain(`last_updated: ${TODAY}`);
  });
  it("editNote throws applyTableOp's own errors", () => {
    expect(() => editNote(R, set("hook scripts", hook6, { cta: "x" }, { cta: "Something else" }), TODAY)).toThrow(ConflictError);
    expect(() => editNote(R, set("hook scripts", { key: "11", col: "#" }, { cta: "x" }), TODAY)).toThrow(RowNotFoundError);
    expect(() => editNote(R, set("press kit", { index: 0 }, { link: "x" }), TODAY)).toThrow(TableNotFoundError);
  });
});

describe("TableWriter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Resolves settled's value once CHECK_AFTER_MS have passed. */
  async function settle(p: Promise<string | null>): Promise<string | null> {
    await vi.advanceTimersByTimeAsync(CHECK_AFTER_MS);
    return p;
  }

  it("one write per edit, last_updated bumped, and settled is null about 2 s later when the note still holds it", async () => {
    const v = new FakeVault({ [P]: R });
    const w = new TableWriter(v);
    const done = await w.edit(P, cta);
    expect(v.processCalls).toBe(1);
    expect(v.notes.get(P)).toBe(touchLastUpdated(save(R, cta), TODAY));
    expect(w.waiting(P)).toBe(1);

    let result: string | null | undefined;
    void done.settled.then((s) => (result = s));
    await vi.advanceTimersByTimeAsync(CHECK_AFTER_MS - 10);
    expect(result).toBeUndefined();
    expect(await settle(done.settled)).toBeNull();
    expect(w.waiting(P)).toBe(0);
  });
  it("warns when a partner changed the same cell before the read-back; another cell or re-padding is fine", async () => {
    const v = new FakeVault({ [P]: R });
    const w = new TableWriter(v);
    const same = await w.edit(P, cta);
    v.notes.set(P, save(v.notes.get(P)!, theirCta));
    expect(await settle(same.settled)).toBe(PARTNER_WARNING);

    const v2 = new FakeVault({ [P]: R });
    const w2 = new TableWriter(v2);
    const other = await w2.edit(P, cta);
    v2.notes.set(P, S.padTables(save(v2.notes.get(P)!, theirDemo)));
    expect(await settle(other.settled)).toBeNull();
  });
  it("our own Undo, or a second edit of the same cell, within 2 s is never taken for a partner's change", async () => {
    const v = new FakeVault({ [P]: R });
    const w = new TableWriter(v);
    const done = await w.edit(P, cta);
    await w.edit(P, done.inverse, { check: false });
    expect(v.notes.get(P)).toBe(touchLastUpdated(R, TODAY));
    expect(await settle(done.settled)).toBeNull();

    const first = await w.edit(P, cta);
    const second = await w.edit(P, set("hook scripts", hook6, { cta: "Link in bio." }, { cta: "$29 once. Link in bio." }));
    expect(await settle(first.settled)).toBeNull();
    expect(await second.settled).toBeNull();
  });
  it("a partner's change seen at our next write still warns, though that write went through", async () => {
    const v = new FakeVault({ [P]: R });
    const w = new TableWriter(v);
    const first = await w.edit(P, cta);
    v.notes.set(P, save(v.notes.get(P)!, theirCta));
    const second = await w.edit(P, set("hook scripts", { key: "1", col: "#" }, { cta: "Link in bio, now." }, { cta: "Link in bio." }));
    expect(await settle(first.settled)).toBe(PARTNER_WARNING);
    expect(await second.settled).toBeNull();
  });
  it("a stale edit throws the ConflictError itself and writes nothing: process isn't even called", async () => {
    const v = new FakeVault({ [P]: R });
    const w = new TableWriter(v);
    const err = await w.edit(P, set("hook scripts", hook6, { cta: "x" }, { cta: "Something else" })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as ConflictError).field).toBe("cta");
    await expect(w.edit(P, set("hook scripts", { key: "11", col: "#" }, { cta: "x" }))).rejects.toBeInstanceOf(RowNotFoundError);
    await expect(w.edit(P, set("press kit", { index: 0 }, { link: "x" }))).rejects.toBeInstanceOf(TableNotFoundError);
    expect(v.processCalls).toBe(0);
    expect(v.notes.get(P)).toBe(R);
    expect(w.waiting(P)).toBe(0);
  });
  it("a partner's change landing between that check and the write: the text goes back unchanged and the ConflictError is thrown", async () => {
    const v = new FakeVault({ [P]: R });
    const w = new TableWriter(v);
    const theirs = save(R, theirCta);
    v.onProcess = () => v.notes.set(P, theirs);
    const err = await w.edit(P, cta).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as ConflictError).actual).toBe("Link in bio, today only.");
    expect(v.processCalls).toBe(1);
    expect(v.writes).toEqual([]);
    expect(v.notes.get(P)).toBe(theirs);
    expect(w.waiting(P)).toBe(0);
  });
  it("writes to one note never overlap, and a failed one doesn't block the next", async () => {
    const v = new FakeVault({ [P]: R });
    const w = new TableWriter(v);
    const results = await Promise.allSettled([
      w.edit(P, cta),
      w.edit(P, set("hook scripts", hook6, { cta: "x" }, { cta: "Something else" })),
      w.edit(P, set("paid test", { key: "platform", col: "item" }, { value: "TikTok" }, { value: "Meta" })),
    ]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
    expect((results[1] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);
    expect(v.maxActive).toBe(1);
    expect(v.notes.get(P)).toContain("| 6 | 🟡 Medium | \"Home studio vocals sound harsh? Try this.\" | Phone recording: knob up, play it back | $29 once. Link in bio. |");
    expect(v.notes.get(P)).toContain("| Platform | TikTok |");
    await vi.advanceTimersByTimeAsync(CHECK_AFTER_MS);
    for (const r of results) if (r.status === "fulfilled") expect(await r.value.settled).toBeNull();
  });
  it("Undo runs in the same queue and refuses after a partner changed the row; our cell still holds, so no warning", async () => {
    const v = new FakeVault({ [P]: R });
    const w = new TableWriter(v);
    const done = await w.edit(P, cta);
    v.notes.set(P, save(v.notes.get(P)!, theirDemo));
    await expect(w.edit(P, done.inverse, { check: false })).rejects.toBeInstanceOf(ConflictError);
    expect(await settle(done.settled)).toBeNull();
  });
  it("marker edits leave last_updated alone and are read back too", async () => {
    const v = new FakeVault({ [P]: R });
    const w = new TableWriter(v);
    const marker: TableOp = { kind: "marker", heading: "competitor swipe", name: "nx-reviewed", attrs: { competitors: TODAY }, expect: null };
    const done = await w.edit(P, marker);
    expect(v.notes.get(P)).toBe(save(R, marker));
    v.notes.set(P, v.notes.get(P)!.replace(`<!-- nx-reviewed: competitors=${TODAY} -->\n`, ""));
    expect(await settle(done.settled)).toBe(PARTNER_WARNING);
  });
  it("settled never rejects: a note that can't be read any more gives null", async () => {
    const v = new FakeVault({ [P]: R });
    const w = new TableWriter(v);
    const done = await w.edit(P, cta);
    v.notes.delete(P);
    expect(await settle(done.settled)).toBeNull();
    expect(w.waiting(P)).toBe(0);
  });
  it("a write that fails in process rejects with that error and leaves no read-back waiting", async () => {
    const v = new FakeVault({ [P]: R });
    const w = new TableWriter(v);
    const disk = new Error("The disk is full.");
    v.failProcess = disk;
    await expect(w.edit(P, cta)).rejects.toBe(disk);
    expect(w.waiting(P)).toBe(0);
    v.failProcess = null;
    const done = await w.edit(P, cta);
    expect(await settle(done.settled)).toBeNull();
  });
  it("a later write of ours that didn't land doesn't hide a partner's change to an earlier one", async () => {
    const v = new FakeVault({ [P]: R });
    const w = new TableWriter(v);
    const first = await w.edit(P, cta);
    const disk = new Error("The disk is full.");
    v.failAfter = disk;
    await expect(w.edit(P, set("hook scripts", hook6, { cta: "Link in bio." }, { cta: "$29 once. Link in bio." }))).rejects.toBe(disk);
    v.failAfter = null;
    expect(v.notes.get(P)).toContain("| $29 once. Link in bio. |");
    v.notes.set(P, save(v.notes.get(P)!, theirCta));
    expect(await settle(first.settled)).toBe(PARTNER_WARNING);
  });
});
