import { describe, expect, it } from "vitest";
import { cell, exampleIn, splitRow, tableIn } from "../src/data/markdown";
import {
  AmbiguousRowError,
  applyTableOp,
  ConflictError,
  escapeCell,
  exampleSpan,
  findRows,
  locateTable,
  mdLink,
  readMarker,
  RowEdit,
  RowNotFoundError,
  RowRef,
  TableLocation,
  TableNotFoundError,
  TableOp,
} from "../src/data/tableEdit";
import * as S from "./samples";

const MKT: Record<string, string> = {
  MKT_V1_TEMPLATE: S.MKT_V1_TEMPLATE,
  MKT_V1_FILLED: S.MKT_V1_FILLED,
  MKT_V2_TEMPLATE: S.MKT_V2_TEMPLATE,
  MKT_V2_REQUESTED: S.MKT_V2_REQUESTED,
  MKT_V2_RESEARCHED: S.MKT_V2_RESEARCHED,
  MKT_V2_PADDED: S.MKT_V2_PADDED,
  MKT_V2_REVIEWED: S.MKT_V2_REVIEWED,
  MKT_HALF_DELETED: S.MKT_HALF_DELETED,
};
const SPEC: Record<string, string> = {
  SPEC_EMPTY: S.SPEC_EMPTY,
  SPEC_FILLED: S.SPEC_FILLED,
  SPEC_SPAN_ONLY: S.SPEC_SPAN_ONLY,
  SPEC_TBD: S.SPEC_TBD,
  SPEC_NO_TABLE: S.SPEC_NO_TABLE,
};
const ALL: Record<string, string> = { ...MKT, ...SPEC };

/** Each note as written, padded by Obsidian's table editor, and both again with CRLF line endings. */
const variants = (note: string): Record<string, string> => ({
  "as written": note,
  padded: S.padTables(note),
  crlf: S.crlf(note),
  "padded crlf": S.crlf(S.padTables(note)),
});

const span = (t: string) => `<span class="nx-eg">${t}</span>`;
const md = (...lines: string[]) => [...lines, ""].join("\n");

const RESEARCH = "<!-- nx-research: date=2026-11-20 checked=41 kept=2 rounds=2 sources=crawl4ai,shorts -->";
const REQUEST = "<!-- nx-research-request: date=2026-11-18 by=marketing -->";
const REVIEWED = "<!-- nx-reviewed: competitors=2026-11-21 -->";

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

/** Applies the op, checks that its inverse gives back the note byte for byte, and returns the result. */
function roundTrip(note: string, op: TableOp): { text: string; inverse: TableOp } {
  const r = applyTableOp(note, op);
  expect(applyTableOp(r.text, r.inverse).text).toBe(note);
  return r;
}

const set = (heading: string, row: RowRef, values: Record<string, string>, expected: Record<string, string> = {}): TableOp => ({
  kind: "set",
  heading,
  edits: [{ row, values, expect: expected }],
});

/** Positions of a row's unescaped pipes. */
function pipesOf(line: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "\\" && line[i + 1] === "|") i++;
    else if (line[i] === "|") out.push(i);
  }
  return out;
}

/** Every table a note has, keyed by the full title of the heading above it. */
function tablesOf(note: string): Array<{ key: string; t: TableLocation }> {
  const lines = note.split("\n");
  return [...note.matchAll(/^#{2,6} (.*)$/gm)].flatMap((m) => {
    const key = m[1].replace(/\r$/, "");
    const t = locateTable(lines, key);
    return t ? [{ key, t }] : [];
  });
}

/** What the user saw in every cell of a row, the way the dashboard reads it. */
const seen = (t: TableLocation, r: number) => Object.fromEntries(t.headers.map((h, c) => [h, cell(t.rows[r], c)]));

describe("escapeCell and mdLink", () => {
  it("escapeCell trims, turns line breaks into <br> and escapes bare pipes only", () => {
    expect(escapeCell("  Acme Vox \n")).toBe("Acme Vox");
    expect(escapeCell("a | b")).toBe("a \\| b");
    expect(escapeCell("a||b")).toBe("a\\|\\|b");
    expect(escapeCell("line one\nline two\r\nthree\rfour")).toBe("line one<br>line two<br>three<br>four");
    expect(escapeCell("[[02_Active_Sprints/Demo_Tool/1_Dev_Spec\\|Spec]]")).toBe("[[02_Active_Sprints/Demo_Tool/1_Dev_Spec\\|Spec]]");
    expect(escapeCell("")).toBe("");
  });
  it("mdLink makes a link that survives a table cell", () => {
    expect(mdLink("Acme Vox", "https://example.com/acme-vox")).toBe("[Acme Vox](https://example.com/acme-vox)");
    expect(mdLink(" 184k views · 7.4× usual ", " https://example.com/v/1 ")).toBe("[184k views · 7.4× usual](https://example.com/v/1)");
    expect(mdLink("Beta [beta]", "https://example.com/a b(1)")).toBe("[Beta \\[beta\\]](https://example.com/a%20b%281%29)");
    expect(mdLink("", "https://example.com/x")).toBe("[https://example.com/x](https://example.com/x)");
    expect(mdLink("Gamma Labs", "")).toBe("Gamma Labs");
    expect(escapeCell(mdLink("a | b", "https://example.com/x"))).toBe("[a \\| b](https://example.com/x)");
  });
});

describe("readMarker", () => {
  it("reads each D4 marker anywhere in the note, and tells nx-research from nx-research-request", () => {
    expect(readMarker(S.MKT_V2_REVIEWED, "nx-research")).toEqual({ date: "2026-11-20", checked: "41", kept: "2", rounds: "2", sources: "crawl4ai,shorts" });
    expect(readMarker(S.MKT_V2_REVIEWED, "nx-research-request")).toEqual({ date: "2026-11-18", by: "marketing" });
    expect(readMarker(S.MKT_V2_REVIEWED, "nx-reviewed")).toEqual({ competitors: "2026-11-21" });
    expect(readMarker(S.MKT_V2_REQUESTED, "nx-research")).toBeNull();
    expect(readMarker(S.MKT_V2_TEMPLATE, "nx-research-request")).toBeNull();
  });
  it("works with CRLF and loose spacing, ignores parts without = and other comments", () => {
    expect(readMarker(S.crlf(S.MKT_V2_REVIEWED), "nx-reviewed")).toEqual({ competitors: "2026-11-21" });
    expect(readMarker("x\n  <!--nx-reviewed:hooks=2026-11-22   stray -->  \n", "nx-reviewed")).toEqual({ hooks: "2026-11-22" });
    expect(readMarker("<!-- nx-reviewed: -->", "nx-reviewed")).toEqual({});
    expect(readMarker("<!-- TODO: nx-reviewed: competitors=1 -->", "nx-reviewed")).toBeNull();
    expect(readMarker("text <!-- nx-reviewed: competitors=1 -->", "nx-reviewed")).toBeNull();
  });
  it("skips the frontmatter and code fences, so a written-out example isn't taken for the real marker", () => {
    const note = md(
      "---",
      "project: Demo_Tool",
      "notes: |",
      "  <!-- nx-reviewed: competitors=1999-01-01 -->",
      "---",
      "",
      "## 1. Competitor swipe",
      "```",
      "<!-- nx-reviewed: competitors=2000-01-01 -->",
      "```",
      "| A |",
      "|---|",
      "| x |",
      "",
      REVIEWED,
    );
    expect(readMarker(note, "nx-reviewed")).toEqual({ competitors: "2026-11-21" });
    const r = roundTrip(note, { kind: "marker", heading: "competitor swipe", name: "nx-reviewed", attrs: { competitors: "2026-11-22" }, expect: { competitors: "2026-11-21" } });
    expect(diff(note, r.text)).toMatchObject({ removed: [REVIEWED], added: ["<!-- nx-reviewed: competitors=2026-11-22 -->"] });
  });
});

