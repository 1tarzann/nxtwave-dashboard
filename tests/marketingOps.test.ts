import { describe, expect, it } from "vitest";
import { parseMarketing } from "../src/data/marketing";
import type { Cell, MarketingNote } from "../src/data/marketing";
import * as O from "../src/data/marketingOps";
import { GENERIC_EXAMPLES as G, PROFILE_EXAMPLES } from "../src/data/noteFormat";
import { parseProfile } from "../src/data/profile";
import { applyTableOp, ConflictError, locateTable, RowNotFoundError, TableNotFoundError } from "../src/data/tableEdit";
import type { TableOp } from "../src/data/tableEdit";
import { plainError } from "../src/ui/inline";
import * as S from "./samples";

// Fake Stripe keys, built so no key-shaped text is ever written in the repo.
const LIVE_KEY = "sk" + "_live_" + "x".repeat(24);
const TEST_KEY = "sk" + "_test_" + "9".repeat(24);
const RESTRICTED = "rk" + "_live_" + "a".repeat(24);
const RESTRICTED_TEST = "RK" + "_TEST_" + "Ab".repeat(12);
const STRIPE_TEXT = "That's a Stripe secret key. Keys never go in the vault. Paste the payment link (https://buy.stripe.com/…) instead.";

const SWIPE = { name: "Competitor", link: "Top ad / video link", hook: "Hook (first 3s)", why: "Why it works" };
const HOOK = { rating: "Rating", hook: "Hook (spoken, first 3s)", demo: "Demo shot", cta: "CTA", basedOn: "Based on" };
const VIDEO = { num: "#", format: "Format", platforms: "Platform(s)", hookNum: "Hook #", status: "Status (scripted / recorded / edited / scheduled)", goLive: "Go-live date" };
const H = { swipe: "competitor swipe", hooks: "hook scripts", backlog: "content backlog", brand: "brand kit", paid: "paid test", pitch: "pitch" };

const span = (t: string) => `<span class="nx-eg">${t}</span>`;

/** Each note as written, padded by Obsidian's table editor, and both again with CRLF line endings. */
const variants = (note: string): Record<string, string> => ({
  "as written": note,
  padded: S.padTables(note),
  crlf: S.crlf(note),
  "padded crlf": S.crlf(S.padTables(note)),
});

/** Applies the op, checks that its inverse gives the note back byte for byte, and returns the new text. */
function apply(note: string, op: TableOp): string {
  const r = applyTableOp(note, op);
  expect(applyTableOp(r.text, r.inverse).text).toBe(note);
  return r.text;
}

/** A row's cells exactly as written between its pipes (padding included); an escaped \| stays in its cell. */
function rawCells(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "\\" && line[i + 1] === "|") {
      cur += "\\|";
      i++;
    } else if (line[i] === "|") {
      out.push(cur);
      cur = "";
    } else cur += line[i];
  }
  out.push(cur);
  return out;
}

/**
 * The cells a set op changed, as "row:Header". Fails when a line outside the table's data rows changed, the line count
 * changed, a changed line lost or gained its "\r", or a CRLF note has a line without one.
 */
function changedCells(before: string, after: string, heading: string): string[] {
  const a = before.split("\n");
  const b = after.split("\n");
  expect(b.length).toBe(a.length);
  if (before.includes("\r\n")) expect(b.slice(0, -1).every((l) => l.endsWith("\r"))).toBe(true);
  const t = locateTable(a, heading)!;
  const out: string[] = [];
  a.forEach((line, i) => {
    if (line === b[i]) return;
    const row = t.rowLines.indexOf(i);
    expect(row, `line ${i} isn't a data row of the table under ${heading}`).not.toBe(-1);
    expect(b[i].endsWith("\r")).toBe(line.endsWith("\r"));
    const x = rawCells(line.replace(/\r$/, ""));
    const y = rawCells(b[i].replace(/\r$/, ""));
    expect(y.length).toBe(x.length);
    // Index 0 is what's before the leading pipe, so cell c sits at c + 1.
    x.forEach((v, k) => {
      if (v !== y[k]) out.push(`${row}:${t.headers[k - 1] ?? `edge ${k}`}`);
    });
  });
  return out;
}

/** The one region where two notes differ: its first line, the old lines and the new ones. */
function diff(before: string, after: string): { at: number; removed: string[]; added: string[] } {
  const a = before.split("\n");
  const b = after.split("\n");
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  return { at: p, removed: a.slice(p, a.length - s), added: b.slice(p, b.length - s) };
}

const mkt = (note: string): MarketingNote => parseMarketing(note);
const profileOf = (spec: string) => parseProfile(spec, S.frontmatterOf(spec), {});
const noCol: Cell = { value: "", raw: "", example: "", col: "" };

describe("cellEdits", () => {
  it("is one set op on one row: values and expect keyed by Cell.col, seen replacing what the user saw", () => {
    const r = mkt(S.MKT_V2_RESEARCHED).competitors![0];
    const op = O.cellEdits(H.swipe, 0, [
      { cell: r.why, value: "Result by second 1" },
      { cell: r.hook, value: `"New opening."`, seen: "what the sheet saw" },
      { cell: noCol, value: "goes nowhere" },
    ]);
    expect(op).toEqual({
      kind: "set",
      heading: H.swipe,
      edits: [
        {
          row: { index: 0 },
          values: { [SWIPE.why]: "Result by second 1", [SWIPE.hook]: `"New opening."` },
          expect: { [SWIPE.why]: r.why.value, [SWIPE.hook]: "what the sheet saw" },
        },
      ],
    });
    expect(O.cellEdits(H.hooks, { key: "3", col: "#" }, [{ cell: r.why, value: "x" }])).toMatchObject({ edits: [{ row: { key: "3", col: "#" } }] });
  });

  it("throws a plain Error when every cell's column is missing", () => {
    expect(() => O.cellEdits(H.swipe, 0, [{ cell: noCol, value: "x" }])).toThrow("Nothing was saved: this part of the note is missing. Open the note to check.");
    expect(() => O.cellEdits(H.swipe, 0, [])).toThrow(Error);
  });

  it("changes only the touched cell, compact or padded, LF or CRLF, and the inverse gives the note back", () => {
    for (const [name, note] of Object.entries(variants(S.MKT_V2_RESEARCHED))) {
      const r = mkt(note).competitors![1];
      const after = apply(note, O.cellEdits(H.swipe, r.index, [{ cell: r.why, value: "Before/after by second 2" }]));
      expect(changedCells(note, after, H.swipe), name).toEqual([`1:${SWIPE.why}`]);
      expect(mkt(after).competitors![1].why.value, name).toBe("Before/after by second 2");
    }
  });

  it("refuses a Stripe secret key", () => {
    const r = mkt(S.MKT_V2_RESEARCHED).competitors![0];
    expect(() => O.cellEdits(H.swipe, 0, [{ cell: r.why, value: `key ${LIVE_KEY}` }])).toThrow(STRIPE_TEXT);
  });
});

describe("splitLink and joinLink", () => {
  const c = (value: string): Cell => ({ value, raw: value, example: "", col: "x" });

  it("read a link cell as two form fields", () => {
    expect(O.splitLink(c("[Acme Vox](https://example.com/acme-vox)"))).toEqual({ label: "Acme Vox", url: "https://example.com/acme-vox" });
    expect(O.splitLink(c("[Beta \\[beta\\]](https://example.com/a%20b%281%29)"))).toEqual({ label: "Beta [beta]", url: "https://example.com/a%20b%281%29" });
    expect(O.splitLink(c("[a \\| b](https://example.com/x)"))).toEqual({ label: "a | b", url: "https://example.com/x" });
    expect(O.splitLink(c("https://example.com/v/1"))).toEqual({ label: "", url: "https://example.com/v/1" });
    expect(O.splitLink(c("Gamma Labs"))).toEqual({ label: "Gamma Labs", url: "" });
    expect(O.splitLink(c("Acme Vox, see https://example.com/a"))).toEqual({ label: "Acme Vox, see https://example.com/a", url: "" });
    expect(O.splitLink(c("[Acme](https://example.com/a) and [Beta](https://example.com/b)"))).toEqual({ label: "[Acme](https://example.com/a) and [Beta](https://example.com/b)", url: "" });
    expect(O.splitLink(c("line one<br>line two"))).toEqual({ label: "line one\nline two", url: "" });
    expect(O.splitLink(c(""))).toEqual({ label: "", url: "" });
  });

  it("joinLink writes mdLink(label, url), the label alone, or the bare link", () => {
    expect(O.joinLink("Gamma Labs", "https://example.com/gamma")).toBe("[Gamma Labs](https://example.com/gamma)");
    expect(O.joinLink(" Gamma Labs ", "")).toBe("Gamma Labs");
    expect(O.joinLink("", " https://example.com/gamma ")).toBe("https://example.com/gamma");
    expect(O.joinLink("", "https://example.com/a b")).toBe("https://example.com/a%20b");
    expect(O.joinLink("", "")).toBe("");
  });

  it("an untouched form reads back exactly as the note has it, so it never conflicts", () => {
    const tricky = S.MKT_V2_RESEARCHED.replace("[Beta Audio](https://example.com/beta-audio)", "[Beta \\[beta\\] \\| Audio](https://example.com/b%281%29)").replace(
      "[92k views · 3.1× usual](https://example.com/v/2)",
      "92k views<br>3.1× usual",
    );
    for (const note of [S.MKT_V1_FILLED, S.MKT_V2_RESEARCHED, S.MKT_V2_TEMPLATE, tricky, S.padTables(tricky), S.crlf(tricky)]) {
      for (const r of mkt(note).competitors!) {
        for (const cell of [r.name, r.link]) {
          const s = O.splitLink(cell);
          const op = O.cellEdits(H.swipe, r.index, [{ cell, value: cell.value, seen: O.joinLink(s.label, s.url) }]);
          expect(() => applyTableOp(note, op), cell.value).not.toThrow();
        }
      }
    }
  });
});

