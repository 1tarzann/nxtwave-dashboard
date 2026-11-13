import { describe, expect, it } from "vitest";
import {
  cell,
  EXAMPLE_OPEN_RE,
  EXAMPLE_RE,
  exampleIn,
  isPlaceholder,
  parseTable,
  plainText,
  section,
  sectionRange,
  SEPARATOR,
  splitRow,
  stripExamples,
  tableIn,
} from "../src/data/markdown";
import { readFrontmatterRaw } from "../src/data/templates";
import * as S from "./samples";

const MKT_SAMPLES = {
  MKT_V1_TEMPLATE: S.MKT_V1_TEMPLATE,
  MKT_V1_FILLED: S.MKT_V1_FILLED,
  MKT_V2_TEMPLATE: S.MKT_V2_TEMPLATE,
  MKT_V2_REQUESTED: S.MKT_V2_REQUESTED,
  MKT_V2_RESEARCHED: S.MKT_V2_RESEARCHED,
  MKT_V2_PADDED: S.MKT_V2_PADDED,
  MKT_V2_REVIEWED: S.MKT_V2_REVIEWED,
  MKT_HALF_DELETED: S.MKT_HALF_DELETED,
};
const SPEC_SAMPLES = {
  SPEC_EMPTY: S.SPEC_EMPTY,
  SPEC_FILLED: S.SPEC_FILLED,
  SPEC_SPAN_ONLY: S.SPEC_SPAN_ONLY,
  SPEC_TBD: S.SPEC_TBD,
  SPEC_NO_TABLE: S.SPEC_NO_TABLE,
};
const ALL_SAMPLES: Record<string, string> = { ...MKT_SAMPLES, ...SPEC_SAMPLES };

const span = (text: string) => `<span class="nx-eg">${text}</span>`;

describe("stripExamples", () => {
  it("removes a span with double quotes", () => {
    expect(stripExamples(span("e.g. their exact first words"))).toBe("");
  });
  it("removes a span with single quotes", () => {
    expect(stripExamples("<span class='nx-eg'>e.g. Link in bio.</span>")).toBe("");
  });
  it("allows other attributes and other classes", () => {
    expect(stripExamples('<span title="hint" class="nx-eg" data-row="1">e.g. a</span>')).toBe("");
    expect(stripExamples('<span class = "big nx-eg">e.g. b</span>')).toBe("");
    expect(stripExamples("<span id=x class='nx-eg small'>e.g. c</span>")).toBe("");
  });
  it("matches the tag in any case", () => {
    expect(stripExamples('<SPAN CLASS="nx-eg">e.g. day 15</SPAN>')).toBe("");
    expect(stripExamples('<Span class="nx-eg">e.g. day 15</span >')).toBe("");
  });
  it("removes several spans and keeps the text around them", () => {
    const s = `a ${span("e.g. 1")} b <span class='nx-eg'>e.g. 2</span> c`;
    expect(stripExamples(s)).toBe("a  b  c");
  });
  it("removes a span whose example runs over two lines", () => {
    expect(stripExamples(`${span("e.g. line one\nline two")}after`)).toBe("after");
  });
  it("removes a half-deleted opening tag up to the end of the string", () => {
    expect(stripExamples('<span class="nx-eg">e.g. half deleted')).toBe("");
    expect(stripExamples('typed <span class="nx-eg">e.g. half deleted')).toBe("typed ");
    expect(stripExamples(`${span("e.g. x")}typed <span class="nx-eg">e.g. y`)).toBe("typed ");
  });
  it("a half-deleted span doesn't swallow the complete span after it", () => {
    expect(stripExamples(`<span class="nx-eg">e.g. a ${span("e.g. b")}`)).toBe("");
    expect(exampleIn(`<span class="nx-eg">e.g. a ${span("e.g. b")}`)).toBe("e.g. a");
  });
  it("removes a lone closing tag and keeps the text before it", () => {
    expect(stripExamples("e.g. orphan text</span>")).toBe("e.g. orphan text");
    expect(stripExamples("real</SPAN> value")).toBe("real value");
  });
  it("leaves other spans and plain text alone", () => {
    expect(stripExamples('<span class="note">kept</span>')).toBe('<span class="note">kept</span>');
    expect(stripExamples('<span class="nx-egg">kept</span>')).toBe('<span class="nx-egg">kept</span>');
    expect(stripExamples('<span data-class="nx-eg">kept</span>')).toBe('<span data-class="nx-eg">kept</span>');
    expect(stripExamples('<span style="color:red">a</span> b</span>')).toBe('<span style="color:red">a</span> b');
    expect(stripExamples("Acme Vox · e.g. plain text")).toBe("Acme Vox · e.g. plain text");
    expect(stripExamples("")).toBe("");
  });
  it("the exported patterns find what stripExamples removes", () => {
    const s = `x ${span("e.g. 1")} y ${span("e.g. 2")}`;
    expect([...s.matchAll(EXAMPLE_RE)].map((m) => m[1])).toEqual(["e.g. 1", "e.g. 2"]);
    expect(s.replace(EXAMPLE_RE, "")).toBe(stripExamples(s));
    expect(EXAMPLE_OPEN_RE.test(s)).toBe(true);
    expect(EXAMPLE_OPEN_RE.test(s)).toBe(true); // not global: no lastIndex state between calls
    expect(EXAMPLE_OPEN_RE.test("e.g. orphan text</span>")).toBe(false);
  });
  it("leaves no example markup in any sample cell, and a second pass changes nothing", () => {
    for (const body of Object.values(ALL_SAMPLES)) {
      for (const line of body.split("\n").filter((l) => /^(> )?\|/.test(l))) {
        for (const c of splitRow(line.replace(/^> /, ""))) {
          const once = stripExamples(c);
          expect(once).not.toMatch(/nx-eg|<\/?span/i);
          expect(stripExamples(once)).toBe(once);
        }
      }
    }
  });
});