describe("locateTable", () => {
  it("finds the same table as tableIn() in every section of every sample, LF and CRLF", () => {
    for (const [name, note] of Object.entries(ALL)) {
      for (const text of [note, S.crlf(note), S.padTables(note)]) {
        const lines = text.split("\n");
        for (const key of ["competitor swipe", "hook scripts", "content backlog", "brand kit", "paid test", "pitch", "tech preset", "build plan", "mechanics"]) {
          const t = locateTable(lines, key);
          const want = tableIn(text, key);
          expect(t && { headers: t.headers, rows: t.rows }, `${name} ${key}`).toEqual(want);
          if (!t) continue;
          t.rowLines.forEach((at, k) => {
            const cells = splitRow(lines[at].replace(/\r$/, ""));
            expect(t.rows[k].slice(0, cells.length)).toEqual(cells);
          });
          expect(t.end).toBe((t.rowLines.length ? t.rowLines[t.rowLines.length - 1] : t.separatorLine) + 1);
        }
      }
    }
  });
  it("picks the first table under the heading, not the one inside the callout", () => {
    const lines = S.MKT_V2_RESEARCHED.split("\n");
    const t = locateTable(lines, "competitor swipe")!;
    expect(t.headers).toEqual(["Competitor", "Top ad / video link", "Hook (first 3s)", "Why it works"]);
    expect(lines[t.headerLine]).toBe("| Competitor | Top ad / video link | Hook (first 3s) | Why it works |");
    expect(t.separatorLine).toBe(t.headerLine + 1);
    expect(t.rowLines).toEqual([t.headerLine + 2, t.headerLine + 3, t.headerLine + 4]);
    expect(lines[t.end]).toBe("");
  });
  it("handles alignment separators, rows without a trailing pipe and escaped alias pipes", () => {
    const note = md("## Links", "| Note | Status | Count", "|:---|:---:|---:", "| [[02_Active_Sprints/Demo_Tool/1_Dev_Spec\\|Spec]] | open | 1", "| plain | done | 2 |");
    const t = locateTable(note.split("\n"), "links")!;
    expect(t.headers).toEqual(["Note", "Status", "Count"]);
    expect(t.rows).toEqual([["[[02_Active_Sprints/Demo_Tool/1_Dev_Spec\\|Spec]]", "open", "1"], ["plain", "done", "2"]]);
  });
  it("is null for a missing heading or a section without a table, and ignores headings in the frontmatter", () => {
    expect(locateTable(S.MKT_V2_RESEARCHED.split("\n"), "nope")).toBeNull();
    expect(locateTable(S.SPEC_FILLED.split("\n"), "out of scope")).toBeNull();
    expect(locateTable(S.SPEC_NO_TABLE.split("\n"), "pitch")).toBeNull();
    const note = md("---", "project: Demo_Tool", "# brand kit notes live below", "---", "", "# Demo Tool: Marketing Engine", "", "## 4. Brand kit", "| Asset | Link / status |", "|---|---|", "| Logo | |");
    expect(locateTable(note.split("\n"), "brand kit")?.rows).toEqual([["Logo", ""]]);
    const r = roundTrip(note, set("brand kit", { key: "logo", col: "asset" }, { link: "https://example.com/logo.png" }));
    expect(r.text.split("\n").slice(0, 4)).toEqual(note.split("\n").slice(0, 4));
  });
});

describe("set", () => {
  const cta: TableOp = set("hook scripts", { key: "6", col: "#" }, { cta: "$29 once. Link in bio." }, { cta: "" });
  const row6 = (ctaCell: string) =>
    `| 6 | 🟡 Medium | "Home studio vocals sound harsh? Try this." | Phone recording: knob up, play it back | ${ctaCell} | [Beta Audio 2.4×](https://example.com/v/6) |`;

  it("compact: changes only the touched cell and the inverse puts its old bytes back", () => {
    const r = roundTrip(S.MKT_V2_RESEARCHED, cta);
    expect(diff(S.MKT_V2_RESEARCHED, r.text)).toMatchObject({ removed: [row6(span("e.g. Link in bio."))], added: [row6("$29 once. Link in bio.")] });
    // The inverse puts back the old bytes of the one cell, and expects the whole row so it can't land on another one.
    expect(r.inverse).toEqual({
      kind: "set",
      heading: "hook scripts",
      edits: [
        {
          row: { index: 5 },
          values: { CTA: ` ${span("e.g. Link in bio.")} ` },
          expect: {
            "#": "6",
            Rating: "🟡 Medium",
            "Hook (spoken, first 3s)": `"Home studio vocals sound harsh? Try this."`,
            "Demo shot": "Phone recording: knob up, play it back",
            CTA: "$29 once. Link in bio.",
            "Based on": "[Beta Audio 2.4×](https://example.com/v/6)",
          },
          raw: true,
        },
      ],
    });
  });
  it("padded: shorter text is padded so every pipe stays put; longer text gets one trailing space", () => {
    const r = roundTrip(S.MKT_V2_PADDED, cta);
    const d = diff(S.MKT_V2_PADDED, r.text);
    expect(d.removed).toHaveLength(1);
    expect(pipesOf(d.added[0])).toEqual(pipesOf(d.removed[0]));
    expect(splitRow(d.added[0])).toEqual(splitRow(row6("$29 once. Link in bio.")));
    const long = "A call to action far longer than this column is wide, so the pipes after it move along";
    const r2 = roundTrip(S.MKT_V2_PADDED, set("hook scripts", { key: "6", col: "#" }, { cta: long }));
    const line = diff(S.MKT_V2_PADDED, r2.text).added[0];
    expect(line).toContain(`| ${long} | [Beta Audio 2.4×](https://example.com/v/6) `);
    expect(line.startsWith(d.removed[0].slice(0, pipesOf(d.removed[0])[4] + 1))).toBe(true);
  });
  it("CRLF: the touched line keeps its \\r and no other line changes", () => {
    const note = S.crlf(S.MKT_V2_RESEARCHED);
    const r = roundTrip(note, cta);
    expect(diff(note, r.text)).toMatchObject({ removed: [`${row6(span("e.g. Link in bio."))}\r`], added: [`${row6("$29 once. Link in bio.")}\r`] });
  });
  it("finds rows by index, by number (3 is not 30) and by label prefix", () => {
    const nums = md("## Hooks", "| # | Hook |", "|---|---|", "| 30 | thirty |", "| 3 | three |");
    expect(roundTrip(nums, set("hooks", { key: "3", col: "#" }, { hook: "THREE" }, { hook: "three" })).text).toBe(nums.replace("| 3 | three |", "| 3 | THREE |"));
    expect(() => applyTableOp(nums, set("hooks", { key: "4", col: "#" }, { hook: "x" }))).toThrow(RowNotFoundError);
    const budget = roundTrip(S.MKT_V2_RESEARCHED, set("paid test", { key: "budget", col: "item" }, { value: "$300" }, { value: "$100" }));
    expect(diff(S.MKT_V2_RESEARCHED, budget.text).added).toEqual(["| Budget (max $300 per sprint) | $300 |"]);
    const platform = roundTrip(S.MKT_V2_RESEARCHED, set("paid test", { key: "Platform", col: "item" }, { value: "TikTok" }, { value: "Meta" }));
    expect(diff(S.MKT_V2_RESEARCHED, platform.text).added).toEqual(["| Platform | TikTok |"]);
    const byIndex = roundTrip(S.MKT_V2_RESEARCHED, set("brand kit", { index: 5 }, { "link / status": "https://example.com/pay/demo-tool" }, { link: "" }));
    expect(diff(S.MKT_V2_RESEARCHED, byIndex.text).added).toEqual(["| Stripe product / payment link | https://example.com/pay/demo-tool |"]);
  });
  it("escapes | and line breaks, and compares values the way cell() reads them", () => {
    const r = roundTrip(S.MKT_V2_RESEARCHED, set("competitor swipe", { index: 1 }, { why: "Before/after | by second 2\n3.1× usual" }, { why: "Before/after by second 2; 3.1× usual, an ad running 45 days" }));
    const t = tableIn(r.text, "competitor swipe")!;
    expect(cell(t.rows[1], 3)).toBe("Before/after \\| by second 2<br>3.1× usual");
    expect(t.rows[1].slice(0, 3)).toEqual(tableIn(S.MKT_V2_RESEARCHED, "competitor swipe")!.rows[1].slice(0, 3));
    // The value the user saw can come straight from cell(), with \| and <br> as written, or unescaped.
    for (const saw of ["Before/after \\| by second 2<br>3.1× usual", "Before/after | by second 2\n3.1× usual"]) {
      expect(() => applyTableOp(r.text, set("competitor swipe", { index: 1 }, { why: "x" }, { why: saw }))).not.toThrow();
    }
  });
  it("applies several edits across rows at once, with one inverse for all of them", () => {
    const op: TableOp = {
      kind: "set",
      heading: "brand kit",
      edits: [
        { row: { key: "logo", col: "asset" }, values: { link: "https://example.com/logo.png" }, expect: { link: "" } },
        { row: { key: "email", col: "asset" }, values: { link: "https://example.com/signup" }, expect: { link: "" } },
        { row: { key: "logo", col: "asset" }, values: { link: "https://example.com/logo-2.png" }, expect: {} },
      ],
    };
    const r = roundTrip(S.MKT_V2_RESEARCHED, op);
    const kit = tableIn(r.text, "brand kit")!.rows.map((row) => cell(row, 1));
    expect(kit).toEqual(["Demo Tool", "https://example.com/logo-2.png", "", "https://example.com/demo-tool", "https://example.com/signup", ""]);
    expect(r.inverse.kind === "set" && r.inverse.edits.map((e) => e.row)).toEqual([{ index: 1 }, { index: 4 }]);
  });
  it("is all or nothing: one bad edit and nothing is written", () => {
    const good: RowEdit = { row: { key: "logo", col: "asset" }, values: { link: "https://example.com/logo.png" }, expect: { link: "" } };
    const bad: Array<[RowEdit, new (...a: never[]) => Error]> = [
      [{ row: { key: "landing", col: "asset" }, values: { link: "https://example.com/new" }, expect: { link: "https://example.com/old" } }, ConflictError],
      [{ row: { key: "Press kit", col: "asset" }, values: { link: "x" }, expect: {} }, RowNotFoundError],
      [{ row: { index: 2 }, values: { owner: "x" }, expect: {} }, TableNotFoundError],
    ];
    for (const [edit, error] of bad) {
      let note = S.MKT_V2_RESEARCHED;
      expect(() => {
        note = applyTableOp(note, { kind: "set", heading: "brand kit", edits: [good, edit] }).text;
      }).toThrow(error);
      expect(note).toBe(S.MKT_V2_RESEARCHED);
    }
    expect(applyTableOp(S.MKT_V2_RESEARCHED, { kind: "set", heading: "brand kit", edits: [good] }).text).not.toBe(S.MKT_V2_RESEARCHED);
  });
  it("writing the value a cell already shows changes nothing", () => {
    for (const op of [
      set("brand kit", { key: "product", col: "asset" }, { link: " Demo Tool " }, { link: "Demo Tool" }),
      set("brand kit", { key: "logo", col: "asset" }, { link: "" }, { link: "" }),
      set("competitor swipe", { index: 0 }, { competitor: "[Acme Vox](https://example.com/acme-vox)" }),
    ]) {
      const r = applyTableOp(S.MKT_V2_PADDED, op);
      expect(r.text).toBe(S.MKT_V2_PADDED);
      expect(r.inverse).toEqual({ kind: "set", heading: op.heading, edits: [] });
    }
  });
});