describe("competitorOp", () => {
  it("name and store link become one [name](link) cell; only that cell changes (compact, padded, CRLF)", () => {
    for (const [name, note] of Object.entries(variants(S.MKT_V2_RESEARCHED))) {
      const r = mkt(note).competitors![2];
      const after = apply(note, O.competitorOp(r, { name: "Gamma Labs", storeUrl: "https://example.com/gamma" }));
      expect(changedCells(note, after, H.swipe), name).toEqual([`2:${SWIPE.name}`]);
      const now = mkt(after).competitors![2];
      expect(now.name.value, name).toBe("[Gamma Labs](https://example.com/gamma)");
      expect(now.missing, name).toBeNull();
    }
  });

  it("changing one part keeps the other", () => {
    const m = mkt(S.MKT_V2_RESEARCHED);
    const r = m.competitors![0];
    const url = apply(S.MKT_V2_RESEARCHED, O.competitorOp(r, { storeUrl: "https://example.com/acme-2" }));
    expect(mkt(url).competitors![0].name.value).toBe("[Acme Vox](https://example.com/acme-2)");
    const video = apply(S.MKT_V2_RESEARCHED, O.competitorOp(r, { video: "190k views · 7.6× usual" }));
    expect(mkt(video).competitors![0].link.value).toBe("[190k views · 7.6× usual](https://example.com/v/1)");
    expect(changedCells(S.MKT_V2_RESEARCHED, video, H.swipe)).toEqual([`0:${SWIPE.link}`]);
    // An old note with a bare link: adding the text makes it a link.
    const v1 = mkt(S.MKT_V1_FILLED).competitors![0];
    const old = apply(S.MKT_V1_FILLED, O.competitorOp(v1, { video: "184k views" }));
    expect(mkt(old).competitors![0].link.value).toBe("[184k views](https://example.com/v/1)");
  });

  it("hook and why are plain cells; clearing one puts its green example back", () => {
    for (const [name, note] of Object.entries(variants(S.MKT_V2_RESEARCHED))) {
      const r = mkt(note).competitors![0];
      const after = apply(note, O.competitorOp(r, { hook: "", why: "Shows the result by second 1" }));
      expect(changedCells(note, after, H.swipe), name).toEqual([`0:${SWIPE.hook}`, `0:${SWIPE.why}`]);
      const now = mkt(after).competitors![0];
      expect(now.hook.raw, name).toBe(span(G.competitors.hook));
      expect(now.hook.value, name).toBe("");
      expect(now.why.value, name).toBe("Shows the result by second 1");
    }
  });

  it("a renamed header still works through Cell.col", () => {
    const note = S.MKT_V2_RESEARCHED.replace("Top ad / video link", "Top video");
    const r = mkt(note).competitors![0];
    expect(r.link.col).toBe("Top video");
    const after = apply(note, O.competitorOp(r, { videoUrl: "https://example.com/v/99" }));
    expect(changedCells(note, after, H.swipe)).toEqual(["0:Top video"]);
    expect(mkt(after).competitors![0].link.value).toBe("[184k views · 7.4× usual](https://example.com/v/99)");
  });

  it("a partner's change to the same cell throws ConflictError and writes nothing; another cell is fine", () => {
    const r = mkt(S.MKT_V2_RESEARCHED).competitors![0];
    const op = O.competitorOp(r, { storeUrl: "https://example.com/acme-2" });
    const partner = S.MKT_V2_RESEARCHED.replace("[Acme Vox](https://example.com/acme-vox)", "[Acme Vox Pro](https://example.com/acme-vox)");
    expect(() => applyTableOp(partner, op)).toThrow(ConflictError);
    // It goes by its place, so another cell the sheet showed is checked too (the sheet takes the partner's text first).
    const elsewhere = S.MKT_V2_RESEARCHED.replace("Result by second 1; 7.4× usual, 3 videos at 2×+", "Result by second 1");
    expect(() => applyTableOp(elsewhere, op)).toThrow(ConflictError);
    expect(mkt(apply(elsewhere, O.competitorOp(r, { storeUrl: "https://example.com/acme-2" }, { why: "Result by second 1" }))).competitors![0].why.value).toBe("Result by second 1");
  });

  it("after Keep mine the seen parts are the partner's: the save overwrites knowingly, and a part left out keeps theirs", () => {
    const r = mkt(S.MKT_V2_RESEARCHED).competitors![0];
    const partner = S.MKT_V2_RESEARCHED.replace("[Acme Vox](https://example.com/acme-vox)", "[Acme Vox Pro](https://example.com/acme-vox)");
    const seen = { name: "Acme Vox Pro", storeUrl: "https://example.com/acme-vox" };
    const url = apply(partner, O.competitorOp(r, { storeUrl: "https://example.com/acme-2" }, seen));
    expect(mkt(url).competitors![0].name.value).toBe("[Acme Vox Pro](https://example.com/acme-2)");
    const mine = apply(partner, O.competitorOp(r, { name: "Acme Vox" }, seen));
    expect(mkt(mine).competitors![0].name.value).toBe("[Acme Vox](https://example.com/acme-vox)");
  });

  it("refuses a Stripe secret key, also inside a link", () => {
    const r = mkt(S.MKT_V2_RESEARCHED).competitors![0];
    expect(() => O.competitorOp(r, { storeUrl: `https://example.com/?k=${TEST_KEY}` })).toThrow(STRIPE_TEXT);
  });
});

