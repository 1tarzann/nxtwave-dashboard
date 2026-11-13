import { describe, expect, it } from "vitest";
import { col, isPlaceholder, tableIn } from "../src/data/markdown";
import { GENERIC_EXAMPLES as G, MARKETING_SECTIONS, parseMarketing, platformsOf, RATING_LABEL, ratingOf } from "../src/data/marketing";
import { buildSnapshot, marketingCounts } from "../src/data/snapshot";
import { applyTableOp, ConflictError } from "../src/data/tableEdit";
import { doc } from "./helpers";
import * as S from "./samples";

const MKT_SAMPLES: Record<string, string> = {
  MKT_V1_TEMPLATE: S.MKT_V1_TEMPLATE,
  MKT_V1_FILLED: S.MKT_V1_FILLED,
  MKT_V2_TEMPLATE: S.MKT_V2_TEMPLATE,
  MKT_V2_REQUESTED: S.MKT_V2_REQUESTED,
  MKT_V2_RESEARCHED: S.MKT_V2_RESEARCHED,
  MKT_V2_PADDED: S.MKT_V2_PADDED,
  MKT_V2_REVIEWED: S.MKT_V2_REVIEWED,
  MKT_HALF_DELETED: S.MKT_HALF_DELETED,
};
const V1 = ["MKT_V1_TEMPLATE", "MKT_V1_FILLED"];

const span = (text: string) => `<span class="nx-eg">${text}</span>`;
// Every cell also names its column's header; the "header it was read from" test checks those.
const typed = (value: string, example: string) => ({ value, raw: value, example, col: expect.any(String) });
const egOnly = (example: string) => ({ value: "", raw: span(example), example, col: expect.any(String) });
const blankCell = (example: string) => ({ value: "", raw: "", example, col: expect.any(String) });

const RATINGS_3_5_2 = [...Array(3).fill("recommended"), ...Array(5).fill("medium"), ...Array(2).fill("avoid")];
const ASSETS = ["Product name", "Logo", "Thumbnail / trailer", "Landing page", "Email capture", "Stripe product / payment link"];
const PAID = ["Video chosen for the $100 push", "Platform", "Start date", "Budget (max $300 per sprint)"];

/** Puts lines at the end of section 1 of the v2 template, where markers and the callout go. */
const md = (...lines: string[]) => [...lines, ""].join("\n");
const endOfSwipe = (note: string, ...lines: string[]) => note.replace("\n\n## 2. Hook scripts", () => `\n\n${lines.join("\n")}\n\n## 2. Hook scripts`);

describe("parseMarketing on every sample", () => {
  it("finds all 5 tables; empty rows are kept and indexed by their place in the table", () => {
    const backlogRows: Record<string, number> = { MKT_V1_FILLED: 3, MKT_V2_RESEARCHED: 2, MKT_V2_PADDED: 2, MKT_V2_REVIEWED: 2 };
    for (const [name, s] of Object.entries(MKT_SAMPLES)) {
      const m = parseMarketing(s);
      expect(m.competitors?.length, name).toBe(3);
      expect(m.hooks?.rows.length, name).toBe(V1.includes(name) ? 3 : 10);
      expect(m.backlog?.length, name).toBe(backlogRows[name] ?? 1);
      expect(m.brandKit?.map((r) => r.label), name).toEqual(ASSETS);
      expect(m.paidTest?.map((r) => r.label), name).toEqual(PAID);
      for (const rows of [m.competitors!, m.hooks!.rows, m.backlog!, m.brandKit!, m.paidTest!]) expect(rows.map((r) => r.index), name).toEqual(rows.map((_, i) => i));
    }
  });
  it("padded and CRLF notes read exactly like compact LF ones", () => {
    for (const [name, s] of Object.entries(MKT_SAMPLES)) {
      const base = parseMarketing(s);
      expect(parseMarketing(S.crlf(s)), name).toEqual(base);
      expect(parseMarketing(S.padTables(s)), name).toEqual(base);
      expect(parseMarketing(S.crlf(S.padTables(s))), name).toEqual(base);
    }
    expect(parseMarketing(S.MKT_V2_PADDED)).toEqual(parseMarketing(S.MKT_V2_RESEARCHED));
  });
  it("a note without these sections gives nulls", () => {
    expect(parseMarketing("")).toEqual({
      competitors: null,
      hooks: null,
      backlog: null,
      brandKit: null,
      paidTest: null,
      research: null,
      request: null,
      reviewed: { competitors: null, hooks: null },
      picked: null,
      markers: { research: null, request: null, reviewed: null },
    });
  });
  it("markers keep each marker's attributes exactly, even unknown ones", () => {
    const m = parseMarketing("## 1. Competitor swipe\n\n<!-- nx-research-request: date=2026-11-18 by=marketing note=x -->\n");
    expect(m.markers.request).toEqual({ date: "2026-11-18", by: "marketing", note: "x" });
    expect(m.request).toEqual({ date: "2026-11-18", by: "marketing" });
  });
  it("row index matches the table's data rows (the RowRef index tableEdit uses)", () => {
    const s = S.MKT_V2_RESEARCHED;
    const t = tableIn(s, "hook scripts")!;
    const m = parseMarketing(s);
    expect(m.hooks!.rows.map((r) => r.hook.raw)).toEqual(t.rows.map((r) => r[col(t, "hook")]));
    const b = tableIn(s, "content backlog")!;
    expect(m.backlog!.map((r) => r.format.raw)).toEqual(b.rows.map((r) => r[col(b, "format")]));
  });
});