describe("clearing a cell", () => {
  it("restores the column's example from the nearest row above", () => {
    const r = roundTrip(S.MKT_V2_RESEARCHED, set("hook scripts", { key: "4", col: "#" }, { cta: "" }, { cta: "Link in bio." }));
    expect(diff(S.MKT_V2_RESEARCHED, r.text).added[0]).toContain(`| Screen: a lane full of volume dips, then one knob | ${span("e.g. Link in bio.")} | [Beta Audio 2.2×]`);
  });
  it("else from the nearest row below", () => {
    const r = roundTrip(S.MKT_V2_RESEARCHED, set("competitor swipe", { index: 0 }, { "top ad": "" }));
    expect(diff(S.MKT_V2_RESEARCHED, r.text).added).toEqual([
      `| [Acme Vox](https://example.com/acme-vox) | ${span("e.g. their best video: views and × their usual")} | "Your S's are too loud. One knob fixes that." (TikTok captions) | Result by second 1; 7.4× usual, 3 videos at 2×+ |`,
    ]);
    const padded = roundTrip(S.MKT_V2_PADDED, set("competitor swipe", { index: 0 }, { "top ad": "" }));
    expect(cell(tableIn(padded.text, "competitor swipe")!.rows[0], 1)).toBe("");
    expect(exampleIn(tableIn(padded.text, "competitor swipe")!.rows[0][1])).toBe("e.g. their best video: views and × their usual");
  });
  it("a Don't use row picks up the Don't use example right above it", () => {
    const typed = roundTrip(S.MKT_V2_TEMPLATE, set("hook scripts", { key: "10", col: "#" }, { hook: "Follow-ask opening. 0.4× usual across 3 videos." })).text;
    const cleared = roundTrip(typed, set("hook scripts", { key: "10", col: "#" }, { hook: "" }));
    expect(diff(typed, cleared.text).added).toEqual([`| 10 | 🔴 Don't use | ${span("e.g. brand-first opening: logo and name before the demo")} | — | — | |`]);
  });
  it("a Recommended or Medium row never borrows a Don't use example", () => {
    const typed = roundTrip(S.MKT_V2_TEMPLATE, set("hook scripts", { key: "1", col: "#" }, { hook: `"One knob. That's the whole plugin."` })).text;
    const cleared = roundTrip(typed, set("hook scripts", { key: "1", col: "#" }, { hook: "" }));
    const row1 = diff(typed, cleared.text).added[0];
    expect(row1).not.toContain("brand-first");
    expect(cell(splitRow(row1), 2)).toBe("");
    const medium = roundTrip(typed, set("hook scripts", { key: "4", col: "#" }, { demo: "Screen: the knob turning", cta: "Link in bio." }));
    const back = roundTrip(medium.text, set("hook scripts", { key: "4", col: "#" }, { demo: "", cta: "" }));
    expect(diff(medium.text, back.text).added).toEqual([`| 4 | 🟡 Medium | | ${span("e.g. screen: one click, the result plays right away")} | ${span("e.g. Link in bio.")} | |`]);
  });
  it("a cell keeps its own example; a key-value row gets its own label's template example, never another row's", () => {
    const own = md("## T", "| # | A |", "|---|---|", `| 1 | Acme ${span("e.g. product name")} |`, `| 2 | ${span("e.g. other")} |`);
    expect(roundTrip(own, set("t", { key: "1", col: "#" }, { a: "" })).text).toBe(own.replace(`Acme ${span("e.g. product name")}`, span("e.g. product name")));
    const kit = roundTrip(S.MKT_V2_RESEARCHED, set("brand kit", { key: "landing", col: "asset" }, { link: "" }));
    expect(diff(S.MKT_V2_RESEARCHED, kit.text).added).toEqual([`| Landing page | ${span("e.g. link to the one-page site")} |`]);
    const padded = roundTrip(S.MKT_V2_PADDED, set("brand kit", { key: "landing", col: "asset" }, { link: "" }));
    const line = diff(S.MKT_V2_PADDED, padded.text).added[0];
    expect(splitRow(line)).toEqual(["Landing page", span("e.g. link to the one-page site")]);
    expect(pipesOf(line)).toEqual(pipesOf(diff(S.MKT_V2_PADDED, padded.text).removed[0]));
    const odd = md("## 4. Brand kit", "| Asset | Link / status |", "|---|---|", `| Press kit | https://example.com/press |`, `| Logo | ${span("e.g. link to the logo file")} |`);
    expect(diff(odd, roundTrip(odd, set("brand kit", { key: "press", col: "asset" }, { link: "" })).text).added).toEqual(["| Press kit | |"]);
  });
  it("a value that is itself an example span is written as given (to put a row's own example back)", () => {
    const r = roundTrip(S.MKT_V2_RESEARCHED, set("brand kit", { key: "landing", col: "asset" }, { link: span("e.g. link to the one-page site") }));
    expect(diff(S.MKT_V2_RESEARCHED, r.text).added).toEqual([`| Landing page | ${span("e.g. link to the one-page site")} |`]);
    const swap = roundTrip(S.MKT_V2_RESEARCHED, set("brand kit", { key: "logo", col: "asset" }, { link: span("e.g. a better hint") }, { link: "" }));
    expect(diff(S.MKT_V2_RESEARCHED, swap.text).added).toEqual([`| Logo | ${span("e.g. a better hint")} |`]);
    expect(exampleSpan("e.g. link to the one-page site")).toBe(span("e.g. link to the one-page site"));
    expect(exampleSpan(" e.g. a | b ")).toBe(span("e.g. a \\| b"));
    const typed = roundTrip(S.MKT_V2_RESEARCHED, set("brand kit", { key: "landing", col: "asset" }, { link: exampleSpan("e.g. link to the one-page site") })).text;
    expect(cell(tableIn(typed, "brand kit")!.rows[3], 1)).toBe("");
  });
  it("half-deleted spans: an orphan '</span>' cell is typed text; a cell with only an opening tag reads as empty", () => {
    const orphan = roundTrip(S.MKT_HALF_DELETED, set("competitor swipe", { index: 0 }, { competitor: "" }, { competitor: "e.g. orphan text</span>" }));
    expect(tableIn(orphan.text, "competitor swipe")!.rows[0][0]).toBe("");
    const half = applyTableOp(S.MKT_HALF_DELETED, set("brand kit", { key: "stripe", col: "asset" }, { link: "" }, { link: "" }));
    expect(half.text).toBe(S.MKT_HALF_DELETED);
    const typed = roundTrip(S.MKT_HALF_DELETED, set("brand kit", { key: "stripe", col: "asset" }, { link: "https://example.com/pay/demo-tool" }, { link: "" }));
    expect(diff(S.MKT_HALF_DELETED, typed.text).added).toEqual(["| Stripe product / payment link | https://example.com/pay/demo-tool |"]);
  });
});