describe("exampleIn", () => {
  it("returns the trimmed inner text of a complete span", () => {
    expect(exampleIn(span("  e.g. their exact first words, in quotes  "))).toBe("e.g. their exact first words, in quotes");
    expect(exampleIn("<span class='nx-eg' title=x>e.g. 1</span>")).toBe("e.g. 1");
  });
  it("returns the first of several", () => {
    expect(exampleIn(`${span("e.g. first")} ${span("e.g. second")}`)).toBe("e.g. first");
  });
  it("reads a half-deleted span to the end of the string", () => {
    expect(exampleIn('<span class="nx-eg">e.g. half deleted ')).toBe("e.g. half deleted");
  });
  it("finds a span next to typed text", () => {
    expect(exampleIn(`Acme ${span("e.g. x")}`)).toBe("e.g. x");
  });
  it("is empty without an opening tag", () => {
    expect(exampleIn("Acme Vox")).toBe("");
    expect(exampleIn("e.g. orphan text</span>")).toBe("");
    expect(exampleIn('<span class="note">x</span>')).toBe("");
    expect(exampleIn("")).toBe("");
  });
});

describe("isPlaceholder", () => {
  it("empty and whitespace", () => {
    expect(isPlaceholder("")).toBe(true);
    expect(isPlaceholder("   \t ")).toBe(true);
  });
  it("anything with ___", () => {
    expect(isPlaceholder(`"I couldn't find a tool that does ___, so I built one."`)).toBe(true);
    expect(isPlaceholder("___")).toBe(true);
  });
  it("the placeholder words, exactly and in any case", () => {
    for (const v of ["tbd", "TBD", " Tbd ", "todo", "TODO", "?", "??", "???", "-", "—", "–", "n/a", "N/A", " N/a ", "na", "None", "none"]) {
      expect(isPlaceholder(v), v).toBe(true);
    }
  });
  it("surrounding double quotes don't hide a placeholder", () => {
    for (const v of ['"TBD"', '""', '" "', '"___"']) expect(isPlaceholder(v), v).toBe(true);
    expect(isPlaceholder('"I built a de-esser"')).toBe(false);
  });
  it("MISSING: lines from research, in any case", () => {
    expect(isPlaceholder("MISSING: competitor 3 (checked 41, none passed all 6 checks)")).toBe(true);
    expect(isPlaceholder("  MISSING: evidence for a Recommended hook")).toBe(true);
    expect(isPlaceholder("missing: price")).toBe(true);
  });
  it("left-over example text, in any case", () => {
    expect(isPlaceholder("e.g. orphan text")).toBe(true);
    expect(isPlaceholder("e.g.")).toBe(true);
    expect(isPlaceholder("E.g. x")).toBe(true);
  });
  it("the cases competitor-scout pins too (same rule in both repos)", () => {
    const yes = ["", "   ", "___", `"I couldn't find a tool that does ___, so I built one."`, "TBD", '"TBD"', "todo", "?", "???", "-", "—", "–",
      "n/a", "N/A", "na", "None", "MISSING: price", "missing: price", "e.g. who pays", "E.g. x", '<span class="nx-eg">e.g. x</span>',
      '<span class="nx-eg">e.g. half', "e.g. orphan</span>", '<span data-x="1" class="big nx-eg">e.g. y</span>'];
    for (const v of yes) expect(isPlaceholder(v), v).toBe(true);
    for (const v of ["$29", "0", "No", "TBD later", "n/a.", "Acme Vox", "Nonesuch"]) expect(isPlaceholder(v), v).toBe(false);
  });
  it("raw cells that hold only an example, whole or half-deleted", () => {
    expect(isPlaceholder(span("e.g. $29 one-time"))).toBe(true);
    expect(isPlaceholder('<span class="nx-eg">e.g. half deleted')).toBe(true);
    expect(isPlaceholder("e.g. orphan text</span>")).toBe(true);
  });
  it("real values are not placeholders", () => {
    for (const v of ["$29", "Acme Vox", "0", "No", "TBD later", "todo list", "n/a.", "Missing piece", "— 2 videos", "eg. typed", "[Acme Vox](https://example.com/acme-vox)", "$29 one-time"]) {
      expect(isPlaceholder(v), v).toBe(false);
    }
    expect(isPlaceholder(`Acme ${span("e.g. x")}`)).toBe(false);
  });
});