describe("hooks: old v1 layout and 10 rated v2 hooks", () => {
  it("v1 is the table without a Rating column; its rows have no rating", () => {
    for (const s of [S.MKT_V1_TEMPLATE, S.MKT_V1_FILLED]) {
      const h = parseMarketing(s).hooks!;
      expect(h.layout).toBe("v1");
      expect(h.rows.map((r) => [r.num, r.rating])).toEqual([["1", ""], ["2", ""], ["3", ""]]);
    }
    const filled = parseMarketing(S.MKT_V1_FILLED).hooks!.rows[0];
    expect(filled.hook.value).toBe(`"I couldn't find a de-esser with one knob, so I built one."`);
    expect(filled.demo.value).toBe("Screen: turn the knob, the S's go soft at second 1");
    expect(filled.cta.value).toBe("Link in bio.");
    expect(filled.basedOn).toEqual({ value: "", raw: "", example: "", col: "" });
  });
  it("v2 has 3 Recommended, 5 Medium and 2 Don't use slots", () => {
    for (const [name, s] of Object.entries(MKT_SAMPLES).filter(([n]) => !V1.includes(n))) {
      const h = parseMarketing(s).hooks!;
      expect(h.layout, name).toBe("v2");
      expect(h.rows.map((r) => r.num), name).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
      expect(h.rows.map((r) => r.rating), name).toEqual(RATINGS_3_5_2);
    }
  });
  it("reads a researched hook row with its evidence links", () => {
    const r = parseMarketing(S.MKT_V2_RESEARCHED).hooks!.rows[0];
    expect(r).toEqual({
      index: 0,
      num: "1",
      rating: "recommended",
      ratingCell: { value: "🟢 Recommended", raw: "🟢 Recommended", example: "", col: "Rating" },
      hook: typed(`"I couldn't find a de-esser with one knob, so I built one."`, G.hooks.hook),
      demo: typed("Screen: turn the one knob, the S's soften at second 1", "e.g. screen: one click, the result plays right away"),
      cta: typed("Link in bio.", "e.g. Link in bio."),
      basedOn: typed("[Acme Vox 7.4×](https://example.com/v/1), [Beta Audio 3.1×](https://example.com/v/2)", "e.g. 2 competitor videos at 2× their usual views"),
      missing: null,
    });
    const avoid = parseMarketing(S.MKT_V2_RESEARCHED).hooks!.rows[8];
    expect(avoid.rating).toBe("avoid");
    expect(avoid.hook.value).toBe("Brand-first opening: logo and name before the demo. 0.2× usual across 4 videos.");
    expect([avoid.demo.value, avoid.cta.value]).toEqual(["—", "—"]);
  });
  it("a row without a rating yet reads as unrated", () => {
    const s = S.MKT_V2_TEMPLATE.replace("| 5 | 🟡 Medium |", "| 5 |  |");
    expect(parseMarketing(s).hooks!.rows[4].rating).toBe("");
  });
});

describe("ratingOf", () => {
  it("reads the rating with or without its icon", () => {
    for (const s of ["🟢 Recommended", "Recommended", "recommended", "🟢", "Recommend"]) expect(ratingOf(s), s).toBe("recommended");
    for (const s of ["🟡 Medium", "Medium", "MEDIUM", "🟡"]) expect(ratingOf(s), s).toBe("medium");
    for (const s of ["🔴 Don't use", "Don't use", "Don’t use", "dont use", "DON'T USE", "Avoid", "🔴"]) expect(ratingOf(s), s).toBe("avoid");
  });
  it("anything else, or an example, is no rating", () => {
    for (const s of ["", "Maybe", "Good", "—", span("e.g. 🟢 Recommended")]) expect(ratingOf(s), s).toBe("");
  });
  it("RATING_LABEL is what the template writes, and reads back as its rating", () => {
    const t = tableIn(S.MKT_V2_TEMPLATE, "hook scripts")!;
    expect([...new Set(t.rows.map((r) => r[col(t, "rating")]))]).toEqual(Object.values(RATING_LABEL));
    for (const [k, label] of Object.entries(RATING_LABEL)) expect(ratingOf(label)).toBe(k);
  });
});