describe("insert", () => {
  const backlogRow = (cells: string[]) => `| ${cells.join(" | ")} |`;
  const EG = {
    format: span("e.g. screen recording + your voice, 20s"),
    platforms: span("e.g. TikTok, Reels, Shorts, X"),
    hookNum: span("e.g. 1"),
    status: span("e.g. scripted"),
    goLive: span("e.g. launch day (day 14)"),
  };

  it("fills the first row that holds only placeholders, keeping its # and the other examples", () => {
    const op: TableOp = { kind: "insert", heading: "content backlog", values: { format: "Screen recording + your voice, 20s", "hook #": "2" }, numberCol: "#" };
    const r = roundTrip(S.MKT_V2_TEMPLATE, op);
    expect(diff(S.MKT_V2_TEMPLATE, r.text)).toMatchObject({
      removed: [backlogRow(["1", EG.format, EG.platforms, EG.hookNum, EG.status, EG.goLive])],
      added: [backlogRow(["1", "Screen recording + your voice, 20s", EG.platforms, "2", EG.status, EG.goLive])],
    });
    expect(r.inverse.kind).toBe("set");
    const next = roundTrip(r.text, { kind: "insert", heading: "content backlog", values: { format: "Close-up, 10s", "hook #": "3" }, numberCol: "#" });
    const d = diff(r.text, next.text);
    expect(d).toMatchObject({ removed: [], added: ["| 2 | Close-up, 10s | | 3 | | |"] });
    expect(r.text.split("\n")[d.at - 1]).toBe(backlogRow(["1", "Screen recording + your voice, 20s", EG.platforms, "2", EG.status, EG.goLive]));
    // An added numbered row is taken back by its number, so Undos work in any order.
    expect(next.inverse).toMatchObject({ kind: "delete", row: { key: "2", col: "#" }, evenIfLast: true });
  });
  it("appends after the last row with the next number, in the table's own style (compact, padded, CRLF)", () => {
    const op: TableOp = { kind: "insert", heading: "backlog", values: { format: "Split screen | 15s", platform: "Reels" }, numberCol: "#" };
    const compact = roundTrip(S.MKT_V1_FILLED, op);
    expect(diff(S.MKT_V1_FILLED, compact.text)).toMatchObject({ removed: [], added: ["| 4 | Split screen \\| 15s | Reels | | | |"] });
    const crlf = roundTrip(S.crlf(S.MKT_V1_FILLED), op);
    expect(diff(S.crlf(S.MKT_V1_FILLED), crlf.text).added).toEqual(["| 4 | Split screen \\| 15s | Reels | | | |\r"]);
    const note = S.padTables(S.MKT_V1_FILLED);
    const padded = roundTrip(note, op);
    const d = diff(note, padded.text);
    const header = note.split("\n").find((l) => l.startsWith("| #   | Format"))!;
    expect(d.removed).toEqual([]);
    expect(pipesOf(d.added[0])).toEqual(pipesOf(header));
    expect(splitRow(d.added[0])).toEqual(["4", "Split screen \\| 15s", "Reels", "", "", ""]);
  });
  it("puts a new competitor into the MISSING slot", () => {
    const r = roundTrip(S.MKT_V2_RESEARCHED, { kind: "insert", heading: "competitor swipe", values: { competitor: mdLink("Gamma Labs", "https://example.com/gamma-labs") } });
    const row = tableIn(r.text, "competitor swipe")!.rows[2];
    expect(row[0]).toBe("[Gamma Labs](https://example.com/gamma-labs)");
    expect(row.slice(1).map(exampleIn)).toEqual(["e.g. their best video: views and × their usual", "e.g. their exact first words, in quotes", "e.g. shows the result by second 2"]);
  });
  it("numbers a free row whose # is a placeholder, and starts at 1 in an empty table", () => {
    const gap = md("## T", "| # | Item |", "|---|---|", "| 4 | kept |", "| | |");
    expect(roundTrip(gap, { kind: "insert", heading: "t", values: { item: "new" }, numberCol: "#" }).text).toBe(gap.replace("| | |", "| 5 | new |"));
    const empty = md("## T", "| # | Item |", "|---|---|", "", "## U", "text");
    expect(roundTrip(empty, { kind: "insert", heading: "t", values: { item: "first" }, numberCol: "#" }).text).toBe(empty.replace("|---|---|\n", "|---|---|\n| 1 | first |\n"));
  });
  it("appends at the end of a note that doesn't end with a newline (LF and CRLF)", () => {
    for (const note of ["## T\n| # | A |\n|---|---|\n| 1 | a |", "## T\r\n| # | A |\r\n|---|---|\r\n| 1 | a |"]) {
      const nl = note.includes("\r") ? "\r\n" : "\n";
      const r = roundTrip(note, { kind: "insert", heading: "t", values: { a: "b" }, numberCol: "#" });
      expect(r.text).toBe(`${note}${nl}| 2 | b |`);
    }
  });
});

describe("delete and restore", () => {
  it("delete removes the row and the inverse restore puts the exact line back (compact, padded, CRLF)", () => {
    for (const note of Object.values(variants(S.MKT_V1_FILLED))) {
      const t = locateTable(note.split("\n"), "backlog")!;
      const r = roundTrip(note, { kind: "delete", heading: "backlog", row: { key: "2", col: "#" }, expect: seen(t, 1) });
      const d = diff(note, r.text);
      expect(d.added).toEqual([]);
      expect(d.removed).toEqual([note.split("\n")[t.rowLines[1]]]);
      expect(r.inverse).toEqual({ kind: "restore", heading: "backlog", at: 1, raw: note.split("\n")[t.rowLines[1]].replace(/\r$/, ""), rows: 2, sameNumber: 0 });
      expect(tableIn(r.text, "backlog")!.rows.map((row) => row[0])).toEqual(["1", "3"]);
    }
  });
  it("the only data row is cleared instead, keeping its #", () => {
    const filled = applyTableOp(S.MKT_V1_TEMPLATE, { kind: "insert", heading: "backlog", values: { format: "Screen recording", platform: "TikTok", "hook #": "1", status: "scripted" }, numberCol: "#" }).text;
    expect(tableIn(filled, "backlog")!.rows).toEqual([["1", "Screen recording", "TikTok", "1", "scripted", ""]]);
    const t = locateTable(filled.split("\n"), "backlog")!;
    const r = roundTrip(filled, { kind: "delete", heading: "backlog", row: { index: 0 }, expect: seen(t, 0) });
    expect(r.text).toBe(S.MKT_V1_TEMPLATE);
    expect(r.inverse.kind).toBe("set");
  });
  it("restore clamps its position to the end of the table and refuses a line that isn't a row", () => {
    const r = roundTrip(S.MKT_V1_FILLED, { kind: "restore", heading: "backlog", at: 99, raw: "| 9 | Extra | X | 1 | scripted | |" });
    expect(tableIn(r.text, "backlog")!.rows.map((row) => row[0])).toEqual(["1", "2", "3", "9"]);
    expect(r.inverse).toMatchObject({ kind: "delete", row: { index: 3 }, evenIfLast: true });
    expect(() => applyTableOp(S.MKT_V1_FILLED, { kind: "restore", heading: "backlog", at: 0, raw: "not a row" })).toThrow();
    expect(() => applyTableOp(S.MKT_V1_FILLED, { kind: "restore", heading: "backlog", at: 0, raw: "| a |\n| b |" })).toThrow();
  });
  it("deleting the last line of a note without a final newline, and putting it back", () => {
    for (const note of ["## T\n| # | A |\n|---|---|\n| 1 | a |\n| 2 | b |", "## T\r\n| # | A |\r\n|---|---|\r\n| 1 | a |\r\n| 2 | b |"]) {
      const r = roundTrip(note, { kind: "delete", heading: "t", row: { key: "2", col: "#" }, expect: { a: "b" } });
      expect(r.text).toBe(note.replace(/\r?\n\| 2 \| b \|$/, ""));
    }
  });
});