describe("hookOp", () => {
  const hooks = (note: string) => mkt(note).hooks!.rows;

  it("a rating writes its word with its icon; only the Rating cell changes", () => {
    for (const [name, note] of Object.entries(variants(S.MKT_V2_RESEARCHED))) {
      const after = apply(note, O.hookOp(hooks(note)[3], { rating: "recommended" }));
      expect(changedCells(note, after, H.hooks), name).toEqual([`3:${HOOK.rating}`]);
      expect(hooks(after)[3].ratingCell.value, name).toBe("🟢 Recommended");
      expect(hooks(after)[3].rating, name).toBe("recommended");
    }
  });

  it("setting Don't use puts — in an empty Demo shot or CTA and keeps a filled one", () => {
    for (const [name, note] of Object.entries(variants(S.MKT_V2_RESEARCHED))) {
      const after = apply(note, O.hookOp(hooks(note)[5], { rating: "avoid" }));
      expect(changedCells(note, after, H.hooks), name).toEqual([`5:${HOOK.rating}`, `5:${HOOK.cta}`]);
      const now = hooks(after)[5];
      expect([now.rating, now.ratingCell.value, now.demo.value, now.cta.value], name).toEqual(["avoid", "🔴 Don't use", "Phone recording: knob up, play it back", "—"]);
    }
    const typedEmpty = apply(S.MKT_V2_RESEARCHED, O.hookOp(hooks(S.MKT_V2_RESEARCHED)[5], { rating: "avoid", demo: "" }));
    expect(hooks(typedEmpty)[5].demo.value).toBe("—");
  });

  it("leaving Don't use clears the — so the template's examples show again", () => {
    for (const [name, note] of Object.entries(variants(S.MKT_V2_RESEARCHED))) {
      const after = apply(note, O.hookOp(hooks(note)[8], { rating: "medium" }));
      expect(changedCells(note, after, H.hooks), name).toEqual([`8:${HOOK.rating}`, `8:${HOOK.demo}`, `8:${HOOK.cta}`]);
      const now = hooks(after)[8];
      expect([now.ratingCell.value, now.demo.raw, now.cta.raw], name).toEqual(["🟡 Medium", span(G.hooks.demo), span(G.hooks.cta)]);
    }
  });

  it("text cells: an edit, and clearing one puts its green example back", () => {
    for (const [name, note] of Object.entries(variants(S.MKT_V2_RESEARCHED))) {
      const after = apply(note, O.hookOp(hooks(note)[0], { hook: `"One knob. No more harsh S's."`, basedOn: "" }));
      expect(changedCells(note, after, H.hooks), name).toEqual([`0:${HOOK.hook}`, `0:${HOOK.basedOn}`]);
      const now = hooks(after)[0];
      expect(now.hook.value, name).toBe(`"One knob. No more harsh S's."`);
      expect(now.basedOn.raw, name).toBe(span(G.hooks.basedOn));
    }
  });

  it("old v1 notes: the rating is ignored, text edits work, and a rating alone saves nothing", () => {
    for (const [name, note] of Object.entries(variants(S.MKT_V1_FILLED))) {
      const r = hooks(note)[1];
      expect(r.ratingCell.col).toBe("");
      const after = apply(note, O.hookOp(r, { rating: "avoid", cta: "Link in bio." }));
      expect(changedCells(note, after, H.hooks), name).toEqual([`1:${HOOK.cta}`]);
      expect(mkt(after).hooks!.layout, name).toBe("v1");
      expect(() => O.hookOp(r, { rating: "avoid" }), name).toThrow("Nothing was saved");
    }
  });

  it("finds the row by its #, so a partner deleting a row above doesn't move the edit", () => {
    const r = hooks(S.MKT_V2_RESEARCHED)[3];
    const op = O.hookOp(r, { cta: "Link in bio. $29 once." });
    const lines = S.MKT_V2_RESEARCHED.split("\n");
    const partner = lines.filter((l) => !l.startsWith("| 2 | 🟢")).join("\n");
    expect(partner).not.toBe(S.MKT_V2_RESEARCHED);
    const after = apply(partner, op);
    expect(mkt(after).hooks!.rows.find((x) => x.num === "4")!.cta.value).toBe("Link in bio. $29 once.");
    expect(mkt(after).hooks!.rows.find((x) => x.num === "5")!.cta.value).toBe("Link in bio.");
  });

  it("a partner's change to the same cell throws ConflictError", () => {
    const r = hooks(S.MKT_V2_RESEARCHED)[3];
    const text = S.MKT_V2_RESEARCHED.replace(`"Stop drawing volume dips on every S."`, `"Stop drawing dips."`);
    expect(() => applyTableOp(text, O.hookOp(r, { hook: `"Mine."` }))).toThrow(ConflictError);
    const rating = S.MKT_V2_RESEARCHED.replace(`| 4 | 🟡 Medium |`, `| 4 | 🔴 Don't use |`);
    expect(() => applyTableOp(rating, O.hookOp(r, { rating: "recommended" }))).toThrow(ConflictError);
  });

  it("seen.rating after Keep mine: a rating key expects its label, any other text is expected as written", () => {
    const r = hooks(S.MKT_V2_RESEARCHED)[3];
    const partner = S.MKT_V2_RESEARCHED.replace(`| 4 | 🟡 Medium |`, `| 4 | 🔴 Don't use |`);
    expect(hooks(apply(partner, O.hookOp(r, { rating: "recommended" }, { rating: "avoid" })))[3].ratingCell.value).toBe("🟢 Recommended");
    const typed = S.MKT_V2_RESEARCHED.replace(`| 4 | 🟡 Medium |`, `| 4 | Medium (try it) |`);
    expect(hooks(apply(typed, O.hookOp(r, { rating: "recommended" }, { rating: "Medium (try it)" })))[3].ratingCell.value).toBe("🟢 Recommended");
    // The rating the user saw, given as its key: the cell as written is expected.
    expect(hooks(apply(S.MKT_V2_RESEARCHED, O.hookOp(r, { rating: "avoid" }, { rating: "medium" })))[3].ratingCell.value).toBe("🔴 Don't use");
  });

  it("a rating that isn't one of the 4 is never written", () => {
    const r = hooks(S.MKT_V2_RESEARCHED)[3];
    expect(() => O.hookOp(r, { rating: "TBD" as never })).toThrow("Nothing was saved");
    expect(O.hookOp(r, { rating: "TBD" as never, cta: "Link in bio!" })).toMatchObject({ edits: [{ values: { [HOOK.cta]: "Link in bio!" } }] });
  });

  it("renamed headers still work through Cell.col", () => {
    const note = S.MKT_V2_RESEARCHED.replace("Hook (spoken, first 3s)", "Spoken hook").replace("| Based on |", "| Based on evidence |");
    const r = mkt(note).hooks!.rows[1];
    expect([r.hook.col, r.basedOn.col]).toEqual(["Spoken hook", "Based on evidence"]);
    const after = apply(note, O.hookOp(r, { hook: `"New."`, basedOn: "[Acme Vox 2.6×](https://example.com/v/3)" }));
    expect(changedCells(note, after, H.hooks)).toEqual(["1:Spoken hook", "1:Based on evidence"]);
  });
});

describe("useHookOp", () => {
  it("fills the template's example video row with the hook's number; # and the other examples stay", () => {
    for (const [name, note] of Object.entries(variants(S.MKT_V2_TEMPLATE))) {
      const m = mkt(note);
      const after = apply(note, O.useHookOp(m, m.hooks!.rows[1]));
      expect(changedCells(note, after, H.backlog), name).toEqual([`0:${VIDEO.hookNum}`]);
      const v = mkt(after).backlog![0];
      expect([v.num, v.hookNum, v.format.raw], name).toEqual(["1", "2", span(G.backlog.format)]);
    }
  });

  it("fills the next free video row (examples only)", () => {
    const m = mkt(S.MKT_V2_RESEARCHED);
    const after = apply(S.MKT_V2_RESEARCHED, O.useHookOp(m, m.hooks!.rows[3]));
    expect(changedCells(S.MKT_V2_RESEARCHED, after, H.backlog)).toEqual([`1:${VIDEO.hookNum}`]);
    expect(mkt(after).backlog![1]).toMatchObject({ num: "2", hookNum: "4" });
  });

  it("adds a numbered row when every row is taken, in the table's own style", () => {
    for (const [name, note] of Object.entries(variants(S.MKT_V1_FILLED))) {
      const m = mkt(note);
      const after = apply(note, O.useHookOp(m, m.hooks!.rows[2]));
      const d = diff(note, after);
      expect(d.removed, name).toEqual([]);
      expect(d.added.length, name).toBe(1);
      expect(mkt(after).backlog!.map((v) => [v.num, v.hookNum]), name).toEqual([["1", "1"], ["2", "2"], ["3", "3"], ["4", "3"]]);
    }
    expect(diff(S.MKT_V1_FILLED, apply(S.MKT_V1_FILLED, O.useHookOp(mkt(S.MKT_V1_FILLED), mkt(S.MKT_V1_FILLED).hooks!.rows[2]))).added).toEqual(["| 4 | | | 3 | scripted | |"]);
  });

  it("refuses a hook without a number and a note without a content backlog", () => {
    const m = mkt(S.MKT_V2_RESEARCHED);
    expect(() => O.useHookOp(m, { ...m.hooks!.rows[0], num: "" })).toThrow("This hook has no number in the note yet, so a video can't point to it.");
    expect(() => O.useHookOp({ ...m, backlog: null }, m.hooks!.rows[0])).toThrow(/no content backlog yet/);
  });
});

describe("backlogOp and backlogStatusOp", () => {
  it("a status step writes the plain word; only the Status cell changes", () => {
    for (const [name, note] of Object.entries(variants(S.MKT_V2_RESEARCHED))) {
      const v = mkt(note).backlog![0];
      const after = apply(note, O.backlogStatusOp(v, "edited"));
      expect(changedCells(note, after, H.backlog), name).toEqual([`0:${VIDEO.status}`]);
      expect(mkt(after).backlog![0].status, name).toBe("edited");
      expect(mkt(after).backlog![0].statusCell.value, name).toBe("edited");
    }
  });

  it("edits format, platforms, hook # and go-live date; clearing one puts its green example back", () => {
    for (const [name, note] of Object.entries(variants(S.MKT_V1_FILLED))) {
      const v = mkt(note).backlog![1];
      const after = apply(note, O.backlogOp(v, { platforms: "TikTok, Reels, Shorts", hookNum: "3", goLive: "2026-11-15" }));
      expect(changedCells(note, after, H.backlog), name).toEqual([`1:${VIDEO.platforms}`, `1:${VIDEO.hookNum}`, `1:${VIDEO.goLive}`]);
      expect(mkt(after).backlog![1]).toMatchObject({ platforms: ["TikTok", "Reels", "Shorts"], hookNum: "3", goLive: { value: "2026-11-15" } });
    }
    const v = mkt(S.MKT_V2_RESEARCHED).backlog![0];
    const cleared = apply(S.MKT_V2_RESEARCHED, O.backlogOp(v, { format: "" }));
    expect(mkt(cleared).backlog![0].format.raw).toBe(span("e.g. before/after split screen, 15s"));
  });

  it("finds the video by its #, so a partner deleting a video above doesn't move the edit", () => {
    const v = mkt(S.MKT_V1_FILLED).backlog![2];
    const partner = S.MKT_V1_FILLED.replace("| 1 | Screen recording + your voice, 20s | TikTok, Reels, Shorts | 1 | scheduled | 2026-11-14 |\n", "");
    expect(partner).not.toBe(S.MKT_V1_FILLED);
    const after = apply(partner, O.backlogStatusOp(v, "recorded"));
    expect(mkt(after).backlog!.map((x) => [x.num, x.status])).toEqual([["2", "recorded"], ["3", "recorded"]]);
  });

  it("a partner's change to the same cell throws ConflictError", () => {
    const v = mkt(S.MKT_V1_FILLED).backlog![1];
    const partner = S.MKT_V1_FILLED.replace("| TikTok, Reels | 2 | recorded |", "| TikTok, Reels | 2 | edited |");
    expect(partner).not.toBe(S.MKT_V1_FILLED);
    expect(() => applyTableOp(partner, O.backlogStatusOp(v, "scheduled"))).toThrow(ConflictError);
  });

  it("renamed headers still work through Cell.col", () => {
    const note = S.MKT_V1_FILLED.replace(VIDEO.status, "Video status").replace(VIDEO.goLive, "Post date");
    const v = mkt(note).backlog![0];
    expect([v.statusCell.col, v.goLive.col]).toEqual(["Video status", "Post date"]);
    const after = apply(note, O.backlogOp(v, { status: "edited", goLive: "2026-11-15" }));
    expect(changedCells(note, after, H.backlog)).toEqual(["0:Video status", "0:Post date"]);
  });
});