describe("MISSING rows from research", () => {
  it("a competitor slot research couldn't fill", () => {
    const c = parseMarketing(S.MKT_V2_RESEARCHED).competitors!;
    expect(c.map((r) => r.missing)).toEqual([null, null, "competitor 3 (checked 41, none passed all 6 checks)"]);
    expect(c[2].name.value).toBe("MISSING: competitor 3 (checked 41, none passed all 6 checks)");
    expect(c[2].link).toEqual(egOnly(G.competitors.link));
    expect(isPlaceholder(c[2].name.value)).toBe(true);
  });
  it("a hook slot without enough evidence keeps its rating", () => {
    const h = parseMarketing(S.MKT_V2_RESEARCHED).hooks!.rows;
    expect(h.map((r) => r.missing)).toEqual([null, null, "evidence for a Recommended hook (needs 2 videos at 2×+ from 2 competitors)", ...Array(7).fill(null)]);
    expect(h[2].rating).toBe("recommended");
    expect(h[2].demo).toEqual(egOnly(G.hooks.demo));
  });
  it("only a cell that starts with MISSING: counts", () => {
    const s = S.MKT_V2_TEMPLATE.replace("| 4 | 🟡 Medium | |", "| 4 | 🟡 Medium | Not MISSING: typed |").replace("| 5 | 🟡 Medium | |", "| 5 | 🟡 Medium |   MISSING:   reason  |");
    const h = parseMarketing(s).hooks!.rows;
    expect([h[3].missing, h[4].missing]).toEqual([null, "reason"]);
  });
});

describe("green examples", () => {
  it("a cell's own example", () => {
    const m = parseMarketing(S.MKT_V2_TEMPLATE);
    expect(m.competitors![0].name).toEqual(egOnly(G.competitors.name));
    expect(m.hooks!.rows[0].hook).toEqual(egOnly(G.hooks.hook));
    expect(m.backlog![0].goLive).toEqual(egOnly(G.backlog.goLive));
    expect(m.brandKit![5].value).toEqual(egOnly(G.brandKit.stripe));
    const r = parseMarketing(S.MKT_V2_RESEARCHED);
    expect(r.backlog![1].format).toEqual(egOnly("e.g. before/after split screen, 15s"));
    expect(r.paidTest![0].value).toEqual(egOnly("e.g. backlog #1, the best free video after launch"));
  });
  it("an empty cell shows the first example in its column", () => {
    const m = parseMarketing(S.MKT_V2_TEMPLATE);
    for (const r of m.competitors!.slice(1)) expect(r.name).toEqual(blankCell(G.competitors.name));
    const researched = parseMarketing(S.MKT_V2_RESEARCHED).backlog![0];
    expect(researched.format).toEqual(typed("Screen recording + your voice, 20s", "e.g. before/after split screen, 15s"));
    expect(researched.platformsCell).toEqual(typed("TikTok, Reels, Shorts", "e.g. TikTok, Reels"));
    const specific = parseMarketing(S.MKT_V2_TEMPLATE.replace(span(G.competitors.name), span("e.g. a one-knob de-esser, linked to its store")));
    expect(specific.competitors!.map((r) => r.name.example)).toEqual(Array(3).fill("e.g. a one-knob de-esser, linked to its store"));
  });
  it("Don't use rows borrow only from other Don't use rows; their — cells have no example", () => {
    const s = S.MKT_V2_TEMPLATE.replace(span(G.avoidHooks.hook), span("e.g. follow-ask opening: asks for a follow first"));
    const h = parseMarketing(s).hooks!.rows;
    for (const r of h.slice(1, 8)) expect([r.hook, r.demo, r.cta, r.basedOn]).toEqual([blankCell(G.hooks.hook), blankCell(G.hooks.demo), blankCell(G.hooks.cta), blankCell(G.hooks.basedOn)]);
    expect(h[9].hook).toEqual(blankCell("e.g. follow-ask opening: asks for a follow first"));
    expect(h[9].basedOn).toEqual(blankCell(G.avoidHooks.basedOn));
    for (const r of h.slice(8)) expect([r.demo, r.cta]).toEqual([typed("—", ""), typed("—", "")]);
  });
  it("old v1 notes have no examples, so every cell shows the template's", () => {
    for (const s of [S.MKT_V1_TEMPLATE, S.MKT_V1_FILLED]) {
      const m = parseMarketing(s);
      for (const r of m.competitors!) expect([r.name.example, r.link.example, r.hook.example, r.why.example]).toEqual([G.competitors.name, G.competitors.link, G.competitors.hook, G.competitors.why]);
      for (const r of m.hooks!.rows) expect([r.hook.example, r.demo.example, r.cta.example]).toEqual([G.hooks.hook, G.hooks.demo, G.hooks.cta]);
      for (const r of m.backlog!) expect([r.format.example, r.platformsCell.example, r.statusCell.example, r.goLive.example]).toEqual([G.backlog.format, G.backlog.platforms, G.backlog.status, G.backlog.goLive]);
      expect(m.brandKit!.map((r) => r.value.example)).toEqual(Object.values(G.brandKit));
      expect(m.paidTest!.map((r) => r.value.example)).toEqual(Object.values(G.paidTest));
    }
    const hook1 = parseMarketing(S.MKT_V1_TEMPLATE).hooks!.rows[0].hook;
    expect(hook1).toEqual(typed(`"I couldn't find a tool that does ___, so I built one."`, G.hooks.hook));
    expect(isPlaceholder(hook1.value)).toBe(true);
  });
  it("brand kit and paid test rows fall back by their own label, not the column", () => {
    const s = S.MKT_V2_TEMPLATE.replace(span(G.brandKit.logo), "").replace(span(G.paidTest.budget), "");
    const m = parseMarketing(s);
    expect(m.brandKit![1]).toEqual({ index: 1, label: "Logo", value: blankCell(G.brandKit.logo) });
    expect(m.paidTest![3]).toEqual({ index: 3, label: "Budget (max $300 per sprint)", value: blankCell(G.paidTest.budget) });
  });
  it("a label with no template example has none", () => {
    const s = S.MKT_V2_TEMPLATE.replace(`| Stripe product / payment link | ${span(G.brandKit.stripe)} |`, (row) => `${row}\n| Press kit | |`);
    expect(parseMarketing(s).brandKit![6]).toEqual({ index: 6, label: "Press kit", value: blankCell("") });
  });
  it("GENERIC_EXAMPLES are the template's own texts (plan appendix a)", () => {
    for (const group of Object.values(G)) for (const text of Object.values(group)) if (text) expect(S.MKT_V2_TEMPLATE).toContain(span(text));
    expect(G.avoidHooks.demo).toBe("");
    expect(G.avoidHooks.cta).toBe("");
  });
});