describe("marker", () => {
  const marker = (name: string, attrs: Record<string, string> | null, expected: Record<string, string> | null): TableOp => ({
    kind: "marker",
    heading: "competitor swipe",
    name,
    attrs,
    expect: expected,
  });

  it("a new marker joins the others in D4 order (research, request, reviewed), compact, padded and CRLF", () => {
    for (const [name, note] of Object.entries(variants(S.MKT_V2_RESEARCHED))) {
      const want = name.includes("padded") ? S.padTables(S.MKT_V2_REVIEWED) : S.MKT_V2_REVIEWED;
      const r = roundTrip(note, marker("nx-reviewed", { competitors: "2026-11-21" }, null));
      expect(r.text, name).toBe(name.includes("crlf") ? S.crlf(want) : want);
      expect(r.inverse).toEqual(marker("nx-reviewed", null, { competitors: "2026-11-21" }));
    }
    const research = roundTrip(S.MKT_V2_REQUESTED, marker("nx-research", { date: "2026-11-20", checked: "41", kept: "2", rounds: "2", sources: "crawl4ai,shorts" }, null));
    expect(research.text).toBe(S.MKT_V2_REQUESTED.replace(REQUEST, `${RESEARCH}\n${REQUEST}`));
  });
  it("the first marker goes after the table with a blank line on each side", () => {
    for (const [name, note] of Object.entries(variants(S.MKT_V2_TEMPLATE))) {
      const r = roundTrip(note, marker("nx-research-request", { date: "2026-11-18", by: "marketing" }, null));
      const want = name.includes("padded") ? S.padTables(S.MKT_V2_REQUESTED) : S.MKT_V2_REQUESTED;
      expect(r.text, name).toBe(name.includes("crlf") ? S.crlf(want) : want);
    }
  });
  it("stays after the 'How these 3 were picked' callout", () => {
    const bare = S.MKT_V2_RESEARCHED.replace(`${RESEARCH}\n${REQUEST}\n\n`, "");
    expect(bare).toContain("(G5)\n\n## 2. Hook scripts");
    const asked = roundTrip(bare, marker("nx-research-request", { date: "2026-11-18", by: "marketing" }, null)).text;
    expect(asked).toBe(S.MKT_V2_RESEARCHED.replace(`${RESEARCH}\n`, ""));
    const researched = roundTrip(asked, marker("nx-research", readMarker(RESEARCH, "nx-research"), null)).text;
    expect(researched).toBe(S.MKT_V2_RESEARCHED);
  });
  it("updates an existing marker in place, and the inverse puts back even a hand-written line", () => {
    const r = roundTrip(S.MKT_V2_REVIEWED, marker("nx-reviewed", { competitors: "2026-11-21", hooks: "2026-11-22" }, { competitors: "2026-11-21" }));
    expect(diff(S.MKT_V2_REVIEWED, r.text)).toMatchObject({ removed: [REVIEWED], added: ["<!-- nx-reviewed: competitors=2026-11-21 hooks=2026-11-22 -->"] });
    const loose = S.crlf(S.MKT_V2_REVIEWED.replace(REVIEWED, "<!--nx-reviewed:   competitors=2026-11-21-->"));
    const r2 = roundTrip(loose, marker("nx-reviewed", { competitors: "2026-11-21", hooks: "2026-11-22" }, { competitors: "2026-11-21" }));
    expect(diff(loose, r2.text).added).toEqual(["<!-- nx-reviewed: competitors=2026-11-21 hooks=2026-11-22 -->\r"]);
    const same = applyTableOp(loose, marker("nx-reviewed", { competitors: "2026-11-21" }, { competitors: "2026-11-21" }));
    expect(same.text).toBe(loose);
  });
  it("removes a marker (with its blank line when it stands alone) and the inverse puts it back", () => {
    expect(roundTrip(S.MKT_V2_REVIEWED, marker("nx-reviewed", null, { competitors: "2026-11-21" })).text).toBe(S.MKT_V2_RESEARCHED);
    expect(roundTrip(S.MKT_V2_REQUESTED, marker("nx-research-request", null, { date: "2026-11-18", by: "marketing" })).text).toBe(S.MKT_V2_TEMPLATE);
    expect(roundTrip(S.crlf(S.MKT_V2_RESEARCHED), marker("nx-research", null, readMarker(RESEARCH, "nx-research"))).text).toBe(
      S.crlf(S.MKT_V2_RESEARCHED.replace(`${RESEARCH}\n`, "")),
    );
    const odd = md("## 1. Competitor swipe", "| A |", "|---|", "| x |", REQUEST, "", "text after", "", "## 2. Next");
    roundTrip(odd, marker("nx-research-request", null, { date: "2026-11-18", by: "marketing" }));
    expect(applyTableOp(S.MKT_V2_TEMPLATE, marker("nx-reviewed", null, null)).text).toBe(S.MKT_V2_TEMPLATE);
  });
  it("handles a section that runs straight into the next heading, or to the end of a note without a final newline", () => {
    const tight = md("## 1. Competitor swipe", "| A |", "|---|", "| x |", "## 2. Next");
    const r = roundTrip(tight, marker("nx-reviewed", { hooks: "2026-11-22" }, null));
    expect(r.text).toBe(tight.replace("| x |\n", `| x |\n\n<!-- nx-reviewed: hooks=2026-11-22 -->\n`));
    for (const end of ["## 1. Competitor swipe\n| A |\n|---|\n| x |", "## 1. Competitor swipe\r\n| A |\r\n|---|\r\n| x |"]) {
      const nl = end.includes("\r") ? "\r\n" : "\n";
      expect(roundTrip(end, marker("nx-reviewed", { hooks: "2026-11-22" }, null)).text).toBe(`${end}${nl}${nl}<!-- nx-reviewed: hooks=2026-11-22 -->`);
    }
  });
  it("checks what the user saw first", () => {
    const cases: Array<[string, TableOp, string]> = [
      [S.MKT_V2_REQUESTED, marker("nx-research-request", { date: "2026-11-19", by: "dev" }, null), "someone added it"],
      [S.MKT_V2_TEMPLATE, marker("nx-research-request", null, { date: "2026-11-18", by: "marketing" }), "it's gone now"],
      [S.MKT_V2_REVIEWED, marker("nx-reviewed", { competitors: "2026-11-21", hooks: "2026-11-22" }, { competitors: "2026-11-20" }), "it says something else now"],
    ];
    for (const [note, op, words] of cases) {
      try {
        applyTableOp(note, op);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(ConflictError);
        expect((e as ConflictError).field).toBe(op.kind === "marker" ? op.name : "");
        expect((e as Error).message).toContain(words);
      }
    }
    expect(() => applyTableOp(S.MKT_V2_REVIEWED, marker("nx-reviewed", { competitors: "2026-11-21", hooks: "" }, { hooks: "", competitors: "2026-11-21" }))).not.toThrow();
  });
  it("refuses values with spaces and a missing section", () => {
    expect(() => applyTableOp(S.MKT_V2_TEMPLATE, marker("nx-reviewed", { competitors: "21 Nov" }, null))).toThrow(/can't hold spaces/);
    expect(() => applyTableOp(S.SPEC_FILLED, marker("nx-reviewed", { competitors: "2026-11-21" }, null))).toThrow(TableNotFoundError);
  });
});

describe("conflicts", () => {
  it("a stale expect throws ConflictError with the field, both values and plain words", () => {
    const op = set("hook scripts", { key: "1", col: "#" }, { hook: "new" }, { hook: `"An older hook."` });
    try {
      applyTableOp(S.MKT_V2_RESEARCHED, op);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ConflictError);
      const c = e as ConflictError;
      expect([c.field, c.expected, c.actual]).toEqual(["hook", `"An older hook."`, `"I couldn't find a de-esser with one knob, so I built one."`]);
      expect(c.message).toBe(
        `“Hook (spoken, first 3s)” changed in the note since you opened it: it now says “"I couldn't find a de-esser with one knob, so I built one."” (it said “"An older hook."”).`,
      );
    }
    expect(() => applyTableOp(S.MKT_V2_RESEARCHED, { kind: "delete", heading: "backlog", row: { index: 0 }, expect: { status: "scripted" } })).toThrow(ConflictError);
  });
  it("a row that's gone throws RowNotFoundError", () => {
    expect(() => applyTableOp(S.MKT_V1_FILLED, set("backlog", { index: 3 }, { format: "x" }))).toThrow(RowNotFoundError);
    expect(() => applyTableOp(S.MKT_V1_FILLED, { kind: "delete", heading: "backlog", row: { key: "4", col: "#" }, expect: {} })).toThrow(
      /^Number 4 isn't under “3. Content backlog \(made during days 1–14, scheduled for launch\)” any more. It may have been deleted.$/,
    );
    expect(() => applyTableOp(S.MKT_V1_FILLED, set("backlog", { index: 3 }, { format: "x" }))).toThrow(
      /^There's no line 4 under “3. Content backlog \(made during days 1–14, scheduled for launch\)” any more/,
    );
  });
  it("a table, section or column that's gone throws TableNotFoundError naming it", () => {
    const noSection = S.MKT_V1_FILLED.replace("## 4. Brand kit", "## 4. Brand assets");
    expect(() => applyTableOp(noSection, set("brand kit", { index: 0 }, { link: "x" }))).toThrow("Couldn't find the “Brand kit” part of this note. It may have been renamed or deleted.");
    const lines = S.MKT_V1_FILLED.split("\n");
    const t = locateTable(lines, "brand kit")!;
    const noTable = [...lines.slice(0, t.headerLine), ...lines.slice(t.end)].join("\n");
    try {
      applyTableOp(noTable, set("brand kit", { index: 0 }, { link: "x" }));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(TableNotFoundError);
      expect((e as TableNotFoundError).heading).toBe("brand kit");
      expect((e as Error).message).toBe(`“4. Brand kit” has no list in this note any more.`);
    }
    expect(() => applyTableOp(S.MKT_V1_FILLED, set("hook scripts", { index: 0 }, { rating: "🟢 Recommended" }))).toThrow(/has no “rating” heading any more/);
    expect(() => applyTableOp(S.MKT_V1_FILLED, { kind: "insert", heading: "nope", values: {} })).toThrow(TableNotFoundError);
    expect(() => applyTableOp(S.MKT_V1_FILLED, { kind: "restore", heading: "nope", at: 0, raw: "| a |" })).toThrow(TableNotFoundError);
  });
  it("undo refuses to overwrite a partner's later change to the same cell, but not to another cell", () => {
    const mine = applyTableOp(S.MKT_V2_RESEARCHED, set("paid test", { key: "platform", col: "item" }, { value: "TikTok" }, { value: "Meta" }));
    const theirs = applyTableOp(mine.text, set("paid test", { key: "platform", col: "item" }, { value: "Google" }, { value: "TikTok" })).text;
    expect(() => applyTableOp(theirs, mine.inverse)).toThrow(ConflictError);
    const elsewhere = applyTableOp(mine.text, set("paid test", { key: "budget", col: "item" }, { value: "$200" }, { value: "$100" })).text;
    const undone = applyTableOp(elsewhere, mine.inverse).text;
    expect(tableIn(undone, "paid test")!.rows.map((r) => cell(r, 1))).toEqual(["", "Meta", "", "$200"]);
    const added = applyTableOp(S.MKT_V1_FILLED, { kind: "insert", heading: "backlog", values: { format: "x" }, numberCol: "#" });
    const edited = applyTableOp(added.text, set("backlog", { key: "4", col: "#" }, { format: "y" }, { format: "x" })).text;
    expect(() => applyTableOp(edited, added.inverse)).toThrow(ConflictError);
  });
});

