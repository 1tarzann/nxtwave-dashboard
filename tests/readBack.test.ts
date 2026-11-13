import { describe, expect, it } from "vitest";
import { stillHolds } from "../src/data/readBack";
import { applyTableOp, locateTable, RowRef, TableOp } from "../src/data/tableEdit";
import * as S from "./samples";

const R = S.MKT_V2_RESEARCHED;

const set = (heading: string, row: RowRef, values: Record<string, string>, expected: Record<string, string> = {}): TableOp => ({
  kind: "set",
  heading,
  edits: [{ row, values, expect: expected }],
});

/** The note right after a save (ours, or a partner's that Relay merged in). */
const save = (note: string, op: TableOp) => applyTableOp(note, op).text;

/**
 * stillHolds for the note `now`, as written and with CRLF line endings, from the op alone and with the note
 * before our save. All four answers must agree; returns it.
 */
function check(now: string, op: TableOp, before: string): boolean {
  const answers = [stillHolds(now, op), stillHolds(now, op, before), stillHolds(S.crlf(now), op), stillHolds(S.crlf(now), op, S.crlf(before))];
  expect(new Set(answers).size, `as written, exact, CRLF, CRLF exact: ${answers.join(", ")}`).toBe(1);
  return answers[0];
}

/** stillHolds with the note before our save (as the host checks), as written and with CRLF line endings. Both must agree. */
function exact(now: string, op: TableOp, before: string): boolean {
  const answers = [stillHolds(now, op, before), stillHolds(S.crlf(now), op, S.crlf(before))];
  expect(answers[0], "CRLF").toBe(answers[1]);
  return answers[0];
}

/** The note without the table under `heading` (its lines cut out). */
function withoutTable(note: string, heading: string): string {
  const lines = note.split("\n");
  const t = locateTable(lines, heading)!;
  return [...lines.slice(0, t.headerLine), ...lines.slice(t.end)].join("\n");
}

describe("stillHolds: set", () => {
  const cta = set("hook scripts", { key: "6", col: "#" }, { cta: "$29 once. Link in bio." }, { cta: "" });
  const mine = save(R, cta);

  it("holds in the note as saved, after Obsidian's table editor re-padded every table, and with CRLF", () => {
    expect(check(mine, cta, R)).toBe(true);
    expect(check(S.padTables(mine), cta, R)).toBe(true);
  });
  it("doesn't hold when a partner changed the same cell, or cleared it", () => {
    const theirs = save(mine, set("hook scripts", { key: "6", col: "#" }, { cta: "Link in bio, today only." }));
    expect(check(theirs, cta, R)).toBe(false);
    expect(check(S.padTables(theirs), cta, R)).toBe(false);
    expect(check(save(mine, set("hook scripts", { key: "6", col: "#" }, { cta: "" })), cta, R)).toBe(false);
  });
  it("holds when a partner changed another cell of the same row, or another row", () => {
    expect(check(save(mine, set("hook scripts", { key: "6", col: "#" }, { "demo shot": "Phone recording: the S's go soft" })), cta, R)).toBe(true);
    expect(check(save(mine, set("hook scripts", { key: "1", col: "#" }, { cta: "Link in bio, now." })), cta, R)).toBe(true);
  });
  it("a partner typing the same text counts as holding", () => {
    expect(check(save(mine, set("hook scripts", { key: "6", col: "#" }, { cta: "  $29 once. Link in bio. " })), cta, R)).toBe(true);
  });
  it("a row found by its # still holds after a partner deletes a row above it", () => {
    const theirs = save(mine, { kind: "delete", heading: "hook scripts", row: { key: "1", col: "#" }, expect: {} });
    expect(check(theirs, cta, R)).toBe(true);
  });
  it("doesn't hold when the row, the table or the section is gone", () => {
    expect(check(save(mine, { kind: "delete", heading: "hook scripts", row: { key: "6", col: "#" }, expect: {} }), cta, R)).toBe(false);
    expect(check(withoutTable(mine, "hook scripts"), cta, R)).toBe(false);
    expect(check(mine.replace("## 2. Hook scripts (native UGC demo)", "## 2. Openings"), cta, R)).toBe(false);
    expect(check(mine.replace("| CTA |", "| Call |"), cta, R)).toBe(false);
  });
});