describe("cell and plainText", () => {
  it("an example-only cell is empty", () => {
    expect(cell([span("e.g. link to the logo file")], 0)).toBe("");
    expect(cell(['<span class="nx-eg">e.g. half deleted'], 0)).toBe("");
    expect(cell(["e.g. orphan text</span>"], 0)).toBe("e.g. orphan text");
  });
  it("keeps typed text and trims", () => {
    expect(cell(["  Demo Tool  "], 0)).toBe("Demo Tool");
    expect(cell([`Demo Tool ${span("e.g. x")}`], 0)).toBe("Demo Tool");
    expect(cell(["a"], -1)).toBe("");
    expect(cell(["a"], 3)).toBe("");
  });
  it("no table cell of the v2 template reads as an example", () => {
    for (const key of ["competitor swipe", "hook scripts", "content backlog", "brand kit", "paid test"]) {
      const t = tableIn(S.MKT_V2_TEMPLATE, key)!;
      for (const r of t.rows) for (let i = 0; i < r.length; i++) expect(cell(r, i)).not.toMatch(/nx-eg|e\.g\./);
    }
    const brand = tableIn(S.MKT_V2_TEMPLATE, "brand kit")!;
    expect(brand.rows.map((r) => cell(r, 1))).toEqual(["", "", "", "", "", ""]);
    expect(brand.rows.map((r) => exampleIn(r[1]))[5]).toBe("e.g. the Stripe payment link, never a secret key");
  });
  it("plainText strips examples before links", () => {
    expect(plainText(`${span("e.g. [x](https://example.com)")} [Acme Vox](https://example.com/acme-vox)`)).toBe("Acme Vox");
    expect(plainText("[[02_Active_Sprints/Demo_Tool/1_Dev_Spec|Spec]] <span class='nx-eg'>e.g. half")).toBe("Spec");
    expect(plainText(span("e.g. one line a stranger understands"))).toBe("");
    expect(plainText("e.g. orphan</span> `code`")).toBe("e.g. orphan code");
  });
});