describe("table shapes", () => {
  it("rows without a trailing pipe keep that style", () => {
    const note = md("## T", "| # | Name | Note", "|---|---|---", "| 1 | a | x", "| 2 | b | y");
    expect(roundTrip(note, set("t", { key: "2", col: "#" }, { note: "z z" }, { note: "y" })).text).toBe(note.replace("| 2 | b | y", "| 2 | b | z z"));
    expect(roundTrip(note, set("t", { key: "1", col: "#" }, { name: "A" })).text).toBe(note.replace("| 1 | a | x", "| 1 | A | x"));
    expect(roundTrip(note, { kind: "insert", heading: "t", values: { name: "c", note: "w" }, numberCol: "#" }).text).toBe(`${note}| 3 | c | w\n`);
    const cleared = roundTrip(note, set("t", { key: "2", col: "#" }, { note: "" }));
    expect(tableIn(cleared.text, "t")!.rows[1]).toEqual(["2", "b", ""]);
  });
  it("short rows get the missing cells, and the inverse takes them away again", () => {
    const note = md("## T", "| # | A | B | C |", "|---|---|---|---|", "| 1 | a |", "| 2 | b");
    const one = roundTrip(note, set("t", { key: "1", col: "#" }, { c: "x" }, { c: "" }));
    expect(diff(note, one.text).added).toEqual(["| 1 | a | | x |"]);
    expect(one.inverse).toMatchObject({ kind: "set", edits: [{ row: { index: 0 }, line: "| 1 | a |", expect: { "#": "1", A: "a", B: "", C: "x" } }] });
    const two = roundTrip(note, set("t", { key: "2", col: "#" }, { b: "y" }));
    expect(tableIn(two.text, "t")!.rows[1]).toEqual(["2", "b", "y", ""]);
  });
  it("alignment separators count, and an escaped alias pipe stays inside its cell", () => {
    const note = md("## Links", "| Note | Status | Count |", "|:---|:---:|---:|", "| [[02_Active_Sprints/Demo_Tool/1_Dev_Spec\\|Spec]] | open | 1 |");
    const ref = { key: "[[02_Active_Sprints/Demo_Tool/1_Dev_Spec|Spec]]", col: "note" };
    const r = roundTrip(note, set("links", ref, { status: "done" }, { note: "[[02_Active_Sprints/Demo_Tool/1_Dev_Spec\\|Spec]]", status: "open" }));
    expect(r.text).toBe(note.replace("| open |", "| done |"));
  });
  it("an exact header wins over one that only contains the key", () => {
    const note = md("## T", "| Hook # | # |", "|---|---|", "| 3 | 1 |");
    expect(roundTrip(note, set("t", { key: "1", col: "#" }, { "#": "2" })).text).toBe(note.replace("| 3 | 1 |", "| 3 | 2 |"));
  });
});