describe("half-deleted examples count as empty", () => {
  const m = parseMarketing(S.MKT_HALF_DELETED);
  it("an opening tag with no </span> is an empty cell that keeps its example", () => {
    expect(m.brandKit![5]).toEqual({ index: 5, label: "Stripe product / payment link", value: { value: "", raw: '<span class="nx-eg">e.g. half deleted', example: "e.g. half deleted", col: "Link / status" } });
  });
  it("text left before a lone </span> is a placeholder, not a competitor", () => {
    const name = m.competitors![0].name;
    expect(name).toEqual({ value: "e.g. orphan text", raw: "e.g. orphan text</span>", example: G.competitors.name, col: "Competitor" });
    expect(isPlaceholder(name.value)).toBe(true);
    expect(m.competitors![0].missing).toBeNull();
    expect(m.competitors![0].link).toEqual(egOnly(G.competitors.link));
  });
});

describe("content backlog", () => {
  it("reads status, platforms and hook number for each video", () => {
    const b = parseMarketing(S.MKT_V1_FILLED).backlog!;
    expect(b.map((r) => [r.num, r.status, r.platforms, r.hookNum, r.goLive.value])).toEqual([
      ["1", "scheduled", ["TikTok", "Reels", "Shorts"], "1", "2026-11-14"],
      ["2", "recorded", ["TikTok", "Reels"], "2", "2026-11-14"],
      ["3", "scripted", ["Shorts"], "3", "2026-11-16"],
    ]);
    expect(b[0].statusCell).toEqual(typed("scheduled", G.backlog.status));
  });
  it("a row of examples is an empty slot", () => {
    const r = parseMarketing(S.MKT_V2_RESEARCHED).backlog!;
    expect(r[0]).toMatchObject({ num: "1", status: "recorded", platforms: ["TikTok", "Reels", "Shorts"], hookNum: "1" });
    expect(r[0].goLive).toEqual(egOnly(G.backlog.goLive));
    expect(r[1]).toEqual({
      index: 1,
      num: "2",
      format: egOnly("e.g. before/after split screen, 15s"),
      platforms: [],
      platformsCell: egOnly("e.g. TikTok, Reels"),
      hookNum: "",
      status: "",
      statusCell: egOnly(G.backlog.status),
      goLive: egOnly(G.backlog.goLive),
    });
    expect(parseMarketing(S.MKT_V1_TEMPLATE).backlog).toEqual([
      { index: 0, num: "1", format: blankCell(G.backlog.format), platforms: [], platformsCell: blankCell(G.backlog.platforms), hookNum: "", status: "", statusCell: blankCell(G.backlog.status), goLive: blankCell(G.backlog.goLive) },
    ]);
  });
  it("status keeps the snapshot's precedence: scheduled, edited, recorded, then scripted", () => {
    const s = (status: string) => parseMarketing(S.MKT_V1_FILLED.replace("| scheduled |", `| ${status} |`)).backlog![0].status;
    expect(s("Scheduled")).toBe("scheduled");
    expect(s("recorded, edited")).toBe("edited");
    expect(s("scripted → recorded")).toBe("recorded");
    expect(s("SCRIPTED")).toBe("scripted");
    expect(s("done")).toBe("");
    expect(parseMarketing(S.MKT_V1_FILLED.replace("| scheduled |", "| done |")).backlog![0].statusCell.value).toBe("done");
  });
});