describe("stillHolds: set by row position", () => {
  const BETA = "[Beta Audio](https://example.com/beta-audio)";
  const WAS = "Before/after by second 2; 3.1× usual, an ad running 45 days";
  /** The competitor editor shows every field, so the op expects the name too. */
  const named = set("competitor swipe", { index: 1 }, { why: "Before/after by second 2" }, { competitor: BETA, why: WAS });
  const bare = set("competitor swipe", { index: 1 }, { why: "Before/after by second 2" }, { why: WAS });
  const dropFirst: TableOp = { kind: "delete", heading: "competitor swipe", row: { index: 0 }, expect: {} };
  const addFirst: TableOp = { kind: "restore", heading: "competitor swipe", at: 0, raw: "| Delta Example | [12k views](https://example.com/v/20) | x | y |" };

  it("holds as saved and re-padded", () => {
    const mine = save(R, named);
    expect(check(mine, named, R)).toBe(true);
    expect(check(S.padTables(mine), named, R)).toBe(true);
  });
  it("after a partner removed or added a row above, the row is found by its label", () => {
    expect(check(save(save(R, named), dropFirst), named, R)).toBe(true);
    expect(check(save(save(R, named), addFirst), named, R)).toBe(true);
  });
  it("with the note before the save, a row is found by its label even when the op doesn't name it", () => {
    const moved = save(save(R, bare), dropFirst);
    expect(exact(moved, bare, R)).toBe(true);
    // From the op alone, row 2 is the MISSING slot now, which doesn't hold the text.
    expect(stillHolds(moved, bare)).toBe(false);
  });
  it("a partner who moved the row and changed the same cell: doesn't hold", () => {
    const theirs = save(save(save(R, named), dropFirst), set("competitor swipe", { index: 0 }, { why: "Shows the waveform first" }));
    expect(check(theirs, named, R)).toBe(false);
  });
});

describe("stillHolds: what counts as the same value", () => {
  it("escaped pipes and line breaks read the way the dashboard reads them", () => {
    const op = set("competitor swipe", { index: 1 }, { why: "Before/after | by second 2\n3.1× usual" });
    const mine = save(R, op);
    expect(check(mine, op, R)).toBe(true);
    expect(check(S.padTables(mine), op, R)).toBe(true);
  });
  it("a cleared cell holds once its example is back, and not after a partner types into it", () => {
    const op = set("brand kit", { key: "Landing page", col: "asset" }, { link: "" }, { link: "https://example.com/demo-tool" });
    const mine = save(R, op);
    expect(mine).toContain(`| Landing page | <span class="nx-eg">e.g. link to the one-page site</span> |`);
    expect(check(mine, op, R)).toBe(true);
    expect(check(save(mine, set("brand kit", { key: "Landing page", col: "asset" }, { link: "https://example.com/demo-tool-2" })), op, R)).toBe(false);
  });
  it("in one op, a later edit of the same cell wins", () => {
    const op: TableOp = {
      kind: "set",
      heading: "brand kit",
      edits: [
        { row: { key: "logo", col: "asset" }, values: { link: "https://example.com/logo.png" }, expect: { link: "" } },
        { row: { key: "logo", col: "asset" }, values: { link: "https://example.com/logo-2.png" }, expect: {} },
      ],
    };
    expect(check(save(R, op), op, R)).toBe(true);
  });
  it("a label the edit renamed finds its row by the new label", () => {
    const op = set("paid test", { key: "Platform", col: "item" }, { item: "Ad platform", value: "TikTok" }, { value: "Meta" });
    const mine = save(R, op);
    expect(check(mine, op, R)).toBe(true);
    expect(check(save(mine, set("paid test", { key: "Ad platform", col: "item" }, { value: "Google" })), op, R)).toBe(false);
  });
  it("an Undo holds once applied, a whole-line one too, until a partner changes it", () => {
    const cta = set("hook scripts", { key: "6", col: "#" }, { cta: "$29 once. Link in bio." }, { cta: "" });
    const r = applyTableOp(R, cta);
    const back = save(r.text, r.inverse);
    expect(back).toBe(R);
    expect(check(back, r.inverse, r.text)).toBe(true);
    expect(check(save(back, set("hook scripts", { key: "6", col: "#" }, { cta: "Link in bio, today only." })), r.inverse, r.text)).toBe(false);

    const note = "## T\n| # | A | B | C |\n|---|---|---|---|\n| 1 | a |\n| 2 | b | x | y |\n";
    const short = applyTableOp(note, set("t", { key: "1", col: "#" }, { c: "x" }, { c: "" }));
    expect(short.inverse.kind === "set" && short.inverse.edits[0].line).toBe("| 1 | a |");
    const undone = save(short.text, short.inverse);
    expect(check(undone, short.inverse, short.text)).toBe(true);
    expect(check(save(undone, set("t", { key: "1", col: "#" }, { b: "typed" })), short.inverse, short.text)).toBe(false);
  });
});