describe("round trips over every sample table", () => {
  const VALUES = ["Zed | 9\nnext line", "", "x", "A value much longer than any column in these sample tables, so padding has to give way"];

  it("set: only the touched cell's bytes change, and the inverse gives back the note byte for byte", () => {
    let checked = 0;
    for (const [name, base] of Object.entries(ALL)) {
      for (const [variant, note] of Object.entries(variants(base))) {
        const lines = note.split("\n");
        for (const { key, t } of tablesOf(note)) {
          const sepPipes = pipesOf(lines[t.separatorLine]);
          for (let r = 0; r < t.rows.length; r++) {
            for (let c = 0; c < t.headers.length; c++) {
              for (const value of VALUES) {
                const where = `${name} ${variant} ${key} row ${r} col ${c} ${JSON.stringify(value)}`;
                const res = applyTableOp(note, set(key, { index: r }, { [t.headers[c]]: value }, { [t.headers[c]]: cell(t.rows[r], c) }));
                expect(applyTableOp(res.text, res.inverse).text, where).toBe(note);
                const after = res.text.split("\n");
                expect(after.length, where).toBe(lines.length);
                const changedLines = after.flatMap((l, i) => (l === lines[i] ? [] : [i]));
                if (changedLines.length === 0) continue;
                expect(changedLines, where).toEqual([t.rowLines[r]]);
                const old = lines[t.rowLines[r]];
                const now = after[t.rowLines[r]];
                const [p, q] = [pipesOf(old), pipesOf(now)];
                expect(now.slice(0, q[c] + 1), where).toBe(old.slice(0, p[c] + 1));
                expect(now.slice(q[c + 1]), where).toBe(old.slice(p[c + 1]));
                expect(now.endsWith("\r"), where).toBe(old.endsWith("\r"));
                const written = now.slice(q[c] + 1, q[c + 1]);
                expect(written.trim() === "" || /^ \S/.test(written), where).toBe(true);
                if (value !== "") expect(written.trim(), where).toBe(escapeCell(value));
                else expect(cell([written], 0), where).toBe("");
                // In an aligned column of a padded table (the cell is as wide as its "| --- |" separator cell),
                // text that fits keeps every pipe in place.
                const width = p[c + 1] - p[c] - 1;
                const sep = lines[t.separatorLine];
                const aligned = sep[sepPipes[c] + 1] === " " && width === sepPipes[c + 1] - sepPipes[c] - 1;
                if (aligned && value !== "" && escapeCell(value).length + 2 <= width) expect(q, where).toEqual(p);
                if (variant.startsWith("padded") && value === "x") expect(aligned, where).toBe(true);
                checked++;
              }
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(3000);
  });
  it("delete, restore and insert: the inverse gives back the note byte for byte", () => {
    for (const [name, base] of Object.entries(ALL)) {
      for (const [variant, note] of Object.entries(variants(base))) {
        for (const { key, t } of tablesOf(note)) {
          const where = `${name} ${variant} ${key}`;
          for (let r = 0; r < t.rows.length; r++) {
            const del = roundTrip(note, { kind: "delete", heading: key, row: { index: r }, expect: seen(t, r) });
            const d = diff(note, del.text);
            if (t.rows.length > 1) expect(d.removed.length - d.added.length, where).toBe(1);
            const back = applyTableOp(del.text, del.inverse);
            expect(back.text, where).toBe(note);
            expect(applyTableOp(back.text, back.inverse).text, where).toBe(del.text);
          }
          const label = t.headers.find((h) => h.trim() !== "#") ?? t.headers[0];
          const numbered = t.headers.some((h) => h.trim() === "#");
          const ins = roundTrip(note, { kind: "insert", heading: key, values: { [label]: "New | row" }, ...(numbered ? { numberCol: "#" } : {}) });
          const d = diff(note, ins.text);
          expect(d.added.length, where).toBe(1);
          expect(d.removed.length, where).toBeLessThanOrEqual(1);
        }
      }
    }
  });
  it("markers: upsert and removal of each D4 marker round-trip on every marketing note", () => {
    for (const [name, base] of Object.entries(MKT)) {
      for (const [variant, note] of Object.entries(variants(base))) {
        for (const m of ["nx-research", "nx-research-request", "nx-reviewed"]) {
          const where = `${name} ${variant} ${m}`;
          const now = readMarker(note, m);
          const up = roundTrip(note, { kind: "marker", heading: "competitor swipe", name: m, attrs: { date: "2026-12-01", hooks: "2026-12-02" }, expect: now });
          expect(readMarker(up.text, m), where).toEqual({ date: "2026-12-01", hooks: "2026-12-02" });
          const d = diff(note, up.text);
          expect(d.added.length, where).toBeLessThanOrEqual(2);
          const off = roundTrip(note, { kind: "marker", heading: "competitor swipe", name: m, attrs: null, expect: now });
          expect(readMarker(off.text, m), where).toBeNull();
          expect(applyTableOp(applyTableOp(off.text, off.inverse).text, { kind: "marker", heading: "competitor swipe", name: m, attrs: null, expect: now }).text, where).toBe(off.text);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------------
// Regression tests for the 0.5.0 review findings
// ---------------------------------------------------------------------------------------------------

describe("undo never lands on another row", () => {
  const goLive = (note: string) => tableIn(note, "backlog")!.rows.map((r) => `${r[0]}: ${cell(r, 5)}`);

  it("set by #, then a partner deletes the row above: Undo refuses instead of writing into the next row", () => {
    const mine = applyTableOp(S.MKT_V1_FILLED, set("backlog", { key: "2", col: "#" }, { "go-live": "2026-11-16" }, { "go-live": "2026-11-14" }));
    const theirs = applyTableOp(mine.text, { kind: "delete", heading: "backlog", row: { key: "1", col: "#" }, expect: {} }).text;
    expect(goLive(theirs)).toEqual(["2: 2026-11-16", "3: 2026-11-16"]);
    expect(() => applyTableOp(theirs, mine.inverse)).toThrow(ConflictError);
  });
  it("a cleared paid-test value never goes back into the row below it", () => {
    const mine = applyTableOp(S.MKT_V2_RESEARCHED, set("paid test", { key: "platform", col: "item" }, { value: "" }, { value: "Meta" }));
    const theirs = applyTableOp(mine.text, { kind: "delete", heading: "paid test", row: { index: 0 }, expect: {} }).text;
    expect(() => applyTableOp(theirs, mine.inverse)).toThrow(ConflictError);
  });
  it("a CTA that matches the next row's still finds its own row", () => {
    const mine = applyTableOp(S.MKT_V2_RESEARCHED, set("hook scripts", { key: "7", col: "#" }, { cta: "Link in bio." }, { cta: "$29 once. Link in bio." }));
    const theirs = applyTableOp(mine.text, { kind: "delete", heading: "hook scripts", row: { key: "1", col: "#" }, expect: {} }).text;
    expect(() => applyTableOp(theirs, mine.inverse)).toThrow(ConflictError);
    expect(applyTableOp(mine.text, mine.inverse).text).toBe(S.MKT_V2_RESEARCHED);
  });
  it("filling a free row or clearing the only row, then a partner puts a row above it", () => {
    const filled = applyTableOp(S.MKT_V2_TEMPLATE, { kind: "insert", heading: "competitor swipe", values: { competitor: "Acme Vox" } });
    const above = applyTableOp(filled.text, { kind: "restore", heading: "competitor swipe", at: 0, raw: "| Acme Vox | x | y | z |" }).text;
    expect(() => applyTableOp(above, filled.inverse)).toThrow(ConflictError);

    const one = applyTableOp(S.MKT_V1_TEMPLATE, { kind: "insert", heading: "backlog", values: { format: "Screen recording", status: "scripted" }, numberCol: "#" }).text;
    const cleared = applyTableOp(one, { kind: "delete", heading: "backlog", row: { index: 0 }, expect: {} });
    const partner = applyTableOp(cleared.text, { kind: "restore", heading: "backlog", at: 0, raw: "| 2 | | | | | |" }).text;
    expect(() => applyTableOp(partner, cleared.inverse)).toThrow(ConflictError);
    expect(applyTableOp(cleared.text, cleared.inverse).text).toBe(one);
  });
});

describe("restore can't run twice", () => {
  it("a double-tapped Undo of a delete puts the row back once, then refuses", () => {
    const del = applyTableOp(S.MKT_V1_FILLED, { kind: "delete", heading: "backlog", row: { key: "2", col: "#" }, expect: {} });
    const once = applyTableOp(del.text, del.inverse).text;
    expect(once).toBe(S.MKT_V1_FILLED);
    expect(() => applyTableOp(once, del.inverse)).toThrow(ConflictError);
    expect(tableIn(once, "backlog")!.rows.map((r) => r[0])).toEqual(["1", "2", "3"]);
  });
  it("identical empty rows still come back (the template's competitor rows 2 and 3)", () => {
    const del = roundTrip(S.MKT_V2_TEMPLATE, { kind: "delete", heading: "competitor swipe", row: { index: 1 }, expect: {} });
    const back = applyTableOp(del.text, del.inverse).text;
    expect(() => applyTableOp(back, del.inverse)).toThrow(ConflictError);
  });
});

describe("clearing a cell after other changes in the same edit", () => {
  it("a rating change and a cleared hook in one edit: the hook gets the new rating's example, in any key order", () => {
    const draft = applyTableOp(S.MKT_V2_TEMPLATE, set("hook scripts", { key: "4", col: "#" }, { hook: "Some draft hook" })).text;
    for (const values of [{ rating: "🔴 Don't use", hook: "" }, { hook: "", rating: "🔴 Don't use" }]) {
      const r = roundTrip(draft, set("hook scripts", { key: "4", col: "#" }, values, { rating: "🟡 Medium", hook: "Some draft hook" }));
      expect(diff(draft, r.text).added, JSON.stringify(values)).toEqual([`| 4 | 🔴 Don't use | ${span("e.g. brand-first opening: logo and name before the demo")} | | | |`]);
    }
    const avoid = applyTableOp(S.MKT_V2_TEMPLATE, set("hook scripts", { key: "10", col: "#" }, { hook: "Follow-ask opening." })).text;
    const r = roundTrip(avoid, set("hook scripts", { key: "10", col: "#" }, { hook: "", rating: "🟢 Recommended" }, { hook: "Follow-ask opening." }));
    expect(diff(avoid, r.text).added).toEqual([`| 10 | 🟢 Recommended | ${span(`e.g. "I couldn't find a tool that does ___, so I built one."`)} | — | — | |`]);
  });
  it("uses the same rating rule as the dashboard: a Medium row that mentions 'avoid' is still Medium", () => {
    const note = S.MKT_V2_TEMPLATE.replace("| 4 | 🟡 Medium | | | | |", "| 4 | 🟡 Medium (avoid hype words) | Typed opening line | | | |");
    expect(note).not.toBe(S.MKT_V2_TEMPLATE);
    const r = roundTrip(note, set("hook scripts", { key: "4", col: "#" }, { hook: "" }, { hook: "Typed opening line" }));
    expect(diff(note, r.text).added).toEqual([`| 4 | 🟡 Medium (avoid hype words) | ${span(`e.g. "I couldn't find a tool that does ___, so I built one."`)} | | | |`]);
  });
  it("a header that only contains the letters 'rating' isn't a Rating column", () => {
    const note = md(
      "## 2. Hook scripts",
      "| # | Hook (spoken, first 3s) | Demo shot (demonstrating it) | CTA |",
      "|---|---|---|---|",
      `| 1 | "Typed hook." | Avoid the logo intro | Link in bio. |`,
      `| 2 | ${span("e.g. a hook")} | Screen | |`,
    );
    const r = roundTrip(note, set("hook scripts", { key: "1", col: "#" }, { hook: "" }));
    expect(tableIn(r.text, "hook scripts")!.rows[0][1]).toBe(span("e.g. a hook"));
  });
});

describe("clearing a key-value row puts its template example back", () => {
  it("brand kit, paid test plan and the Dev Spec profile rows; other key-value tables stay empty", () => {
    const kit = roundTrip(S.MKT_V2_RESEARCHED, set("brand kit", { key: "Landing page", col: "asset" }, { link: "" }, { link: "https://example.com/demo-tool" }));
    expect(diff(S.MKT_V2_RESEARCHED, kit.text).added).toEqual([`| Landing page | ${span("e.g. link to the one-page site")} |`]);
    const paid = roundTrip(S.MKT_V2_RESEARCHED, set("paid test", { key: "platform", col: "item" }, { value: "" }, { value: "Meta" }));
    expect(diff(S.MKT_V2_RESEARCHED, paid.text).added).toEqual([`| Platform | ${span("e.g. Meta, TikTok or Google")} |`]);
    const price = roundTrip(S.SPEC_FILLED, set("pitch", { key: "Price", col: "item" }, { value: "" }, { value: "$29 one-time" }));
    expect(diff(S.SPEC_FILLED, price.text).added).toEqual([`| Price | ${span("e.g. $29 one-time, $5/month, or free + in-game items")} |`]);
    const tech = roundTrip(S.SPEC_FILLED, set("tech preset", { key: "Language", col: "item" }, { value: "" }, { value: "C++" }));
    expect(diff(S.SPEC_FILLED, tech.text).added).toEqual(["| Language | |"]);
  });
});

describe("line endings and odd rows", () => {
  const MIXED = "---\r\nproject: Demo_Tool\r\n---\r\n## 1. Competitor swipe\n| # | A |\n|---|---|\n| 1 | a |\n| 2 | b |\n";

  it("a CRLF frontmatter over an LF table: new and restored rows end like the table's rows", () => {
    roundTrip(MIXED, { kind: "delete", heading: "competitor swipe", row: { key: "1", col: "#" }, expect: { a: "a" } });
    const ins = roundTrip(MIXED, { kind: "insert", heading: "competitor swipe", values: { a: "c" }, numberCol: "#" });
    expect(ins.text).toBe(MIXED.replace("| 2 | b |\n", "| 2 | b |\n| 3 | c |\n"));
    const lfOverCrlf = "---\nproject: Demo_Tool\n---\n## T\r\n| # | A |\r\n|---|---|\r\n| 1 | a |";
    const end = roundTrip(lfOverCrlf, { kind: "insert", heading: "t", values: { a: "b" }, numberCol: "#" });
    expect(end.text).toBe(`${lfOverCrlf}\r\n| 2 | b |`);
  });
  it("markers too: an LF marker in a note with a CRLF frontmatter comes back as it was", () => {
    const added = roundTrip(MIXED, { kind: "marker", heading: "competitor swipe", name: "nx-reviewed", attrs: { hooks: "2026-11-22" }, expect: null });
    expect(added.text).toBe(`${MIXED}\n<!-- nx-reviewed: hooks=2026-11-22 -->\n`);
    roundTrip(added.text, { kind: "marker", heading: "competitor swipe", name: "nx-reviewed", attrs: null, expect: { hooks: "2026-11-22" } });
  });
  it("undoing a new marker keeps a blank line that holds spaces", () => {
    const note = "## 1. Competitor swipe\n| A |\n|---|\n| x |\n   \n## 2. Next\n";
    const r = roundTrip(note, { kind: "marker", heading: "competitor swipe", name: "nx-research-request", attrs: { date: "2026-11-18", by: "marketing" }, expect: null });
    expect(r.text).toBe("## 1. Competitor swipe\n| A |\n|---|\n| x |\n   \n<!-- nx-research-request: date=2026-11-18 by=marketing -->\n\n## 2. Next\n");
    const removed = roundTrip(r.text, { kind: "marker", heading: "competitor swipe", name: "nx-research-request", attrs: null, expect: { date: "2026-11-18", by: "marketing" } });
    expect(removed.text).toBe(note);
  });
  it("a short row without a trailing pipe whose last cell ends in a backslash", () => {
    const note = md("## T", "| # | A | B |", "|---|---|---|", "| 1 | C:\\");
    const r = roundTrip(note, set("t", { key: "1", col: "#" }, { b: "x" }));
    expect(tableIn(r.text, "t")!.rows[0]).toEqual(["1", "C:\\", "x"]);
  });
  it("an empty column key never matches the first column", () => {
    expect(() => applyTableOp(S.MKT_V2_RESEARCHED, set("brand kit", { index: 0 }, { "": "x" }))).toThrow(TableNotFoundError);
  });
});

// ---------------------------------------------------------------------------------------------------
// Fix round: rows named twice, and Undo in any order
// ---------------------------------------------------------------------------------------------------

describe("findRows: one lookup for tableEdit, the parsers and the edit sheets", () => {
  it("an exact match first, else every row that starts with the key; a number only ever matches exactly", () => {
    expect(findRows(["Logo (dark)", "Logo", "Landing page"], "logo")).toEqual([1]);
    expect(findRows(["Logo (dark)", "Logo (light)"], "Logo")).toEqual([0, 1]);
    expect(findRows(["Budget (max $300 per sprint)"], "budget")).toEqual([0]);
    expect(findRows(["30", "3", "13"], "3")).toEqual([1]);
    expect(findRows(["30", "31"], "3")).toEqual([]);
    expect(findRows(["Stripe product / payment link", "stripe PRODUCT / payment link"], "Stripe product / payment link")).toEqual([0, 1]);
    expect(findRows([span("e.g. 1"), "1"], "1")).toEqual([1]);
  });
});

describe("a # or label that more than one row has is refused, never guessed", () => {
  const twin = (note: string, line: string, copy: string) => {
    expect(note).toContain(`\n${line}\n`);
    return note.replace(`\n${line}\n`, `\n${line}\n${copy}\n`);
  };
  const BACKLOG_3 = "| 3 | Close-up of the knob, 10s | Shorts | 3 | scripted | 2026-11-16 |";

  it("set and delete by a # two rows have: plain words, and nothing is written", () => {
    const note = twin(S.MKT_V1_FILLED, BACKLOG_3, "| 3 | Phone recording, 12s | TikTok | 2 | scripted | |");
    for (const op of [
      set("backlog", { key: "3", col: "#" }, { status: "recorded" }, { status: "scripted" }),
      { kind: "delete", heading: "backlog", row: { key: "3", col: "#" }, expect: {} } as TableOp,
    ]) {
      try {
        applyTableOp(note, op);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(AmbiguousRowError);
        expect((e as Error).message).toBe(
          "2 lines under “3. Content backlog (made during days 1–14, scheduled for launch)” are numbered 3, so it isn't clear which one to change. Give each its own number in the note, then try again.",
        );
      }
    }
    // By position, the second #3 is fine.
    const r = roundTrip(note, set("backlog", { index: 3 }, { status: "recorded" }, { "#": "3", status: "scripted", format: "Phone recording, 12s" }));
    expect(tableIn(r.text, "backlog")!.rows.map((x) => `${x[0]} ${x[1]} ${x[4]}`)).toEqual([
      "1 Screen recording + your voice, 20s scheduled",
      "2 Before/after split screen, 15s recorded",
      "3 Close-up of the knob, 10s scripted",
      "3 Phone recording, 12s recorded",
    ]);
  });
  it("a label two rows have (any case), or a start two labels share", () => {
    const kit = twin(S.MKT_V2_RESEARCHED, "| Logo | <span class=\"nx-eg\">e.g. link to the logo file</span> |", "| logo | <span class=\"nx-eg\">e.g. link to the logo file</span> |");
    expect(() => applyTableOp(kit, set("brand kit", { key: "Logo", col: "asset" }, { link: "https://example.com/logo.png" }))).toThrow(
      "2 lines under “4. Brand kit” are called “Logo”, so it isn't clear which one to change. Give each its own name in the note, then try again.",
    );
    const paid = S.MKT_V2_RESEARCHED.replace("| Platform | Meta |", "| Platform | Meta |\n| Platform (backup) | TikTok |");
    expect(applyTableOp(paid, set("paid test", { key: "Platform", col: "item" }, { value: "Google" }, { value: "Meta" })).text).toContain("| Platform | Google |");
    expect(() => applyTableOp(paid, set("paid test", { key: "Plat", col: "item" }, { value: "Google" }))).toThrow(/start with “Plat”/);
  });
});

describe("Undo works in any order", () => {
  const nums = (note: string) => tableIn(note, "backlog")!.rows.map((r) => r[0]);
  const del = (note: string, n: string) => {
    const t = locateTable(note.split("\n"), "backlog")!;
    const i = t.rows.findIndex((r) => r[0] === n);
    return applyTableOp(note, { kind: "delete", heading: "backlog", row: { key: n, col: "#" }, expect: { format: cell(t.rows[i], 1) } });
  };

  it("two deletes: the older Undo first, then the newer, puts both back where they were (compact, padded, CRLF)", () => {
    for (const [name, note] of Object.entries(variants(S.MKT_V1_FILLED))) {
      const one = del(note, "1");
      const two = del(one.text, "2");
      expect(nums(two.text), name).toEqual(["3"]);
      const back1 = applyTableOp(two.text, one.inverse).text;
      expect(nums(back1), name).toEqual(["1", "3"]);
      const back2 = applyTableOp(back1, two.inverse).text;
      expect(back2, name).toBe(note);
      // Each Undo still runs once only.
      expect(() => applyTableOp(back2, one.inverse), name).toThrow(ConflictError);
      expect(() => applyTableOp(back2, two.inverse), name).toThrow(ConflictError);
    }
  });
  it("two deletes undone newest first still give the note back", () => {
    const one = del(S.MKT_V1_FILLED, "3");
    const two = del(one.text, "2");
    expect(applyTableOp(applyTableOp(two.text, two.inverse).text, one.inverse).text).toBe(S.MKT_V1_FILLED);
    const a = del(S.MKT_V1_FILLED, "3");
    const b = del(a.text, "2");
    expect(applyTableOp(applyTableOp(b.text, a.inverse).text, b.inverse).text).toBe(S.MKT_V1_FILLED);
  });
  it("two added videos: the older Undo first takes back its own row by number", () => {
    for (const [name, note] of Object.entries(variants(S.MKT_V1_FILLED))) {
      const four = applyTableOp(note, { kind: "insert", heading: "backlog", values: { "hook #": "1" }, numberCol: "#" });
      const five = applyTableOp(four.text, { kind: "insert", heading: "backlog", values: { "hook #": "2" }, numberCol: "#" });
      expect(nums(five.text), name).toEqual(["1", "2", "3", "4", "5"]);
      expect(four.inverse, name).toMatchObject({ kind: "delete", row: { key: "4", col: "#" } });
      const undone4 = applyTableOp(five.text, four.inverse).text;
      expect(nums(undone4), name).toEqual(["1", "2", "3", "5"]);
      expect(applyTableOp(undone4, five.inverse).text, name).toBe(note);
    }
  });
  it("a deleted video whose number went to a new video since isn't put back, and the new video's Undo still works", () => {
    for (const [name, note] of Object.entries(variants(S.MKT_V1_FILLED))) {
      const gone = del(note, "3");
      const added = applyTableOp(gone.text, { kind: "insert", heading: "backlog", values: { "hook #": "1" }, numberCol: "#" });
      expect(nums(added.text), name).toEqual(["1", "2", "3"]);
      expect(() => applyTableOp(added.text, gone.inverse), name).toThrow(/Number 3 was given to another line/);
      expect(applyTableOp(added.text, added.inverse).text, name).toBe(gone.text);
    }
  });
  it("a filled example line is taken back by its number, so its Undo works after a line above is deleted", () => {
    for (const [name, note] of Object.entries(variants(S.MKT_V2_RESEARCHED))) {
      const fill = applyTableOp(note, { kind: "insert", heading: "backlog", values: { "hook #": "4" }, numberCol: "#" });
      expect(fill.inverse, name).toMatchObject({ kind: "set", edits: [{ row: { key: "2", col: "#" } }] });
      const t = locateTable(fill.text.split("\n"), "backlog")!;
      const firstGone = applyTableOp(fill.text, { kind: "delete", heading: "backlog", row: { key: "1", col: "#" }, expect: { format: cell(t.rows[0], 1) } });
      const undone = applyTableOp(firstGone.text, fill.inverse).text;
      expect(tableIn(undone, "backlog")!.rows.map((r) => `${r[0]}:${cell(r, 3)}`), name).toEqual(["2:"]);
    }
  });
  it("a deleted video whose number another line also has still comes back", () => {
    const note = S.MKT_V1_FILLED.replace("| 3 | Close-up of the knob, 10s |", "| 3 | Phone recording, 12s | TikTok | 2 | scripted | |\n| 3 | Close-up of the knob, 10s |");
    const r = roundTrip(note, { kind: "delete", heading: "backlog", row: { index: 3 }, expect: { "#": "3", format: "Close-up of the knob, 10s" } });
    expect(nums(r.text)).toEqual(["1", "2", "3"]);
  });
});