describe("addVideoOp", () => {
  it("fills the template's example row first, keeping its # and the examples it didn't get", () => {
    for (const [name, note] of Object.entries(variants(S.MKT_V2_TEMPLATE))) {
      const after = apply(note, O.addVideoOp({ format: "Duet with a fan's vocal, 15s", platforms: "", status: "scripted" }, mkt(note)));
      expect(changedCells(note, after, H.backlog), name).toEqual([`0:${VIDEO.format}`, `0:${VIDEO.status}`]);
      expect(mkt(after).backlog![0]).toMatchObject({ num: "1", status: "scripted", platformsCell: { value: "", raw: span(G.backlog.platforms) } });
    }
  });

  it("adds a numbered row after the last one when every row is taken", () => {
    for (const [name, note] of Object.entries(variants(S.MKT_V1_FILLED))) {
      const after = apply(note, O.addVideoOp({ format: "Duet, 15s", hookNum: "2", status: "scripted" }, mkt(note)));
      const v = mkt(after).backlog!;
      expect(v.length, name).toBe(4);
      expect(v[3], name).toMatchObject({ num: "4", hookNum: "2", status: "scripted", format: { value: "Duet, 15s" } });
    }
    expect(diff(S.MKT_V1_FILLED, apply(S.MKT_V1_FILLED, O.addVideoOp({ format: "Duet, 15s", hookNum: "2", status: "scripted" })))).toMatchObject({
      removed: [],
      added: ["| 4 | Duet, 15s | | 2 | scripted | |"],
    });
  });

  it("takes the note's own headers from its rows", () => {
    const note = S.MKT_V1_FILLED.replace(VIDEO.goLive, "Post date");
    const m = mkt(note);
    expect(mkt(apply(note, O.addVideoOp({ goLive: "2026-11-20" }, m))).backlog![3].goLive.value).toBe("2026-11-20");
    expect(() => applyTableOp(note, O.addVideoOp({ goLive: "2026-11-20" }))).toThrow(TableNotFoundError);
  });

  it("needs at least one typed value, and refuses a Stripe secret key", () => {
    expect(() => O.addVideoOp({ format: " ", status: "" })).toThrow("Type at least one thing about the video first.");
    expect(() => O.addVideoOp({ format: RESTRICTED })).toThrow(STRIPE_TEXT);
  });
});

describe("deleteRowOp", () => {
  it("deletes the row, expecting every cell the user was shown; the inverse puts it back", () => {
    for (const [name, note] of Object.entries(variants(S.MKT_V1_FILLED))) {
      const v = mkt(note).backlog![1];
      const shown = Object.values(O.backlogCells(v));
      const op = O.deleteRowOp(H.backlog, v.index, shown);
      expect(op).toMatchObject({ kind: "delete", heading: H.backlog, row: { index: 1 } });
      const after = apply(note, op);
      expect(diff(note, after).removed.length, name).toBe(1);
      expect(mkt(after).backlog!.map((x) => x.num), name).toEqual(["1", "3"]);
    }
  });

  it("a partner's change to a shown cell throws ConflictError", () => {
    const v = mkt(S.MKT_V1_FILLED).backlog![1];
    const op = O.deleteRowOp(H.backlog, v.index, [v.format, v.statusCell]);
    const partner = S.MKT_V1_FILLED.replace("Before/after split screen, 15s", "Before/after, 12s");
    expect(() => applyTableOp(partner, op)).toThrow(ConflictError);
  });

  it("a renamed header still works through Cell.col", () => {
    const note = S.MKT_V1_FILLED.replace(VIDEO.format, "Video format");
    const v = mkt(note).backlog![0];
    expect(v.format.col).toBe("Video format");
    expect(mkt(apply(note, O.deleteRowOp(H.backlog, v.index, Object.values(O.backlogCells(v))))).backlog!.map((x) => x.num)).toEqual(["2", "3"]);
  });

  it("skips missing columns, and refuses to delete without anything to check", () => {
    const v = mkt(S.MKT_V1_FILLED).backlog![1];
    expect(O.deleteRowOp(H.backlog, 1, [v.format, noCol])).toEqual({ kind: "delete", heading: H.backlog, row: { index: 1 }, expect: { [VIDEO.format]: v.format.value } });
    expect(() => O.deleteRowOp(H.backlog, 1, [noCol])).toThrow(Error);
  });
});

describe("kvOp", () => {
  it("brand kit: a payment link replaces the example; clearing puts the template's example back", () => {
    for (const [name, note] of Object.entries(variants(S.MKT_V2_RESEARCHED))) {
      const row = mkt(note).brandKit![5];
      const after = apply(note, O.kvOp("brandKit", row, "https://buy.stripe.com/test_demo"));
      expect(changedCells(note, after, H.brand), name).toEqual(["5:Link / status"]);
      expect(mkt(after).brandKit![5].value.value, name).toBe("https://buy.stripe.com/test_demo");
      const cleared = apply(after, O.kvOp("brandKit", mkt(after).brandKit![5], ""));
      expect(mkt(cleared).brandKit![5].value.raw, name).toBe(span(G.brandKit.stripe));
    }
  });

  it("paid test plan: finds the row by its label, even after a partner adds a row above", () => {
    const row = mkt(S.MKT_V2_RESEARCHED).paidTest![3];
    const op = O.kvOp("paidTest", row, "$150");
    expect(op).toMatchObject({ edits: [{ row: { key: "Budget (max $300 per sprint)", col: "item" }, values: { Value: "$150" }, expect: { Value: "$100" } }] });
    for (const [name, note] of Object.entries(variants(S.MKT_V2_RESEARCHED))) {
      const after = apply(note, O.kvOp("paidTest", mkt(note).paidTest![3], "$150"));
      expect(changedCells(note, after, H.paid), name).toEqual(["3:Value"]);
    }
    const partner = S.MKT_V2_RESEARCHED.replace("| Platform | Meta |", "| Audience | Home studios |\n| Platform | Meta |");
    expect(mkt(apply(partner, op)).paidTest!.map((r) => r.value.value)).toEqual(["", "Home studios", "Meta", "", "$150"]);
  });

  it("a partner's change throws ConflictError; seen replaces what the user saw", () => {
    const row = mkt(S.MKT_V2_RESEARCHED).paidTest![1];
    const partner = S.MKT_V2_RESEARCHED.replace("| Platform | Meta |", "| Platform | TikTok |");
    expect(() => applyTableOp(partner, O.kvOp("paidTest", row, "Google"))).toThrow(ConflictError);
    expect(mkt(apply(partner, O.kvOp("paidTest", row, "Google", "TikTok"))).paidTest![1].value.value).toBe("Google");
  });

  it("refuses Stripe secret and restricted keys in any case, also inside a link", () => {
    const row = mkt(S.MKT_V2_RESEARCHED).brandKit![5];
    for (const v of [LIVE_KEY, TEST_KEY, RESTRICTED, RESTRICTED_TEST, `[pay](https://example.com/${LIVE_KEY})`]) expect(() => O.kvOp("brandKit", row, v), v).toThrow(STRIPE_TEXT);
  });

  it("a renamed header still works through Cell.col", () => {
    const note = S.MKT_V2_RESEARCHED.replace("| Asset | Link / status |", "| Asset | Link or where it is |");
    const row = mkt(note).brandKit![1];
    expect(row.value.col).toBe("Link or where it is");
    const after = apply(note, O.kvOp("brandKit", row, "https://example.com/demo-tool/logo.png"));
    expect(changedCells(note, after, H.brand)).toEqual(["1:Link or where it is"]);
  });

  it("a row without a label goes by its index", () => {
    expect(O.kvOp("brandKit", { index: 4, label: "", value: { value: "", raw: "", example: "", col: "Link / status" } }, "x")).toMatchObject({ edits: [{ row: { index: 4 } }] });
  });
});