describe("stillHolds: insert", () => {
  const add: TableOp = { kind: "insert", heading: "content backlog", values: { format: "Waveform close-up, 12s", platform: "TikTok", status: "scripted" }, numberCol: "#" };
  const row4 = { key: "4", col: "#" };
  const mine = save(S.MKT_V1_FILLED, add);

  it("the new row holds as saved, re-padded and with CRLF", () => {
    expect(mine).toContain("| 4 | Waveform close-up, 12s | TikTok | | scripted | |");
    expect(check(mine, add, S.MKT_V1_FILLED)).toBe(true);
    expect(check(S.padTables(mine), add, S.MKT_V1_FILLED)).toBe(true);
  });
  it("doesn't hold once a partner deleted it or changed a cell it wrote; another cell is fine", () => {
    expect(check(save(mine, { kind: "delete", heading: "content backlog", row: row4, expect: {} }), add, S.MKT_V1_FILLED)).toBe(false);
    expect(check(save(mine, set("content backlog", row4, { status: "recorded" })), add, S.MKT_V1_FILLED)).toBe(false);
    expect(check(save(mine, set("content backlog", row4, { "go-live": "2026-11-20" })), add, S.MKT_V1_FILLED)).toBe(true);
  });
  it("a row that already held the same values doesn't count as ours (with the note before the save)", () => {
    const again: TableOp = { kind: "insert", heading: "content backlog", values: { format: "Close-up of the knob, 10s", platform: "Shorts", status: "scripted" }, numberCol: "#" };
    const twice = save(S.MKT_V1_FILLED, again);
    expect(exact(twice, again, S.MKT_V1_FILLED)).toBe(true);
    const gone = save(twice, { kind: "delete", heading: "content backlog", row: row4, expect: {} });
    expect(exact(gone, again, S.MKT_V1_FILLED)).toBe(false);
    // From the op alone, row 3 still holds those values.
    expect(stillHolds(gone, again)).toBe(true);
  });
  it("an added numbered row is read back by its number, so a partner's video added above it doesn't matter", () => {
    expect(applyTableOp(S.MKT_V1_FILLED, add).inverse).toMatchObject({ kind: "delete", row: row4 });
    const above = mine.replace("| 1 | Screen recording", "| 0 | Teaser, 5s | TikTok | | scripted | |\n| 1 | Screen recording");
    expect(above).not.toBe(mine);
    expect(exact(above, add, S.MKT_V1_FILLED)).toBe(true);
    expect(exact(save(above, set("content backlog", row4, { format: "Partner's format" })), add, S.MKT_V1_FILLED)).toBe(false);
  });
  it("filling a free row (the MISSING competitor slot) holds too", () => {
    const op: TableOp = { kind: "insert", heading: "competitor swipe", values: { competitor: "[Gamma Labs](https://example.com/gamma-labs)" } };
    const filled = save(R, op);
    expect(check(filled, op, R)).toBe(true);
    expect(check(save(filled, set("competitor swipe", { index: 2 }, { competitor: "Delta Example" })), op, R)).toBe(false);
  });
});