describe("sectionRange", () => {
  const doc = ["# Title", "intro", "## 1. A", "alpha", "### sub", "beta", "## 2. B", "gamma"];

  it("gives the heading line, the first line after it and where the section ends", () => {
    expect(sectionRange(doc, "1. a")).toEqual({ headingLine: 2, start: 3, end: 6, level: 2 });
    expect(sectionRange(doc, "2. B")).toEqual({ headingLine: 6, start: 7, end: 8, level: 2 });
    expect(sectionRange(doc, "nope")).toBeNull();
  });
  it("nested headings stay inside; a section ends at the same or a higher level", () => {
    expect(sectionRange(doc, "sub")).toEqual({ headingLine: 4, start: 5, end: 6, level: 3 });
    expect(sectionRange(doc, "title")).toEqual({ headingLine: 0, start: 1, end: 8, level: 1 });
    expect(sectionRange(["## A", "#### deep", "### mid", "## B"], "deep")).toEqual({ headingLine: 1, start: 2, end: 2, level: 4 });
  });
  it("the first matching heading wins, case-insensitive", () => {
    expect(sectionRange(["## Pitch notes", "x", "## Pitch", "y"], "PITCH")?.headingLine).toBe(0);
  });
  it("skips headings inside ``` and ~~~ fences, for finding and for ending", () => {
    const lines = ["## 1. A", "```", "## 2. not a heading", "```", "~~~", "# also not", "~~~", "after", "## 3. C", "end"];
    expect(sectionRange(lines, "1. a")).toEqual({ headingLine: 0, start: 1, end: 8, level: 2 });
    expect(sectionRange(lines, "not a heading")).toBeNull();
    expect(sectionRange(lines, "also not")).toBeNull();
    const spec = S.SPEC_FILLED.split("\n");
    const tree = sectionRange(spec, "file tree")!;
    expect(spec.slice(tree.start, tree.end)).toContain("# build/ is made by the build script");
    expect(spec[tree.end]).toBe("## 6. Build plan (days 1–14)");
  });
  it("lines split on \\n alone keep their \\r and give the same ranges", () => {
    for (const body of Object.values(ALL_SAMPLES)) {
      const lf = body.split("\n");
      const cr = S.crlf(body).split("\n");
      expect(cr.length).toBe(lf.length);
      for (const key of ["competitor swipe", "hook scripts", "content backlog", "brand kit", "paid test", "pitch", "tech preset", "file tree", "build plan", "dev spec", "marketing engine"]) {
        expect(sectionRange(cr, key), key).toEqual(sectionRange(lf, key));
      }
    }
    const cr = S.crlf(S.MKT_V2_RESEARCHED).split("\n");
    const r = sectionRange(cr, "hook scripts")!;
    expect(cr[r.headingLine]).toBe("## 2. Hook scripts (native UGC demo)\r");
    expect(cr[r.end]).toBe("## 3. Content backlog (made during days 1–14, scheduled for launch)\r");
  });
  it("its lines are exactly what section() returns", () => {
    for (const body of Object.values(ALL_SAMPLES)) {
      const lines = body.split(/\r?\n/);
      for (const key of ["swipe", "hook", "backlog", "brand", "paid", "pitch", "mechanics", "tech", "plan", "questions"]) {
        const r = sectionRange(lines, key);
        expect(r ? lines.slice(r.start, r.end).join("\n") : null).toBe(section(body, key));
      }
    }
  });
});