describe("profileOp", () => {
  it("edits one profile row under the pitch; only its value cell changes", () => {
    for (const [name, spec] of Object.entries(variants(S.SPEC_FILLED))) {
      const after = apply(spec, O.profileOp(profileOf(spec), "price", "$39 one-time"));
      expect(changedCells(spec, after, H.pitch), name).toEqual(["2:Value"]);
      expect(profileOf(after).price, name).toBe("$39 one-time");
    }
  });

  it("a row holding only its example gets the text; clearing puts the template's example back", () => {
    for (const [name, spec] of Object.entries(variants(S.SPEC_SPAN_ONLY))) {
      const after = apply(spec, O.profileOp(profileOf(spec), "buyer", "Home-studio vocalists"));
      expect(changedCells(spec, after, H.pitch), name).toEqual(["0:Value"]);
      expect(profileOf(after).buyer, name).toBe("Home-studio vocalists");
      const cleared = apply(after, O.profileOp(profileOf(after), "buyer", ""));
      expect(cleared.split("\n").some((l) => l.includes(span(PROFILE_EXAMPLES.buyer))), name).toBe(true);
      expect(profileOf(cleared).buyer, name).toBe("");
    }
  });

  it("works with renamed headers, and a partner's change throws ConflictError", () => {
    const spec = S.SPEC_FILLED.replace("| Item | Value |", "| Field | Answer |");
    const p = profileOf(spec);
    expect(p.profileColumns).toEqual({ label: "Field", value: "Answer" });
    expect(changedCells(spec, apply(spec, O.profileOp(p, "job", "Softens harsh S sounds")), H.pitch)).toEqual(["1:Answer"]);
    const partner = S.SPEC_FILLED.replace("| Price | $29 one-time |", "| Price | $19 one-time |");
    expect(() => applyTableOp(partner, O.profileOp(profileOf(S.SPEC_FILLED), "price", "$39"))).toThrow(ConflictError);
  });

  it("throws a plain Error when the Dev Spec has no profile table", () => {
    expect(() => O.profileOp(profileOf(S.SPEC_NO_TABLE), "buyer", "x")).toThrow(
      "The Dev Spec doesn't have the 3 profile lines yet: paste them from the Dev Spec template under the pitch.",
    );
  });
});

describe("research markers", () => {
  it("Ask for research writes a request marker at the end of section 1, and it reads as pending", () => {
    for (const [name, note] of Object.entries(variants(S.MKT_V2_TEMPLATE))) {
      const after = apply(note, O.requestResearchOp(mkt(note), "2026-11-13", "marketing"));
      expect(diff(note, after).added.map((l) => l.replace(/\r$/, "")), name).toEqual(["<!-- nx-research-request: date=2026-11-13 by=marketing -->", ""]);
      expect(mkt(after).request, name).toEqual({ date: "2026-11-13", by: "marketing" });
      expect(O.researchState(mkt(after)).pending, name).toBe(true);
    }
  });

  it("asking again after research updates the request in place", () => {
    const after = apply(S.MKT_V2_RESEARCHED, O.requestResearchOp(mkt(S.MKT_V2_RESEARCHED), "2026-11-22", "dev"));
    expect(diff(S.MKT_V2_RESEARCHED, after)).toMatchObject({
      removed: ["<!-- nx-research-request: date=2026-11-18 by=marketing -->"],
      added: ["<!-- nx-research-request: date=2026-11-22 by=dev -->"],
    });
    expect(O.researchState(mkt(after)).pending).toBe(true);
  });

  it("expects the marker the user saw: a partner's request since then throws ConflictError", () => {
    const op = O.requestResearchOp(mkt(S.MKT_V2_TEMPLATE), "2026-11-13", "marketing");
    expect(() => applyTableOp(S.MKT_V2_REQUESTED, op)).toThrow(ConflictError);
    const reviewed = O.reviewedOp(mkt(S.MKT_V2_RESEARCHED), "hooks", "2026-11-22");
    expect(() => applyTableOp(S.MKT_V2_REVIEWED, reviewed)).toThrow(ConflictError);
  });

  it("Looks good sets one part's date and keeps the other part's", () => {
    for (const [name, note] of Object.entries(variants(S.MKT_V2_REVIEWED))) {
      const after = apply(note, O.reviewedOp(mkt(note), "hooks", "2026-11-22"));
      expect(diff(note, after).added.map((l) => l.replace(/\r$/, "")), name).toEqual(["<!-- nx-reviewed: competitors=2026-11-21 hooks=2026-11-22 -->"]);
      expect(O.researchState(mkt(after)).reviewed, name).toEqual({ competitors: true, hooks: true });
    }
    const first = apply(S.MKT_V2_RESEARCHED, O.reviewedOp(mkt(S.MKT_V2_RESEARCHED), "competitors", "2026-11-22"));
    expect(diff(S.MKT_V2_RESEARCHED, first)).toMatchObject({ added: ["<!-- nx-reviewed: competitors=2026-11-22 -->"], removed: [] });
    expect(first.split("\n").indexOf("<!-- nx-reviewed: competitors=2026-11-22 -->")).toBe(first.split("\n").indexOf("<!-- nx-research-request: date=2026-11-18 by=marketing -->") + 1);
  });

  it("keeps attributes this version doesn't know", () => {
    const note = S.MKT_V2_REVIEWED.replace("<!-- nx-reviewed: competitors=2026-11-21 -->", "<!-- nx-reviewed: hooks=2026-11-19 by=marketing competitors=2026-11-21 -->");
    const op = O.reviewedOp(mkt(note), "hooks", "2026-11-22");
    expect(op).toMatchObject({ kind: "marker", name: "nx-reviewed", attrs: { competitors: "2026-11-21", hooks: "2026-11-22", by: "marketing" } });
    expect(apply(note, op)).toContain("<!-- nx-reviewed: competitors=2026-11-21 hooks=2026-11-22 by=marketing -->");
  });

  it("requestBy: the device's role when it's dev or marketing, else marketing", () => {
    expect([O.requestBy("dev"), O.requestBy("marketing"), O.requestBy("both"), O.requestBy("")]).toEqual(["dev", "marketing", "marketing", "marketing"]);
  });
});

describe("researchState", () => {
  const state = (note: string | null) => O.researchState(note === null ? null : mkt(note));
  const none = { competitors: false, hooks: false };

  it("follows the marker rules agreed with competitor-scout", () => {
    expect(state(null)).toEqual({ pending: false, reviewed: none });
    expect(state(S.MKT_V2_TEMPLATE)).toEqual({ pending: false, reviewed: none });
    expect(state(S.MKT_V2_REQUESTED)).toEqual({ pending: true, reviewed: none });
    // Research on 11-20 after the request of 11-18: answered.
    expect(state(S.MKT_V2_RESEARCHED)).toEqual({ pending: false, reviewed: none });
    // A run deletes the request, so one still there on the research day came after the run.
    expect(state(S.MKT_V2_RESEARCHED.replace("nx-research-request: date=2026-11-18", "nx-research-request: date=2026-11-20")).pending).toBe(true);
    expect(state(S.MKT_V2_REVIEWED)).toEqual({ pending: false, reviewed: { competitors: true, hooks: false } });
  });

  it("a review counts on or after the research date only; before any research, any review counts", () => {
    const at = (c: string, h: string) => S.MKT_V2_REVIEWED.replace("competitors=2026-11-21", `competitors=${c} hooks=${h}`);
    expect(state(at("2026-11-20", "2026-11-19")).reviewed).toEqual({ competitors: true, hooks: false });
    const noResearch = S.MKT_V2_REQUESTED.replace("<!-- nx-research-request: date=2026-11-18 by=marketing -->", "<!-- nx-reviewed: hooks=2026-11-10 -->");
    expect(state(noResearch)).toEqual({ pending: false, reviewed: { competitors: false, hooks: true } });
  });
});

describe("checks", () => {
  it("stripeSecret: secret and restricted keys, live or test, any case, anywhere; payment links and publishable keys are fine", () => {
    for (const s of [LIVE_KEY, TEST_KEY, RESTRICTED, RESTRICTED_TEST, `key: ${LIVE_KEY}.`, `https://example.com/?k=${TEST_KEY}`, `[pay](https://example.com/${RESTRICTED})`]) {
      expect(O.stripeSecret(s), s).toBe(true);
      expect(O.stripeCheck(s), s).toEqual({ level: "error", text: STRIPE_TEXT });
    }
    const publishable = "pk" + "_live_" + "x".repeat(24);
    for (const s of ["https://buy.stripe.com/test_demo", publishable, "sk_live", "Stripe test mode", ""]) {
      expect(O.stripeSecret(s), s).toBe(false);
      expect(O.stripeCheck(s), s).toBeNull();
    }
  });

  it("budgetCheck: over $300 is refused, the largest amount counts, text without an amount gets a nudge", () => {
    const capped = { level: "error", text: "The paid test is capped at $300 per sprint." };
    for (const s of ["$100", "$300", "300", "250 USD", "$100 first, $300 at most", "$100 from day 15", "$1.5", "", "TBD", span("e.g. $100 first, $300 at most")]) expect(O.budgetCheck(s), s).toBeNull();
    for (const s of ["$301", "$350", "350", "$1,000", "$0.5k", "400 dollars", "$100 now, $400 later"]) expect(O.budgetCheck(s), s).toEqual(capped);
    expect(O.budgetCheck("soon")).toEqual({ level: "warn", text: "Write the budget as a dollar amount, like $100." });
  });

  it("startDayCheck: warns before sprint day 15", () => {
    const warn = { level: "warn", text: "Paid ads start on day 15, after launch." };
    expect(O.startDayCheck("2026-11-14", "2026-11-01")).toEqual(warn);
    expect(O.startDayCheck("2026-10-30", "2026-11-01")).toEqual(warn);
    expect(O.startDayCheck("2026-11-15", "2026-11-01")).toBeNull();
    expect(O.startDayCheck("day 12", null)).toEqual(warn);
    expect(O.startDayCheck("Day 15", null)).toBeNull();
    expect(O.startDayCheck("2026-11-10", null)).toBeNull();
    expect(O.startDayCheck("", "2026-11-01")).toBeNull();
    expect(O.startDayCheck(span("e.g. day 15"), "2026-11-01")).toBeNull();
    expect(O.startDayCheck("next week", "2026-11-01")).toBeNull();
  });

  it("hookWords counts spoken words, not quote marks or punctuation; over the limit warns with the count", () => {
    const m = mkt(S.MKT_V2_RESEARCHED);
    expect(O.hookWords(m.hooks!.rows[0].hook.value)).toBe(12);
    expect(O.hookWords(`“Watch — this.”`)).toBe(2);
    expect(O.hookWords(`" One knob. That's the whole plugin. "`)).toBe(6);
    expect(O.hookWords("One<br>two")).toBe(2);
    expect(O.hookWords("  ")).toBe(0);
    expect(O.hookWords(span("e.g. ten words that only show the shape of an answer here"))).toBe(0);
    const fourteen = `"I couldn't find a de-esser with one knob anywhere, so I built one myself."`;
    expect(O.hookWords(fourteen)).toBe(14);
    expect(O.hookWordsCheck(fourteen)).toEqual({ level: "warn", text: "14 words: aim for 12 or fewer." });
    expect(O.hookWordsCheck(m.hooks!.rows[0].hook.value)).toBeNull();
    expect(O.hookWordsCheck("one two three", 2)).toEqual({ level: "warn", text: "3 words: aim for 2 or fewer." });
  });

  it("avoidHookWarning names the hook by its number", () => {
    const rows = mkt(S.MKT_V2_RESEARCHED).hooks!.rows;
    expect(O.avoidHookWarning(rows[8])).toBe("Hook 9 is rated Don't use: competitor videos with this opening got few views.");
    expect(O.avoidHookWarning({ ...rows[9], num: "" })).toBe("Hook 10 is rated Don't use: competitor videos with this opening got few views.");
  });
});