describe("brand kit and paid test plan", () => {
  it("reads typed values next to their labels", () => {
    const m = parseMarketing(S.MKT_V1_FILLED);
    expect(m.brandKit!.map((r) => r.value.value)).toEqual(["Demo Tool", "https://example.com/demo-tool/logo.png", "", "https://example.com/demo-tool", "", "https://buy.stripe.com/test_demo"]);
    expect(m.paidTest!.map((r) => r.value.value)).toEqual(["Backlog #1", "Meta", "", ""]);
    const r = parseMarketing(S.MKT_V2_RESEARCHED);
    expect(r.brandKit!.map((x) => x.value.value)).toEqual(["Demo Tool", "", "", "https://example.com/demo-tool", "", ""]);
    expect(r.paidTest).toEqual([
      { index: 0, label: "Video chosen for the $100 push", value: egOnly("e.g. backlog #1, the best free video after launch") },
      { index: 1, label: "Platform", value: typed("Meta", G.paidTest.platform) },
      { index: 2, label: "Start date", value: egOnly(G.paidTest["start date"]) },
      { index: 3, label: "Budget (max $300 per sprint)", value: typed("$100", G.paidTest.budget) },
    ]);
  });
  it("a row without a label is kept with an empty label", () => {
    const s = S.MKT_V1_FILLED.replace(/^\| Email capture +\| +\|$/m, "| | stray |");
    expect(s).not.toBe(S.MKT_V1_FILLED);
    expect(parseMarketing(s).brandKit![4]).toEqual({ index: 4, label: "", value: typed("stray", "") });
  });
});

describe("hidden markers", () => {
  it("the researched note has research and request markers, nothing reviewed yet", () => {
    const m = parseMarketing(S.MKT_V2_RESEARCHED);
    expect(m.research).toEqual({ date: "2026-11-20", checked: 41, kept: 2, rounds: 2, sources: ["crawl4ai", "shorts"] });
    expect(m.request).toEqual({ date: "2026-11-18", by: "marketing" });
    expect(m.reviewed).toEqual({ competitors: null, hooks: null });
  });
  it("a request alone is not research", () => {
    const m = parseMarketing(S.MKT_V2_REQUESTED);
    expect(m.request).toEqual({ date: "2026-11-18", by: "marketing" });
    expect(m.research).toBeNull();
    expect(m.picked).toBeNull();
  });
  it("Looks good on one part sets only that part's date", () => {
    expect(parseMarketing(S.MKT_V2_REVIEWED).reviewed).toEqual({ competitors: "2026-11-21", hooks: null });
    expect(parseMarketing(S.crlf(S.MKT_V2_REVIEWED)).reviewed).toEqual({ competitors: "2026-11-21", hooks: null });
    const both = endOfSwipe(S.MKT_V2_TEMPLATE, "<!-- nx-reviewed: competitors=2026-11-21 hooks=2026-11-22 -->");
    expect(parseMarketing(both).reviewed).toEqual({ competitors: "2026-11-21", hooks: "2026-11-22" });
    const hooksOnly = endOfSwipe(S.MKT_V2_TEMPLATE, "<!-- nx-reviewed: hooks=2026-11-22 -->");
    expect(parseMarketing(hooksOnly).reviewed).toEqual({ competitors: null, hooks: "2026-11-22" });
  });
  it("notes without markers", () => {
    for (const s of [S.MKT_V1_TEMPLATE, S.MKT_V1_FILLED, S.MKT_V2_TEMPLATE, S.MKT_HALF_DELETED]) {
      expect(parseMarketing(s)).toMatchObject({ research: null, request: null, reviewed: { competitors: null, hooks: null }, picked: null });
    }
  });
  it("missing numbers are null; a marker without a real date is ignored", () => {
    expect(parseMarketing(endOfSwipe(S.MKT_V2_TEMPLATE, "<!-- nx-research: date=2026-11-20 -->")).research).toEqual({ date: "2026-11-20", checked: null, kept: null, rounds: null, sources: [] });
    expect(parseMarketing(endOfSwipe(S.MKT_V2_TEMPLATE, "<!-- nx-research: date=2026-11-20 checked=many kept=2 -->")).research).toMatchObject({ checked: null, kept: 2 });
    expect(parseMarketing(endOfSwipe(S.MKT_V2_TEMPLATE, "<!-- nx-research: date=soon checked=41 -->")).research).toBeNull();
    expect(parseMarketing(endOfSwipe(S.MKT_V2_TEMPLATE, "<!-- nx-research-request: date=2026-11-18 -->")).request).toEqual({ date: "2026-11-18", by: "" });
    expect(parseMarketing(endOfSwipe(S.MKT_V2_TEMPLATE, "<!-- nx-reviewed: competitors=yesterday -->")).reviewed).toEqual({ competitors: null, hooks: null });
  });
  it("markers are found anywhere in the note", () => {
    const s = `${S.MKT_V2_TEMPLATE}\n<!-- nx-research-request: date=2026-11-18 by=dev -->\n`;
    expect(parseMarketing(s).request).toEqual({ date: "2026-11-18", by: "dev" });
  });
});