describe("stillHolds: delete and restore", () => {
  const V1 = S.MKT_V1_FILLED;
  const del: TableOp = { kind: "delete", heading: "content backlog", row: { key: "2", col: "#" }, expect: { format: "Before/after split screen, 15s" } };
  const r = applyTableOp(V1, del);

  it("a deleted row is gone: holds; once a partner put it back: doesn't", () => {
    expect(check(r.text, del, V1)).toBe(true);
    expect(check(S.padTables(r.text), del, V1)).toBe(true);
    expect(check(save(r.text, r.inverse), del, V1)).toBe(false);
  });
  it("the only row of a table is cleared instead, and must stay cleared", () => {
    const one = save(S.MKT_V2_TEMPLATE, { kind: "insert", heading: "content backlog", values: { format: "Screen recording, 20s", status: "scripted" } });
    const clear: TableOp = { kind: "delete", heading: "content backlog", row: { key: "1", col: "#" }, expect: { format: "Screen recording, 20s" } };
    const cleared = save(one, clear);
    expect(check(cleared, clear, one)).toBe(true);
    expect(check(save(cleared, set("content backlog", { key: "1", col: "#" }, { format: "Typed by a partner" })), clear, one)).toBe(false);
  });
  it("by position: identical empty rows are counted with the note before the save; from the op alone, what the user saw decides", () => {
    const T = S.MKT_V2_TEMPLATE;
    const drop: TableOp = { kind: "delete", heading: "competitor swipe", row: { index: 1 }, expect: {} };
    const gone = save(T, drop);
    expect(exact(gone, drop, T)).toBe(true);
    const back = save(gone, { kind: "restore", heading: "competitor swipe", at: 1, raw: "| | | | |" });
    expect(exact(back, drop, T)).toBe(false);
    // Nothing the user saw in it to look for: can't tell, so no warning.
    expect(stillHolds(back, drop)).toBe(true);
    const named: TableOp = { kind: "delete", heading: "competitor swipe", row: { index: 0 }, expect: { competitor: "[Acme Vox](https://example.com/acme-vox)" } };
    const acme = save(R, named);
    expect(check(acme, named, R)).toBe(true);
    expect(check(save(acme, { kind: "restore", heading: "competitor swipe", at: 0, raw: R.split("\n").find((l) => l.startsWith("| [Acme Vox]"))! }), named, R)).toBe(false);
  });
  it("Undo of a delete: the row is back; a partner deleted it again: doesn't hold", () => {
    const back = save(r.text, r.inverse);
    expect(back).toBe(V1);
    expect(check(back, r.inverse, r.text)).toBe(true);
    expect(check(S.padTables(back), r.inverse, r.text)).toBe(true);
    expect(check(save(back, { kind: "delete", heading: "content backlog", row: { key: "2", col: "#" }, expect: {} }), r.inverse, r.text)).toBe(false);
  });
});

describe("stillHolds: markers", () => {
  const reviewed: TableOp = { kind: "marker", heading: "competitor swipe", name: "nx-reviewed", attrs: { competitors: "2026-11-21", hooks: "2026-11-21" }, expect: null };
  const mine = save(R, reviewed);

  it("holds as written, re-padded and with CRLF", () => {
    expect(check(mine, reviewed, R)).toBe(true);
    expect(check(S.padTables(mine), reviewed, R)).toBe(true);
  });
  it("doesn't hold when a partner removed the marker or changed what it says", () => {
    const line = "<!-- nx-reviewed: competitors=2026-11-21 hooks=2026-11-21 -->";
    expect(mine).toContain(line);
    expect(check(mine.replace(`${line}\n`, ""), reviewed, R)).toBe(false);
    expect(check(mine.replace(line, "<!-- nx-reviewed: competitors=2026-11-21 hooks=2026-11-22 -->"), reviewed, R)).toBe(false);
    expect(check(mine.replace(line, "<!--   nx-reviewed: hooks=2026-11-21   competitors=2026-11-21 -->"), reviewed, R)).toBe(true);
  });
  it("a removal holds while the marker stays gone", () => {
    const REQ = S.MKT_V2_REQUESTED;
    const remove: TableOp = { kind: "marker", heading: "competitor swipe", name: "nx-research-request", attrs: null, expect: { date: "2026-11-18", by: "marketing" } };
    const r = applyTableOp(REQ, remove);
    expect(check(r.text, remove, REQ)).toBe(true);
    expect(check(save(r.text, r.inverse), remove, REQ)).toBe(false);
  });
  it("doesn't hold when the section is gone", () => {
    expect(check(mine.replace("## 1. Competitor swipe (3 competitors)", "## 1. Rivals"), reviewed, R)).toBe(false);
  });
});