describe("text for forms and cards", () => {
  it("formValue shows line breaks and pipes the way they were typed", () => {
    expect(O.formValue({ value: "a \\| b<br>c", raw: "", example: "", col: "x" })).toBe("a | b\nc");
  });

  it("linkParts turns markdown links and bare http(s) addresses into links; anything else stays text", () => {
    const m = mkt(S.MKT_V2_RESEARCHED);
    expect(O.linkParts(m.hooks!.rows[0].basedOn.value)).toEqual([
      { text: "Acme Vox 7.4×", url: "https://example.com/v/1" },
      { text: ", " },
      { text: "Beta Audio 3.1×", url: "https://example.com/v/2" },
    ]);
    expect(O.linkParts("see https://example.com/x. then")).toEqual([{ text: "see " }, { text: "https://example.com/x", url: "https://example.com/x" }, { text: ". then" }]);
    expect(O.linkParts("[x](javascript:alert) [y](file:///etc)")).toEqual([{ text: "x y" }]);
    expect(O.linkParts("a \\| b<br>c [[02_Active_Sprints/Demo_Tool/1_Dev_Spec\\|Spec]] <b>bold</b>")).toEqual([{ text: "a | b\nc Spec bold" }]);
    expect(O.linkParts("www.example.com")).toEqual([{ text: "www.example.com", url: "https://www.example.com/" }]);
    expect(O.linkParts("")).toEqual([]);
  });

  it("BACKLOG_STEPS are the 4 steps in order, each with its word", () => {
    expect(O.BACKLOG_STEPS.map((s) => s.label).join(" → ")).toBe("Scripted → Recorded → Edited → Scheduled");
  });
});

describe("plainError", () => {
  it("a conflict says what changed; a missing table or row also says where to look", () => {
    expect(plainError(new ConflictError("CTA", "Link in bio.", "Link in bio!"))).toBe("“CTA” changed in the note since you opened it: it now says “Link in bio!” (it said “Link in bio.”).");
    expect(plainError(new TableNotFoundError("brand kit"))).toBe("Couldn't find “Brand kit” in this note. It may have been moved or deleted. Open the note to check.");
    expect(plainError(new RowNotFoundError("content backlog", { index: 2 }, "3. Content backlog"))).toBe(
      "There's no line 3 under “3. Content backlog” any more. It may have been deleted. Open the note to check.",
    );
  });

  it("anything else: its message", () => {
    expect(plainError(new Error("Can't find the note. Was it renamed?"))).toBe("Can't find the note. Was it renamed?");
    expect(plainError("Plain text")).toBe("Plain text");
    expect(plainError(undefined)).toBe("That didn't go through. Open the note to check.");
    const copy = Object.assign(new Error("“CTA” changed in the note since you opened it."), { name: "ConflictError" });
    expect(plainError(copy)).toBe("“CTA” changed in the note since you opened it.");
  });
});

// ---------------------------------------------------------------------------------------------------
// Fix round: keys broken by a wrap, split budgets, rows named twice, moved competitors, absent profile lines
// ---------------------------------------------------------------------------------------------------

describe("stripeSecret: a key broken by a space, a line break or an invisible character is still a key", () => {
  const body = "51Hx" + "A".repeat(20);
  const BROKEN = [
    "sk" + "_live_" + "\n" + body,
    "sk" + "_live_ " + body,
    "rk" + "_test_" + "​" + body,
    "sk" + "_\n" + "live_" + body,
    "sk" + "_live_" + "<br>" + body,
    "sk" + "_live_" + " " + body,
    "SK" + "_LIVE_" + "\r\n" + body,
    "sk" + "%5F" + "live" + "%5f" + body,
    "https://example.com/?k=" + "sk" + "_live_" + "%20" + body,
    "[pay](https://example.com/" + "rk" + "_live_" + "%0A" + body + ")",
    "sk" + "_li⁠ve_" + body,
    "﻿" + "sk" + "_test_﻿" + body,
    "sk" + "_li\u00adve_" + body,
    "sk" + "\\_live\\_" + body,
    "sk" + "&#95;live&#95;" + body,
    "sk" + "\uff3flive\uff3f" + body,
  ];

  it("every variant is refused by the check and by the builders", () => {
    const m = mkt(S.MKT_V2_RESEARCHED);
    for (const v of BROKEN) {
      expect(O.stripeSecret(v), JSON.stringify(v)).toBe(true);
      expect(O.stripeCheck(v), JSON.stringify(v)).toEqual({ level: "error", text: STRIPE_TEXT });
      expect(() => O.competitorOp(m.competitors![0], { why: v }), JSON.stringify(v)).toThrow(STRIPE_TEXT);
      expect(() => O.kvOp("brandKit", m.brandKit![5], v), JSON.stringify(v)).toThrow(STRIPE_TEXT);
    }
  });
  it("payment links, publishable keys and ordinary words stay allowed", () => {
    const publishable = "pk" + "_live_" + "x".repeat(24);
    for (const v of [
      "https://buy.stripe.com/test_demo",
      "https://example.com/pay/test_ 00",
      publishable,
      "sk_live",
      "Stripe test mode",
      "Ask live test questions",
      "risk: live tests",
      "[Beta Audio 2.2×](https://www.tiktok.com/@spark" + "_live_" + "beats/video/7312345678901234567)",
      "@network_live_tv",
      "@dark" + "_test_" + "kitchen_daily_clips",
      "@mask" + "_test_" + "lab",
      "mask sk" + "_live_x",
    ]) {
      expect(O.stripeSecret(v), v).toBe(false);
    }
  });
});

describe("budgetCheck: split budgets are added up; an 'at most' amount is the cap, not more spend", () => {
  const capped = { level: "error", text: "The paid test is capped at $300 per sprint." };
  it("over $300 in total is refused", () => {
    for (const s of [
      "$200 + $200",
      "$150 now, $200 after day 21",
      "$100 Meta + $100 TikTok + $150 Google",
      "$200 and $150",
      "$200 plus $101",
      "$250 then $100",
      "200 + 200",
      "$100 first, $400 at most",
      "up to $350",
      "max $500",
    ]) {
      expect(O.budgetCheck(s), s).toEqual(capped);
    }
  });
  it("$300 or less in total is fine, ranges and choices count their largest amount", () => {
    for (const s of ["$100 first, $300 at most", "$100 + $200", "$100–$250", "$100 - $250", "$100 or $250", "$100 to $250", "at most $300", "$100, max $300", "$150 from day 15", "290 from day 15", "$100 now, $200 if it works", "$300 cap"]) {
      expect(O.budgetCheck(s), s).toBeNull();
    }
  });
  it("a total, a target or a stop amount is a limit, not more spending; a breakdown in brackets isn't added again", () => {
    for (const s of [
      "$100 first, scale to $300",
      "$100 first, $300 total",
      "$100 first, $300 in total",
      "$100 first, $300 overall",
      "$100 → $300",
      "$100 to test, $300 budget",
      "$50/day, stop at $300",
      "Budget: $300 ($100 test + $200 scale)",
    ]) {
      expect(O.budgetCheck(s), s).toBeNull();
    }
    for (const s of ["$100 first, scale to $400", "$100 → $350", "$200 now, $200 later, $300 total", "Budget: $300 ($200 test + $200 scale)", "$400 total"]) {
      expect(O.budgetCheck(s), s).toEqual(capped);
    }
  });
});