describe("the How these 3 were picked callout", () => {
  const PICKED = {
    date: "2026-11-20",
    lines: [
      "Checked 41 products in 2 rounds; 2 passed all 6 checks. Slot 3 stays MISSING rather than take a weaker match.",
      "Closest near misses:",
      "- Gamma Labs: sold only inside a bundle (G6)",
      "- Delta Example: no short-form posts in the last 180 days (G5)",
    ],
    table: {
      headers: ["Gate", "Acme Vox", "Beta Audio"],
      rows: [
        ["G1 Type", "[pass](https://example.com/acme-vox)", "[pass](https://example.com/beta-audio)"],
        ["G4 Model + price", "[pass: $29 one-time](https://example.com/acme-vox#buy)", "[pass: $39 one-time](https://example.com/beta-audio#buy)"],
        ["G5 Short-form", "[pass: posted 2026-11-12](https://example.com/v/1)", "[pass: posted 2026-11-09](https://example.com/v/2)"],
      ],
    },
  };
  it("gives its date, its text lines and the table inside the quote", () => {
    expect(parseMarketing(S.MKT_V2_RESEARCHED).picked).toEqual(PICKED);
    expect(parseMarketing(S.MKT_V2_PADDED).picked).toEqual(PICKED);
    expect(parseMarketing(S.crlf(S.MKT_V2_PADDED)).picked).toEqual(PICKED);
    expect(parseMarketing(S.MKT_V2_REVIEWED).picked).toEqual(PICKED);
  });
  it("the table inside the quote is not taken for the competitor table", () => {
    expect(parseMarketing(S.MKT_V2_RESEARCHED).competitors!.map((r) => r.name.value)).toEqual([
      "[Acme Vox](https://example.com/acme-vox)",
      "[Beta Audio](https://example.com/beta-audio)",
      "MISSING: competitor 3 (checked 41, none passed all 6 checks)",
    ]);
  });
  it("a callout without a table or a date", () => {
    const s = endOfSwipe(S.MKT_V2_TEMPLATE, "> [!NOTE]- How these 3 were picked", "> Nothing passed yet.", `> ${span("e.g. counts")}`, "> - [Acme Vox](https://example.com/acme-vox): no buy button (G6)");
    expect(parseMarketing(s).picked).toEqual({ date: null, lines: ["Nothing passed yet.", "- [Acme Vox](https://example.com/acme-vox): no buy button (G6)"], table: null });
  });
  it("only the callout in section 1 counts, and a plain quote is not it", () => {
    const plainQuote = endOfSwipe(S.MKT_V2_TEMPLATE, "> How these 3 were picked (2026-11-20)");
    expect(parseMarketing(plainQuote).picked).toBeNull();
    const elsewhere = S.MKT_V2_TEMPLATE.replace("\n\n## 3. Content backlog", () => "\n\n> [!note]- How these 3 were picked (2026-11-20)\n> text\n\n## 3. Content backlog");
    expect(elsewhere).not.toBe(S.MKT_V2_TEMPLATE);
    expect(parseMarketing(elsewhere).picked).toBeNull();
  });
});

describe("platformsOf", () => {
  it("gives canonical names", () => {
    expect(platformsOf("TikTok, Reels, Shorts, X")).toEqual(["TikTok", "Reels", "Shorts", "X"]);
    expect(platformsOf("tiktok / instagram reels + YouTube Shorts & Twitter")).toEqual(["TikTok", "Reels", "Shorts", "X"]);
    expect(platformsOf("TikTok and Reels")).toEqual(["TikTok", "Reels"]);
    expect(platformsOf("IG; YT")).toEqual(["Reels", "Shorts"]);
    expect(platformsOf("X (Twitter)")).toEqual(["X"]);
    expect(platformsOf("Tik Tok · YouTube")).toEqual(["TikTok", "Shorts"]);
  });
  it("keeps unknown names as written and drops repeats", () => {
    expect(platformsOf("TikTok, Threads, tiktok")).toEqual(["TikTok", "Threads"]);
    expect(platformsOf("Brand channel")).toEqual(["Brand channel"]);
    expect(platformsOf("Xbox")).toEqual(["Xbox"]);
  });
  it("ignores placeholders, examples and link syntax", () => {
    for (const s of ["", "TBD", "—", span("e.g. TikTok, Reels, Shorts, X"), "e.g. TikTok, Reels", '<span class="nx-eg">e.g. TikTok']) expect(platformsOf(s), s).toEqual([]);
    expect(platformsOf("TikTok, , TBD, Reels")).toEqual(["TikTok", "Reels"]);
    expect(platformsOf("[TikTok](https://example.com/t), [[Reels]]")).toEqual(["TikTok", "Reels"]);
  });
});