/** section() as it was before sectionRange existed: the reference for "behaves exactly as before". */
function legacySection(body: string, key: string): string | null {
  const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
  const FENCE = /^\s*(```|~~~)/;
  const lines = body.split(/\r?\n/);
  const needle = key.toLowerCase();
  let inFence = false;
  let start = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (FENCE.test(line)) inFence = !inFence;
    if (inFence) continue;
    const m = HEADING.exec(line);
    if (!m) continue;
    if (start === -1) {
      if (m[2].toLowerCase().includes(needle)) {
        start = i + 1;
        level = m[1].length;
      }
    } else if (m[1].length <= level) {
      return lines.slice(start, i).join("\n");
    }
  }
  return start === -1 ? null : lines.slice(start).join("\n");
}

describe("section", () => {
  const edgeCases = [
    "",
    "no headings at all",
    "## 1. A\nalpha\n```\n## not a heading\n```\n### sub\nbeta\n## 2. B\ngamma",
    "# H1\n## Two ##\ntext\n###### six\n####### seven is text\n#hashtag\n## Three",
    "## Open fence\n```\n## never ends\n# still code",
    "~~~\n## inside\n~~~\n## outside\nx",
    "  ## indented\n## real\n\tx",
    "##\n## \nempty titles\n# end",
    "## A\r\nline\r\n## B\r\nline",
    "> ## quoted\n## A\n> ## quoted too\n## B",
  ];
  const keys = ["", "a", "1. a", "two", "six", "seven", "hashtag", "never", "inside", "outside", "indented", "real", "b", "quoted", "missing", "#"];

  it("behaves exactly as before on edge cases", () => {
    for (const body of edgeCases) for (const key of keys) expect(section(body, key), JSON.stringify([body, key])).toBe(legacySection(body, key));
  });
  it("behaves exactly as before on every sample, LF and CRLF", () => {
    for (const body of Object.values(ALL_SAMPLES)) {
      const headingKeys = [...body.matchAll(/^#{1,6}\s+(.*)$/gm)].map((m) => m[1].toLowerCase());
      for (const text of [body, S.crlf(body)]) {
        for (const key of [...headingKeys, "", "1.", "hook", "pitch", "e.g.", "not there"]) expect(section(text, key), key).toBe(legacySection(text, key));
      }
    }
  });
  it("still stops at the next same-level heading and ignores code fences", () => {
    const md = "## 1. A\nalpha\n```\n## not a heading\n```\n### sub\nbeta\n## 2. B\ngamma";
    expect(section(md, "1. a")).toBe("alpha\n```\n## not a heading\n```\n### sub\nbeta");
    expect(section(md, "missing")).toBeNull();
  });
});

describe("samples", () => {
  const MKT_KEYS = ["project", "hub", "doc_type", "owner", "sprint_status", "cycle_start", "gate_date", "tiktok", "instagram", "youtube", "x", "last_social_post_date", "last_updated"];
  const SPEC_KEYS = ["project", "hub", "doc_type", "owner", "sprint_status", "cycle_start", "gate_date", "product_type", "repo_url", "last_updated"];
  const MKT_HEADINGS = [
    "## 1. Competitor swipe (3 competitors)",
    "## 2. Hook scripts (native UGC demo)",
    "## 3. Content backlog (made during days 1–14, scheduled for launch)",
    "## 4. Brand kit",
    "## 5. Paid test plan",
  ];
  const SPEC_HEADINGS = [
    "## 1. One-line pitch",
    "## 2. Core mechanics (max 3)",
    "## 3. Out of scope for this MVP",
    "## 4. Tech preset",
    "## 5. File tree",
    "## 6. Build plan (days 1–14)",
    "## 7. Open technical questions",
  ];
  const BREADCRUMB =
    "[[02_Active_Sprints/Master_Kanban|🏠 All Products]] ▸ [[02_Active_Sprints/Demo_Tool/Demo_Tool_Hub|Demo Tool]] · [[02_Active_Sprints/Demo_Tool/2_Marketing_Engine|📈 Marketing]] · [[02_Active_Sprints/Demo_Tool/1_Dev_Spec|💻 Dev]]";
  const h2 =(s: string) => [...s.matchAll(/^## .*$/gm)].map((m) => m[0]);

  /** Every table in a note as its raw lines, with a "> " quote prefix removed. */
  function tableBlocks(note: string): string[][] {
    const lines = note.split("\n").map((l) => l.replace(/^>\s?/, ""));
    const out: string[][] = [];
    for (let i = 0; i + 1 < lines.length; i++) {
      if (!lines[i].startsWith("|") || !SEPARATOR.test(lines[i + 1])) continue;
      let end = i + 2;
      while (end < lines.length && lines[end].startsWith("|")) end++;
      out.push(lines.slice(i, end));
      i = end - 1;
    }
    return out;
  }
  /** String indexes of the column pipes (UTF-16, the same unit the padding uses). */
  const pipes = (line: string) => line.split("").flatMap((ch, i) => (ch === "|" ? [i] : []));

  it("marketing notes mirror the vault layout: frontmatter order, H1, breadcrumb, headings", () => {
    for (const [name, s] of Object.entries(MKT_SAMPLES)) {
      expect(Object.keys(readFrontmatterRaw(s)), name).toEqual(MKT_KEYS);
      expect(s.startsWith("---\nproject: Demo_Tool\n"), name).toBe(true);
      expect(s, name).toContain(`---\n\n# Demo Tool: Marketing Engine\n\n${BREADCRUMB}\n\n## 1. Competitor swipe`);
      expect(h2(s), name).toEqual(MKT_HEADINGS);
      expect(s.endsWith("|\n"), name).toBe(true);
    }
  });
  it("v1 notes have the fixed frontmatter: x: before last_social_post_date:, last_updated 2026-11-04", () => {
    for (const s of [S.MKT_V1_TEMPLATE, S.MKT_V1_FILLED]) {
      expect(s).toContain("\nyoutube: ");
      expect(s).toMatch(/\nyoutube: .*\nx: \nlast_social_post_date: \nlast_updated: 2026-11-04\n---\n/);
    }
  });
  it("dev specs mirror the vault layout", () => {
    for (const [name, s] of Object.entries(SPEC_SAMPLES)) {
      expect(Object.keys(readFrontmatterRaw(s)), name).toEqual(SPEC_KEYS);
      expect(s, name).toContain("doc_type: dev_spec\nowner: dev\n");
      expect(s, name).toContain(`---\n\n# Demo Tool: Dev Spec\n\n${BREADCRUMB}\n\n## 1. One-line pitch\n> `);
      expect(h2(s), name).toEqual(SPEC_HEADINGS);
      expect(section(s, "pitch")?.split("\n")[0], name).toMatch(/^> /);
    }
  });
  it("dev specs hold what their names say", () => {
    const rows = (s: string) => tableIn(s, "pitch")?.rows.map((r) => [cell(r, 0), cell(r, 1)]) ?? null;
    expect(rows(S.SPEC_EMPTY)).toEqual([["Who buys it", ""], ["Job it does", ""], ["Price", ""]]);
    expect(rows(S.SPEC_SPAN_ONLY)).toEqual([["Who buys it", ""], ["Job it does", ""], ["Price", ""]]);
    expect(tableIn(S.SPEC_SPAN_ONLY, "pitch")!.rows.map((r) => exampleIn(r[1]))).toEqual([
      "e.g. who pays, in their own words",
      "e.g. the one thing they buy it to do, in one sentence",
      "e.g. $29 one-time, $5/month, or free + in-game items",
    ]);
    expect(rows(S.SPEC_FILLED)).toEqual([
      ["Who buys it", "Home-studio vocalists who record and mix their own songs"],
      ["Job it does", "Softens harsh S sounds in a vocal with one knob"],
      ["Price", "$29 one-time"],
    ]);
    expect(rows(S.SPEC_TBD)?.map(([, v]) => v)).toEqual(["TBD", "TBD", "TBD"]);
    expect(rows(S.SPEC_NO_TABLE)).toBeNull();
    const platforms = (s: string) => cell(tableIn(s, "tech preset")!.rows.find((r) => r[0] === "Target platforms")!, 1);
    expect(platforms(S.SPEC_FILLED)).toBe("macOS + Windows (VST3, AU)");
    expect(platforms(S.SPEC_TBD)).toBe("TBD");
    expect(platforms(S.SPEC_EMPTY)).toBe("");
    expect(S.frontmatterOf(S.SPEC_FILLED).product_type).toBe("Audio plugin");
    expect(S.frontmatterOf(S.SPEC_EMPTY).product_type).toBeNull();
  });
  it("v1 notes have 3 unrated hooks, v2 notes 10 rated ones in fixed 3 / 5 / 2 slots", () => {
    for (const s of [S.MKT_V1_TEMPLATE, S.MKT_V1_FILLED]) {
      const t = tableIn(s, "hook scripts")!;
      expect(t.headers).toEqual(["#", "Hook (spoken, first 3s)", "Demo shot", "CTA"]);
      expect(t.rows).toHaveLength(3);
    }
    for (const s of [S.MKT_V2_TEMPLATE, S.MKT_V2_REQUESTED, S.MKT_V2_RESEARCHED, S.MKT_V2_PADDED, S.MKT_V2_REVIEWED, S.MKT_HALF_DELETED]) {
      const t = tableIn(s, "hook scripts")!;
      expect(t.headers).toEqual(["#", "Rating", "Hook (spoken, first 3s)", "Demo shot", "CTA", "Based on"]);
      expect(t.rows.map((r) => r[0])).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
      expect(t.rows.map((r) => r[1])).toEqual([...Array(3).fill("🟢 Recommended"), ...Array(5).fill("🟡 Medium"), ...Array(2).fill("🔴 Don't use")]);
      expect(t.rows.slice(8).map((r) => [r[3], r[4]])).toEqual([["—", "—"], ["—", "—"]]);
    }
    for (const s of Object.values(MKT_SAMPLES)) expect(tableIn(s, "competitor swipe")!.rows).toHaveLength(3);
  });
  it("the researched note: 2 competitors and a MISSING row, callout, markers in order, MISSING hook 3", () => {
    const lines = S.MKT_V2_RESEARCHED.split("\n");
    const r = sectionRange(lines, "competitor swipe")!;
    const body = lines.slice(r.start, r.end);
    const at = (pred: (l: string) => boolean) => body.findIndex(pred);
    const lastRow = body.map((l) => l.startsWith("|")).lastIndexOf(true);
    const callout = at((l) => l === "> [!note]- How these 3 were picked (2026-11-20)");
    const research = at((l) => l === "<!-- nx-research: date=2026-11-20 checked=41 kept=2 rounds=2 sources=crawl4ai,shorts -->");
    const request = at((l) => l === "<!-- nx-research-request: date=2026-11-18 by=marketing -->");
    expect(lastRow).toBeGreaterThan(0);
    expect(callout).toBeGreaterThan(lastRow);
    expect(research).toBeGreaterThan(callout);
    expect(request).toBe(research + 1);
    const swipe = tableIn(S.MKT_V2_RESEARCHED, "competitor swipe")!;
    expect(swipe.rows.map((row) => plainText(row[0]))).toEqual(["Acme Vox", "Beta Audio", "MISSING: competitor 3 (checked 41, none passed all 6 checks)"]);
    expect(swipe.rows[0][1]).toBe("[184k views · 7.4× usual](https://example.com/v/1)");
    expect(swipe.rows[2].slice(1).map(exampleIn).every((e) => e.startsWith("e.g."))).toBe(true);
    const callTable = parseTable(lines.filter((l) => l.startsWith("> |")).map((l) => l.slice(2)).join("\n"));
    expect(callTable?.headers).toEqual(["Gate", "Acme Vox", "Beta Audio"]);
    const hooks = tableIn(S.MKT_V2_RESEARCHED, "hook scripts")!;
    expect(hooks.rows[2][2]).toBe("MISSING: evidence for a Recommended hook (needs 2 videos at 2×+ from 2 competitors)");
    expect(hooks.rows.filter((row) => exampleIn(row[4]) !== "" && row[1].includes("Medium")).map((row) => row[0])).toEqual(["6"]);
  });
  it("requested and reviewed notes add one marker each, in the D4 order", () => {
    const swipe = (s: string) => section(s, "competitor swipe")!;
    expect(swipe(S.MKT_V2_REQUESTED)).toMatch(/\|\n\n<!-- nx-research-request: date=2026-11-18 by=marketing -->\n$/);
    expect(S.MKT_V2_REQUESTED).not.toContain("nx-research:");
    expect(swipe(S.MKT_V2_REVIEWED)).toMatch(/nx-research: [^\n]*-->\n<!-- nx-research-request: [^\n]*-->\n<!-- nx-reviewed: competitors=2026-11-21 -->\n$/);
  });
  it("the half-deleted note has an opening tag with no </span> and a </span> with no opening tag", () => {
    expect(S.MKT_HALF_DELETED).toContain('| Stripe product / payment link | <span class="nx-eg">e.g. half deleted |');
    expect(S.MKT_HALF_DELETED).toContain("| e.g. orphan text</span> |");
    const brand = tableIn(S.MKT_HALF_DELETED, "brand kit")!;
    expect(cell(brand.rows[5], 1)).toBe("");
    expect(exampleIn(brand.rows[5][1])).toBe("e.g. half deleted");
    const first = tableIn(S.MKT_HALF_DELETED, "competitor swipe")!.rows[0][0];
    expect(cell([first], 0)).toBe("e.g. orphan text");
    expect(isPlaceholder(first)).toBe(true);
  });
  it("the padded note has the same cells as the researched one, with every table aligned", () => {
    const cellsOf = (s: string) => tableBlocks(s).map((b) => b.filter((_, k) => k !== 1).map(splitRow));
    expect(cellsOf(S.MKT_V2_PADDED)).toEqual(cellsOf(S.MKT_V2_RESEARCHED));
    expect(tableBlocks(S.MKT_V2_PADDED)).toHaveLength(6);
    for (const block of tableBlocks(S.MKT_V2_PADDED)) {
      for (const line of block) expect(pipes(line)).toEqual(pipes(block[0]));
      expect(block[1]).toMatch(/^\| -{3,}( \| -{3,})* \|$/);
    }
    const nonTable = (s: string) => s.split("\n").filter((l) => !/^(> )?\|/.test(l));
    expect(nonTable(S.MKT_V2_PADDED)).toEqual(nonTable(S.MKT_V2_RESEARCHED));
    expect(S.MKT_V2_PADDED).toContain("> | Gate             | Acme Vox ");
  });
  it("padded tables match how Obsidian's table editor saves the v1 hook table", () => {
    expect(section(S.MKT_V1_TEMPLATE, "hook scripts")).toBe(
      [
        "| #   | Hook (spoken, first 3s)                                 | Demo shot | CTA |",
        "| --- | ------------------------------------------------------- | --------- | --- |",
        `| 1   | "I couldn't find a tool that does ___, so I built one." |           |     |`,
        "| 2   |                                                         |           |     |",
        "| 3   |                                                         |           |     |",
        "",
      ].join("\n"),
    );
    for (const s of [S.MKT_V1_TEMPLATE, S.MKT_V1_FILLED, S.SPEC_SPAN_ONLY]) {
      for (const block of tableBlocks(s).filter((b) => b[1].includes(" -"))) for (const line of block) expect(pipes(line)).toEqual(pipes(block[0]));
    }
    expect(S.padTables(S.MKT_V1_FILLED)).toBe(S.padTables(S.padTables(S.MKT_V1_FILLED)));
  });
  it("crlf converts every line ending and nothing else", () => {
    for (const s of Object.values(ALL_SAMPLES)) {
      const c = S.crlf(s);
      expect(c).not.toMatch(/[^\r]\n/);
      expect(c.replace(/\r\n/g, "\n")).toBe(s);
      expect(S.crlf(c)).toBe(c);
    }
  });
  it("frontmatterOf reads values the way Obsidian does", () => {
    expect(S.frontmatterOf(S.MKT_V1_FILLED)).toMatchObject({
      project: "Demo_Tool",
      hub: "[[02_Active_Sprints/Demo_Tool/Demo_Tool_Hub|Demo Tool Hub]]",
      sprint_status: "building",
      cycle_start: "2026-11-01",
      tiktok: "@demo_tool",
      x: null,
      last_updated: "2026-11-04",
    });
    expect(S.frontmatterOf(S.MKT_V2_TEMPLATE).last_updated).toBe("2026-11-04");
    expect(S.frontmatterOf(S.MKT_V2_RESEARCHED).last_updated).toBe("2026-11-20");
    expect(S.frontmatterOf(S.crlf(S.MKT_V1_TEMPLATE))).toEqual(S.frontmatterOf(S.MKT_V1_TEMPLATE));
  });
});