describe("a row whose # or label another row has is edited by its place, checking what the user saw", () => {
  const BACKLOG_3 = "| 3 | Close-up of the knob, 10s | Shorts | 3 | scripted | 2026-11-16 |";
  const TWIN_3 = "| 3 | Phone recording, 12s | TikTok | 2 | scripted | |";
  const twins = S.MKT_V1_FILLED.replace(BACKLOG_3, `${BACKLOG_3}\n${TWIN_3}`);
  const statuses = (note: string) => mkt(note).backlog!.map((r) => `${r.num} ${r.format.value}: ${r.status}`);

  it("the parser marks rows that share a # or a label; unique ones aren't marked", () => {
    expect(mkt(twins).backlog!.map((r) => r.repeated ?? false)).toEqual([false, false, true, true]);
    expect(mkt(S.MKT_V1_FILLED).backlog!.some((r) => r.repeated)).toBe(false);
    const kit = S.MKT_V2_RESEARCHED.replace("| Logo |", "| Logo (dark) | https://example.com/logo-dark.png |\n| Logo |");
    expect(mkt(kit).brandKit!.map((r) => r.repeated ?? false)).toEqual([false, false, false, false, false, false, false]);
    const twoLogos = S.MKT_V2_RESEARCHED.replace("| Logo |", "| logo | https://example.com/old-logo.png |\n| Logo |");
    expect(mkt(twoLogos).brandKit!.filter((r) => r.repeated).map((r) => r.index)).toEqual([1, 2]);
  });

  it("a status step on the second of two videos numbered 3 changes that video only (compact, padded, CRLF)", () => {
    for (const [name, note] of Object.entries(variants(twins))) {
      const second = mkt(note).backlog![3];
      const op = O.backlogStatusOp(second, "recorded");
      expect(op, name).toMatchObject({ edits: [{ row: { index: 3 }, expect: { "#": "3", [VIDEO.format]: "Phone recording, 12s", [VIDEO.status]: "scripted" } }] });
      expect(statuses(apply(note, op)), name).toEqual([
        "1 Screen recording + your voice, 20s: scheduled",
        "2 Before/after split screen, 15s: recorded",
        "3 Close-up of the knob, 10s: scripted",
        "3 Phone recording, 12s: recorded",
      ]);
      // A partner added a video above since: the place now holds the other #3, so the step is refused.
      const lines = note.split("\n");
      const t = locateTable(lines, H.backlog)!;
      lines.splice(t.rowLines[0], 0, `| 0 | Teaser, 5s | TikTok | 1 | scripted | |${note.includes("\r\n") ? "\r" : ""}`);
      const shifted = lines.join("\n");
      expect(mkt(shifted).backlog!.length, name).toBe(5);
      expect(() => applyTableOp(shifted, op), name).toThrow(ConflictError);
    }
  });

  it("edit and delete by place too; a hook numbered twice is rated by its place", () => {
    const second = mkt(twins).backlog![3];
    expect(statuses(apply(twins, O.backlogOp(second, { format: "Phone recording, 15s" })))[3]).toBe("3 Phone recording, 15s: scripted");
    expect(mkt(apply(twins, O.deleteRowOp(H.backlog, second.index, [...Object.values(O.backlogCells(second))]))).backlog!.map((r) => r.format.value)).toEqual([
      "Screen recording + your voice, 20s",
      "Before/after split screen, 15s",
      "Close-up of the knob, 10s",
    ]);
    const hooks4 = S.MKT_V2_RESEARCHED.replace("| 5 | 🟡 Medium |", "| 4 | 🟡 Medium |");
    const twin = mkt(hooks4).hooks!.rows[4];
    expect([twin.num, twin.repeated]).toEqual(["4", true]);
    const after = mkt(apply(hooks4, O.hookOp(twin, { rating: "avoid" }))).hooks!.rows;
    expect([after[3].rating, after[4].rating]).toEqual(["medium", "avoid"]);
  });

  it("brand kit: the second of two lines with the same label gets the link, and the first keeps its own", () => {
    const stripe = '| Stripe product / payment link | <span class="nx-eg">e.g. the Stripe payment link, never a secret key</span> |';
    for (const [name, note] of Object.entries(variants(S.MKT_V2_RESEARCHED.replace(stripe, "| Stripe product / payment link | https://example.com/pay-a |\n| Stripe product / payment link | https://example.com/pay-b |")))) {
      const rows = mkt(note).brandKit!;
      const b = rows[6];
      expect(b.repeated, name).toBe(true);
      const after = mkt(apply(note, O.kvOp("brandKit", b, "https://example.com/pay-new"))).brandKit!;
      expect([after[5].value.value, after[6].value.value], name).toEqual(["https://example.com/pay-a", "https://example.com/pay-new"]);
    }
    // Two Logo lines that both hold only the example: the second is filled, not the first.
    const logo = '| Logo | <span class="nx-eg">e.g. link to the logo file</span> |';
    const twoLogos = S.MKT_V2_RESEARCHED.replace(logo, `${logo}\n${logo}`);
    const second = mkt(twoLogos).brandKit![2];
    const filled = mkt(apply(twoLogos, O.kvOp("brandKit", second, "https://example.com/logo.png"))).brandKit!;
    expect([filled[1].value.value, filled[2].value.value]).toEqual(["", "https://example.com/logo.png"]);
    // A line above deleted since: the place holds another label now, so it's refused.
    const moved = twoLogos.replace("| Product name | Demo Tool |\n", "");
    expect(moved).not.toBe(twoLogos);
    expect(() => applyTableOp(moved, O.kvOp("brandKit", second, "https://example.com/logo.png"))).toThrow(ConflictError);
  });
});

describe("competitorOp always checks the competitor's name", () => {
  it("a competitor that moved up a line conflicts instead of saving into the one below", () => {
    const m = mkt(S.MKT_V1_FILLED);
    const beta = m.competitors![1];
    const op = O.competitorOp(beta, { why: "Before/after in the first second" });
    expect(op).toMatchObject({ edits: [{ row: { index: 1 }, expect: { [SWIPE.name]: "Beta Audio", [SWIPE.why]: beta.why.value } }] });
    const partner = S.MKT_V1_FILLED.replace(/^\| Acme Vox .*\n/m, "");
    expect(partner).not.toBe(S.MKT_V1_FILLED);
    expect(() => applyTableOp(partner, op)).toThrow(ConflictError);
    // The same edit built on the line's new place saves.
    const moved = mkt(partner).competitors![0];
    expect(mkt(apply(partner, O.competitorOp(moved, { why: "Before/after in the first second" }))).competitors![0].why.value).toBe("Before/after in the first second");
  });
  it("the name the sheet showed after Keep mine is the one checked", () => {
    const m = mkt(S.MKT_V2_RESEARCHED);
    const acme = m.competitors![0];
    const partner = S.MKT_V2_RESEARCHED.replace("[Acme Vox](https://example.com/acme-vox)", "[Acme Vox Pro](https://example.com/acme-vox)");
    expect(() => applyTableOp(partner, O.competitorOp(acme, { why: "x" }))).toThrow(ConflictError);
    expect(mkt(apply(partner, O.competitorOp(acme, { why: "x" }, { name: "Acme Vox Pro" }))).competitors![0].why.value).toBe("x");
  });
});

describe("a competitor whose name is still empty (finding: name check checks nothing)", () => {
  const note = () => {
    const L = S.MKT_V2_TEMPLATE.split("\n");
    const hdr = L.findIndex((l) => l.startsWith("| Competitor"));
    L[hdr + 2] = "| [Acme Vox](https://example.com/acme-vox) | [184k views](https://example.com/v/1) | \"Your S's are too loud.\" | Result by second 1 |";
    L[hdr + 3] = "| | | \"Harsh vocals? Watch the waveform.\" | Before/after by second 2 |";
    L[hdr + 4] = "| | | | |";
    return { text: L.join("\n"), hdr };
  };
  const competitorKey = (r: { name: Cell }) => r.name.value;
  const competitorCells = (r: { name: Cell; link: Cell; hook: Cell; why: Cell }) => [r.name.value, r.link.value, r.hook.value, r.why.value];

  it("a save by place conflicts when the line above was deleted, instead of naming the empty line below", () => {
    const { text, hdr } = note();
    const row = mkt(text).competitors![1];
    const op = O.competitorOp(row, { name: "Beta Audio", storeUrl: "https://example.com/beta-audio" }, { name: "", storeUrl: "", hook: row.hook.value, why: row.why.value });
    const L = text.split("\n");
    L.splice(hdr + 2, 1);
    expect(() => applyTableOp(L.join("\n"), op)).toThrow(ConflictError);
  });
  it("sameRow follows the line's content when two nameless lines swap places", () => {
    const { text, hdr } = note();
    const before = mkt(text).competitors!;
    const L = text.split("\n");
    [L[hdr + 3], L[hdr + 4]] = [L[hdr + 4], L[hdr + 3]];
    const after = mkt(L.join("\n")).competitors!;
    expect(O.sameRow(before, before[1], after, competitorKey, competitorCells)).toMatchObject({ index: 2, hook: { value: '"Harsh vocals? Watch the waveform."' } });
  });
});