describe("what the snapshot counts from these rows (D6)", () => {
  it("v1 notes give today's numbers exactly, padded or compact, LF or CRLF", () => {
    for (const name of V1) {
      for (const s of [MKT_SAMPLES[name], S.crlf(MKT_SAMPLES[name]), S.padTables(MKT_SAMPLES[name])]) {
        const p = buildSnapshot("Demo_Tool", "x", { marketing: doc("2_Marketing_Engine.md", S.frontmatterOf(s), s) });
        const { hooksTotal, ...c } = marketingCounts(parseMarketing(s));
        expect(c, name).toEqual({ competitorsFilled: p.competitorsFilled, hooksFilled: p.hooksFilled, backlog: p.backlog, brandKit: p.brandKit, stripeLink: p.stripeLink });
        expect(hooksTotal).toBe(3);
      }
    }
  });
  it("v2 notes: examples, MISSING rows and Don't use rows count the D6 way", () => {
    const researched = {
      competitorsFilled: 2,
      hooksFilled: 9,
      hooksTotal: 10,
      backlog: { total: 1, scripted: 0, recorded: 1, edited: 0, scheduled: 0 },
      brandKit: { filled: 2, total: 6 },
      stripeLink: "",
    };
    for (const s of [S.MKT_V2_RESEARCHED, S.MKT_V2_PADDED, S.MKT_V2_REVIEWED, S.crlf(S.MKT_V2_PADDED)]) expect(marketingCounts(parseMarketing(s))).toEqual(researched);
    const empty = { competitorsFilled: 0, hooksFilled: 0, hooksTotal: 10, backlog: { total: 0, scripted: 0, recorded: 0, edited: 0, scheduled: 0 }, brandKit: { filled: 0, total: 6 }, stripeLink: "" };
    for (const s of [S.MKT_V2_TEMPLATE, S.MKT_V2_REQUESTED, S.MKT_HALF_DELETED]) expect(marketingCounts(parseMarketing(s))).toEqual(empty);
  });
});

// ---------------------------------------------------------------------------------------------------
// Regression tests for the 0.5.0 review findings
// ---------------------------------------------------------------------------------------------------

describe("ratingOf: the icon decides, and words read in order", () => {
  it("an icon wins over the words next to it", () => {
    expect(ratingOf("🔴 Not recommended")).toBe("avoid");
    expect(ratingOf("🟡 Medium (not recommended for ads)")).toBe("medium");
    expect(ratingOf("🟢 Recommended — avoid long intros")).toBe("recommended");
    expect(ratingOf("🟡 Medium (avoid hype words)")).toBe("medium");
  });
  it("without an icon, a negation reads as Don't use, and the first rating word wins", () => {
    expect(ratingOf("Not recommended")).toBe("avoid");
    expect(ratingOf("Do not use")).toBe("avoid");
    expect(ratingOf("Medium (avoid hype words)")).toBe("medium");
    expect(ratingOf("Recommended, avoid long intros")).toBe("recommended");
  });
  it("Don't use rows rated 🔴 Not recommended stay Don't use and keep the hook count", () => {
    const note = S.MKT_V2_RESEARCHED.replace("| 9 | 🔴 Don't use |", "| 9 | 🔴 Not recommended |").replace("| 10 | 🔴 Don't use |", "| 10 | 🔴 Not recommended |");
    expect(note).not.toBe(S.MKT_V2_RESEARCHED);
    expect(parseMarketing(note).hooks!.rows.map((r) => r.rating)).toEqual(RATINGS_3_5_2);
    expect(marketingCounts(parseMarketing(note)).hooksFilled).toBe(9);
  });
});

describe("the layout only turns v2 for a real Rating column", () => {
  it("a v1 header that merely contains the letters 'rating' stays v1 with its old counts", () => {
    const note = md(
      "## 2. Hook scripts (native UGC demo)",
      "| # | Hook (spoken, first 3s) | Demo shot (demonstrating it) | CTA |",
      "|---|---|---|---|",
      "| 1 | a | — | c |",
      "| 2 | TBD | b | c |",
      "| 3 | x | y | z |",
      "| 4 | x | y | z |",
    );
    const m = parseMarketing(note);
    expect(m.hooks!.layout).toBe("v1");
    expect(m.hooks!.rows.map((r) => r.rating)).toEqual(["", "", "", ""]);
    expect(marketingCounts(m)).toMatchObject({ hooksFilled: 4, hooksTotal: 3 });
    expect(parseMarketing(md("## 2. Hook scripts", "| # | Rating (🟢/🟡/🔴) | Hook |", "|---|---|---|", "| 1 | 🟢 | a |")).hooks!.layout).toBe("v2");
  });
});