describe("an open sheet's line is found again by its whole name only", () => {
  it("brand kit: a renamed or deleted Logo is never taken for Logo (dark), and a stale save by label is refused", () => {
    const two = S.MKT_V2_RESEARCHED.replace(/^\| Logo \|.*$/m, "| Logo | https://example.com/logo.png |\n| Logo (dark) | https://example.com/logo-dark.png |");
    const before = mkt(two).brandKit!;
    const logo = before.find((r) => r.label === "Logo")!;
    const kvCells = (r: { label: string; value: Cell }) => [r.label, r.value.value];
    for (const partner of [two.replace("| Logo | https://example.com/logo.png |\n", ""), two.replace("| Logo | https://example.com/logo.png |", "| Main logo | https://example.com/logo.png |")]) {
      const found = O.sameRow(before, logo, mkt(partner).brandKit!, (r) => r.label, kvCells);
      expect(found?.label ?? null).not.toBe("Logo (dark)");
      expect(() => applyTableOp(partner, O.kvOp("brandKit", logo, "https://example.com/logo-v2.png"))).toThrow(RowNotFoundError);
    }
  });
  it("competitors: a deleted Acme is never taken for Acme Pro", () => {
    const comp = S.MKT_V1_FILLED.replace(/^(\|\s*)Acme Vox(\s*\|)/m, "$1Acme$2").replace(/^(\|\s*)Gamma Labs(\s*\|)/m, "$1Acme Pro$2");
    const before = mkt(comp).competitors!;
    const acme = before[0];
    expect(acme.name.value).toBe("Acme");
    const gone = mkt(comp.replace(/^\|\s*Acme\s*\|.*\n/m, "")).competitors!;
    expect(O.sameRow(before, acme, gone, (r) => r.name.value, (r) => [r.name.value, r.link.value, r.hook.value, r.why.value])).toBeNull();
  });
});

describe("sameRow: an open sheet watches the row its save writes", () => {
  const backlogKey = (r: { num: string }) => r.num;
  const backlogCellsOf = (r: ReturnType<typeof mkt>["backlog"] extends (infer T)[] | null ? T : never) => Object.values(O.backlogCells(r)).map((c) => c.value);
  const competitorKey = (r: { name: Cell }) => r.name.value;
  const competitorCells = (r: { name: Cell; link: Cell; hook: Cell; why: Cell }) => [r.name.value, r.link.value, r.hook.value, r.why.value];

  it("a numbered row is found by its number wherever it moved, and is null once it's gone", () => {
    const before = mkt(S.MKT_V1_FILLED).backlog!;
    const without1 = mkt(S.MKT_V1_FILLED.replace(/^\| 1 \| Screen recording.*\n/m, "")).backlog!;
    expect(O.sameRow(before, before[2], without1, backlogKey, backlogCellsOf)).toMatchObject({ num: "3", index: 1 });
    const without3 = mkt(S.MKT_V1_FILLED.replace(/^\| 3 \| Close-up.*\n/m, "")).backlog!;
    expect(O.sameRow(before, before[2], without3, backlogKey, backlogCellsOf)).toBeNull();
    expect(O.sameRow(before, before[2], null, backlogKey, backlogCellsOf)).toBeNull();
  });

  it("two rows numbered 3: the same one of them after a line is added above, a twin deleted, or the row itself deleted", () => {
    const twins = S.MKT_V1_FILLED.replace(/^(\| 3 \| Close-up.*)$/m, "$1\n| 3 | Phone recording, 12s | TikTok | 2 | scripted | |");
    const before = mkt(twins).backlog!;
    const second = before[3];
    const above = mkt(twins.replace(/^(\| 1 \| Screen)/m, "| 0 | Teaser, 5s | TikTok | 1 | scripted | |\n$1")).backlog!;
    expect(O.sameRow(before, second, above, backlogKey, backlogCellsOf)).toMatchObject({ index: 4, format: { value: "Phone recording, 12s" } });
    const firstGone = mkt(twins.replace(/^\| 3 \| Close-up.*\n/m, "")).backlog!;
    expect(O.sameRow(before, second, firstGone, backlogKey, backlogCellsOf)).toMatchObject({ index: 2, format: { value: "Phone recording, 12s" } });
    const itselfGone = mkt(twins.replace(/^\| 3 \| Phone recording.*\n/m, "")).backlog!;
    expect(O.sameRow(before, second, itselfGone, backlogKey, backlogCellsOf)).toBeNull();
  });

  it("brand kit: an exact label first, like the op (Logo (dark) above Logo)", () => {
    const note = S.MKT_V2_RESEARCHED.replace("| Logo |", "| Logo (dark) | https://example.com/logo-dark.png |\n| Logo |");
    const before = mkt(S.MKT_V2_RESEARCHED).brandKit!;
    const after = mkt(note).brandKit!;
    expect(O.sameRow(before, before[1], after, (r) => r.label, (r) => [r.label, r.value.value])).toMatchObject({ index: 2, label: "Logo" });
  });

  it("competitors: found by name after a line above is deleted; a deleted competitor is never swapped for the next one", () => {
    const before = mkt(S.MKT_V1_FILLED).competitors!;
    const beta = before[1];
    const acmeGone = mkt(S.MKT_V1_FILLED.replace(/^\| Acme Vox .*\n/m, "")).competitors!;
    expect(O.sameRow(before, beta, acmeGone, competitorKey, competitorCells)).toMatchObject({ index: 0, name: { value: "Beta Audio" } });
    const betaGone = mkt(S.MKT_V1_FILLED.replace(/^\| Beta Audio .*\n/m, "")).competitors!;
    expect(O.sameRow(before, beta, betaGone, competitorKey, competitorCells)).toBeNull();
    // Renamed in place (nothing else moved): still the same line.
    const renamed = mkt(S.MKT_V1_FILLED.replace("| Beta Audio ", "| Beta Audio Pro ")).competitors!;
    expect(O.sameRow(before, beta, renamed, competitorKey, competitorCells)).toMatchObject({ index: 1, name: { value: "Beta Audio Pro" } });
    // Replaced by a competitor that was already listed: not taken for this one.
    const swapped = mkt(S.MKT_V1_FILLED.replace(/^\| Beta Audio .*\n/m, "").replace(/^(\| Gamma Labs .*)$/m, "$1\n| Delta Example | https://example.com/v/4 | x | y |")).competitors!;
    expect(O.sameRow(before, beta, swapped, competitorKey, competitorCells)).toBeNull();
  });

  it("empty template slots: slot 3 stays slot 3 after a partner fills slot 1", () => {
    const before = mkt(S.MKT_V2_TEMPLATE).competitors!;
    const filled = mkt(S.MKT_V2_TEMPLATE.replace(/^\| <span class="nx-eg">e\.g\. product name[^|]*\|/m, "| [Acme Vox](https://example.com/acme-vox) |")).competitors!;
    expect(filled[0].name.value).toBe("[Acme Vox](https://example.com/acme-vox)");
    expect(O.sameRow(before, before[2], filled, competitorKey, competitorCells)).toMatchObject({ index: 2 });
  });
});

describe("profileOp: a profile line the Dev Spec doesn't have yet", () => {
  it("is added to the same list, so Fill in can always save it", () => {
    for (const [name, spec] of Object.entries(variants(S.SPEC_FILLED.replace("| Price | $29 one-time |\n", "")))) {
      const p = profileOf(spec);
      expect(p.profileColumns, name).toEqual({ label: "Item", value: "Value" });
      const after = apply(spec, O.profileOp(p, "price", "$19 one-time"));
      expect(profileOf(after), name).toMatchObject({ price: "$19 one-time", complete: true });
    }
  });
  it("an exact label wins over an earlier one that starts the same, when reading and when writing", () => {
    const spec = S.SPEC_FILLED.replace("| Price | $29 one-time |", "| Price (old) | $9 |\n| Price | $29 one-time |");
    const p = profileOf(spec);
    expect(p.price).toBe("$29 one-time");
    const after = apply(spec, O.profileOp(p, "price", "$39 one-time"));
    expect(after).toContain("| Price (old) | $9 |");
    expect(profileOf(after).price).toBe("$39 one-time");
  });
});

describe("by-place edits only check columns the note has", () => {
  it("a backlog without a # column and a brand kit without an Asset column still save", () => {
    const noNum = S.MKT_V1_FILLED.replace("| # | Format | Platform(s) | Hook # |", "| No | Format | Platform(s) | Hook |").replace(/^\| (\d) \| /gm, "| v$1 | ");
    const v = mkt(noNum).backlog![1];
    expect(v.num).toBe("");
    expect(mkt(apply(noNum, O.backlogStatusOp(v, "edited"))).backlog![1].status).toBe("edited");
    const noAsset = S.MKT_V2_RESEARCHED.replace("| Asset | Link / status |", "| Thing | Link / status |");
    const row = mkt(noAsset).brandKit![1];
    expect(row.label).toBe("");
    expect(mkt(apply(noAsset, O.kvOp("brandKit", row, "https://example.com/logo.png"))).brandKit![1].value.value).toBe("https://example.com/logo.png");
  });
});