describe("what an editor needs to write back exactly", () => {
  it("each hook row carries its Rating cell as written, so a save can expect it", () => {
    const note = S.MKT_V2_RESEARCHED.replace("| 4 | 🟡 Medium |", "| 4 | Medium |");
    const row = parseMarketing(note).hooks!.rows[3];
    expect(row.rating).toBe("medium");
    expect(row.ratingCell).toEqual({ value: "Medium", raw: "Medium", example: "", col: "Rating" });
    const save = (text: string) =>
      applyTableOp(text, {
        kind: "set",
        heading: MARKETING_SECTIONS.hooks,
        edits: [{ row: { key: row.num, col: "#" }, values: { hook: "New opening line", rating: RATING_LABEL.medium }, expect: { hook: row.hook.value, rating: row.ratingCell.value } }],
      });
    expect(() => save(note)).not.toThrow();
    const partner = note.replace("| 4 | Medium |", "| 4 | 🔴 Don't use |");
    expect(() => save(partner)).toThrow(ConflictError);
    expect(parseMarketing(S.MKT_V1_FILLED).hooks!.rows[0].ratingCell).toEqual({ value: "", raw: "", example: "", col: "" });
  });
  it("every cell names the header it was read from, so a renamed column can still be edited", () => {
    const renamed = S.MKT_V2_RESEARCHED.replace("| Competitor | Top ad / video link |", "| Competitor | Top video |");
    expect(renamed).not.toBe(S.MKT_V2_RESEARCHED);
    const row = parseMarketing(renamed).competitors![0];
    expect(row.link.col).toBe("Top video");
    const r = applyTableOp(renamed, {
      kind: "set",
      heading: MARKETING_SECTIONS.competitors,
      edits: [{ row: { index: row.index }, values: { [row.link.col]: "[200k views · 8× usual](https://example.com/v/12)" }, expect: { [row.link.col]: row.link.value } }],
    });
    expect(parseMarketing(r.text).competitors![0].link.value).toBe("[200k views · 8× usual](https://example.com/v/12)");
    const m = parseMarketing(S.MKT_V2_RESEARCHED);
    expect([m.hooks!.rows[0].hook.col, m.backlog![0].statusCell.col, m.brandKit![0].value.col, m.paidTest![0].value.col]).toEqual([
      "Hook (spoken, first 3s)",
      "Status (scripted / recorded / edited / scheduled)",
      "Link / status",
      "Value",
    ]);
    expect(parseMarketing(S.MKT_V1_FILLED).hooks!.rows[0].basedOn.col).toBe("");
  });
  it("the section keys the parser uses find every table", () => {
    for (const key of Object.values(MARKETING_SECTIONS)) expect(tableIn(S.MKT_V2_RESEARCHED, key), key).not.toBeNull();
  });
});

describe("markers and the callout as competitor-scout writes them", () => {
  it("research sources joined with + or with , both read as a list", () => {
    expect(parseMarketing(endOfSwipe(S.MKT_V2_TEMPLATE, "<!-- nx-research: date=2026-11-13 checked=9 kept=1 rounds=1 sources=websearch+shorts -->")).research?.sources).toEqual(["websearch", "shorts"]);
    expect(parseMarketing(S.MKT_V2_RESEARCHED).research?.sources).toEqual(["crawl4ai", "shorts"]);
  });
  it("the callout's lines lose markdown bold, and keep links", () => {
    const s = endOfSwipe(
      S.MKT_V2_TEMPLATE,
      "> [!note]- How these 3 were picked (2026-11-13)",
      "> Checked 9 products in 1 round; **1 passed** all 6 checks.",
      ">",
      "> **Closest near misses**",
      "> 1. __Gamma Labs__: sold only inside a bundle (G6), see [the page](https://example.com/gamma)",
    );
    expect(parseMarketing(s).picked?.lines).toEqual([
      "Checked 9 products in 1 round; 1 passed all 6 checks.",
      "Closest near misses",
      "1. Gamma Labs: sold only inside a bundle (G6), see [the page](https://example.com/gamma)",
    ]);
  });
});

describe("the D6 counts tested here are the shipped ones", () => {
  it("a v1 TBD competitor still counts (v1 keeps its old rule); a v2 TBD Stripe row is no link and no asset", () => {
    const v1 = S.MKT_V1_FILLED.replace("Gamma Labs", "TBD");
    const v2 = S.MKT_V2_RESEARCHED.replace('| Stripe product / payment link | <span class="nx-eg">e.g. the Stripe payment link, never a secret key</span> |', "| Stripe product / payment link | TBD |");
    expect(v1).not.toBe(S.MKT_V1_FILLED);
    expect(v2).not.toBe(S.MKT_V2_RESEARCHED);
    expect(marketingCounts(parseMarketing(v1)).competitorsFilled).toBe(3);
    expect(marketingCounts(parseMarketing(v2))).toMatchObject({ stripeLink: "", brandKit: { filled: 2, total: 6 } });
  });
});
