import { describe, expect, it } from "vitest";
import { col, section, tableIn } from "../src/data/markdown";
import { parseMarketing } from "../src/data/marketing";
import { parseProfile } from "../src/data/profile";
import { sprintQuests } from "../src/data/quests";
import { buildSnapshot, marketingCounts } from "../src/data/snapshot";
import { computeStatus } from "../src/data/status";
import { DEFAULT_THRESHOLDS, ProductSnapshot } from "../src/data/types";
import { doc } from "./helpers";
import * as S from "./samples";

// ---------------------------------------------------------------------------------------------------
// Reference: the rules snapshot.ts used before 0.5.0 (git HEAD 5d39557), copied as they were. Only the
// cell and plain-text helpers are spelled out, because 0.5.0 changed them to strip green examples; the
// table and section readers are today's, which give the same tables as before on every sample.
// ---------------------------------------------------------------------------------------------------

const headCell = (row: string[], index: number) => (index >= 0 ? (row[index] ?? "").trim() : "");

const headPlain = (s: string) =>
  s
    .replace(/\[\[([^\]|]+?)(?:\\?\|([^\]]+))?\]\]/g, (_m, p: string, a?: string) => a ?? p.split("/").pop() ?? p)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`/g, "")
    .trim();

function headCounts(mkt: string) {
  const swipe = tableIn(mkt, "competitor swipe");
  const competitorsFilled = swipe ? swipe.rows.filter((r) => headCell(r, col(swipe, "competitor"))).length : 0;

  const hooks = tableIn(mkt, "hook scripts");
  const hookCol = hooks ? col(hooks, "hook") : -1;
  const demoCol = hooks ? col(hooks, "demo") : -1;
  const hooksFilled = hooks
    ? hooks.rows.filter((r) => {
        const h = headCell(r, hookCol);
        return h && !h.includes("___") && headCell(r, demoCol);
      }).length
    : 0;

  const backlogT = tableIn(mkt, "content backlog");
  const backlog = { total: 0, scripted: 0, recorded: 0, edited: 0, scheduled: 0 };
  if (backlogT) {
    const fmt = col(backlogT, "format");
    const st = col(backlogT, "status");
    for (const r of backlogT.rows) {
      const s = headCell(r, st).toLowerCase();
      if (!headCell(r, fmt) && !s) continue;
      backlog.total++;
      if (s.includes("scheduled")) backlog.scheduled++;
      else if (s.includes("edited")) backlog.edited++;
      else if (s.includes("recorded")) backlog.recorded++;
      else if (s.includes("scripted")) backlog.scripted++;
    }
  }

  const brand = tableIn(mkt, "brand kit");
  let stripeLink = "";
  const brandKit = { filled: 0, total: 0 };
  if (brand) {
    const a = col(brand, "asset");
    const v = col(brand, "link", "status", "value");
    for (const r of brand.rows) {
      if (!headCell(r, a)) continue;
      brandKit.total++;
      if (headCell(r, v)) brandKit.filled++;
      if (headCell(r, a).toLowerCase().includes("stripe")) stripeLink = headCell(r, v);
    }
  }
  return { competitorsFilled, hooksFilled, backlog, brandKit, stripeLink };
}

function headSpec(spec: string) {
  const pitchSec = section(spec, "pitch") ?? "";
  const pitch = headPlain((/^\s*>\s?(.*)$/m.exec(pitchSec)?.[1] ?? "").trim());
  const mechanics = (section(spec, "core mechanics") ?? "")
    .split(/\r?\n/)
    .map((l) => /^\s*\d+\.\s*(.*)$/.exec(l)?.[1]?.trim() ?? "")
    .filter(Boolean)
    .map(headPlain);
  return { pitch, mechanics };
}

// ---------------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------------

const mkt = (body: string) => buildSnapshot("Demo_Tool", "x", { marketing: doc("2_Marketing_Engine.md", S.frontmatterOf(body), body) });
const spec = (body: string, hubFm: Record<string, unknown> = {}) =>
  buildSnapshot("Demo_Tool", "x", { spec: doc("1_Dev_Spec.md", S.frontmatterOf(body), body) }, doc("x/Demo_Tool_Hub.md", { sprint_status: "building", ...hubFm }));

const counts = (p: ProductSnapshot) => ({ competitorsFilled: p.competitorsFilled, hooksFilled: p.hooksFilled, backlog: p.backlog, brandKit: p.brandKit, stripeLink: p.stripeLink });
const withTotal = (p: ProductSnapshot) => ({ ...counts(p), hooksTotal: p.hooksTotal });

/** A note as written, padded by Obsidian's table editor, and both with CRLF line endings. */
const forms = (note: string) => [note, S.padTables(note), S.crlf(note), S.crlf(S.padTables(note))];

const NO_VIDEOS = { total: 0, scripted: 0, recorded: 0, edited: 0, scheduled: 0 };

/** Swaps one exact table row of a note, failing loudly if it isn't there. */
function swapRow(note: string, from: string, to: string): string {
  expect(note, from).toContain(`\n${from}\n`);
  return note.replace(`\n${from}\n`, () => `\n${to}\n`);
}

// Seeded random old-layout notes, so the comparison covers more than the 2 samples (and runs the same every time).
function random(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VALUES = [
  "",
  "",
  "Acme Vox",
  "[Beta Audio](https://example.com/beta)",
  "[[02_Active_Sprints/Demo_Tool/1_Dev_Spec\\|Spec]]",
  "TBD",
  "—",
  "-",
  "?",
  "n/a",
  "___",
  `"I couldn't find a tool that does ___, so I built one."`,
  `"One knob. That's the whole plugin."`,
  "e.g. a hint someone typed",
  "MISSING: no evidence",
  "scheduled",
  "Recorded",
  "EDITED",
  "scripted",
  "scripted, then recorded",
  "recorded and edited",
  "Scheduled (edited)",
  "done",
  "0",
  "`code`",
  "https://buy.stripe.com/test_demo",
];
const LABELS = ["Product name", "Logo", "Landing page", "Stripe product / payment link", "Stripe (old link)", "", "Email capture"];
const HEADERS = {
  swipe: [["Competitor", "Top ad / video link", "Hook (first 3s)", "Why it works"], ["Name", "Link"]],
  hooks: [["#", "Hook (spoken, first 3s)", "Demo shot", "CTA"], ["#", "Hook", "CTA"], ["Hook (spoken, first 3s)", "Demo shot"]],
  backlog: [["#", "Format", "Platform(s)", "Hook #", "Status (scripted / recorded / edited / scheduled)", "Go-live date"], ["#", "Format", "Go-live date"], ["Status"]],
  brand: [["Asset", "Link / status"], ["Asset", "Value"], ["Item", "Link"]],
};

function randomV1Note(next: () => number): string {
  const pick = <T,>(xs: T[]): T => xs[Math.floor(next() * xs.length)];
  const line = (cells: string[]) => `|${cells.map((c) => (c === "" ? " " : ` ${c} `)).join("|")}|`;
  const out: string[] = ["# Demo Tool: Marketing Engine", ""];
  const add = (heading: string, header: string[], rows: string[][]) => {
    if (next() < 0.1) return; // now and then a section is missing
    out.push(heading, line(header), `|${"---|".repeat(header.length)}`, ...rows.map(line), "");
  };
  const rows = (width: number, cellAt: (i: number) => string) => Array.from({ length: Math.floor(next() * 5) }, () => Array.from({ length: width }, (_, i) => cellAt(i)));
  // A research "MISSING:" row is the one sanctioned change for old notes; it has its own test below.
  const swipe = pick(HEADERS.swipe);
  add("## 1. Competitor swipe (3 competitors)", swipe, rows(swipe.length, () => pick(VALUES.filter((v) => !v.startsWith("MISSING:")))));
  const hooks = pick(HEADERS.hooks);
  add("## 2. Hook scripts (native UGC demo)", hooks, rows(hooks.length, () => pick(VALUES)));
  const backlog = pick(HEADERS.backlog);
  add("## 3. Content backlog (made during days 1–14, scheduled for launch)", backlog, rows(backlog.length, () => pick(VALUES)));
  const brand = pick(HEADERS.brand);
  add("## 4. Brand kit", brand, rows(brand.length, (i) => (i === 0 ? pick(LABELS) : pick(VALUES))));
  return out.join("\n");
}

// ---------------------------------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------------------------------

describe("old-layout (v1) notes keep every number they had", () => {
  it("both v1 samples give HEAD's counts and Stripe link: as written, padded, CRLF", () => {
    for (const note of [S.MKT_V1_TEMPLATE, S.MKT_V1_FILLED]) {
      for (const form of forms(note)) {
        const p = mkt(form);
        expect(counts(p)).toEqual(headCounts(form));
        expect(p.hooksTotal).toBe(3);
        expect(p.marketing?.hooks?.layout).toBe("v1");
      }
    }
    // Hand-checked, so the reference itself is pinned too.
    expect(counts(mkt(S.MKT_V1_FILLED))).toEqual({
      competitorsFilled: 3,
      hooksFilled: 3,
      backlog: { total: 3, scripted: 1, recorded: 1, edited: 0, scheduled: 1 },
      brandKit: { filled: 4, total: 6 },
      stripeLink: "https://buy.stripe.com/test_demo",
    });
    expect(counts(mkt(S.MKT_V1_TEMPLATE))).toEqual({ competitorsFilled: 0, hooksFilled: 0, backlog: NO_VIDEOS, brandKit: { filled: 0, total: 6 }, stripeLink: "" });
  });

  it("300 random old-layout notes give HEAD's numbers, placeholders and odd headers included", () => {
    const next = random(20261113);
    let nonZero = 0;
    for (let n = 0; n < 300; n++) {
      const note = randomV1Note(next);
      const expected = headCounts(note);
      if (expected.competitorsFilled + expected.hooksFilled + expected.backlog.total + expected.brandKit.total > 0) nonZero++;
      for (const form of forms(note)) {
        const p = mkt(form);
        expect(counts(p), form).toEqual(expected);
        expect(p.hooksTotal).toBe(3);
      }
    }
    expect(nonZero).toBeGreaterThan(250);
  });

  it("only a research MISSING: row stops counting as a competitor (D6)", () => {
    const note = S.MKT_V1_FILLED.replace(/^\| Gamma Labs .*$/m, "| MISSING: competitor 3 (checked 41) | | | |");
    expect(note).not.toBe(S.MKT_V1_FILLED);
    expect(headCounts(note).competitorsFilled).toBe(3);
    expect(mkt(note).competitorsFilled).toBe(2);
    expect(mkt(note.replace("MISSING: competitor 3 (checked 41)", "TBD")).competitorsFilled).toBe(3);
  });

  it("a v1 note with green examples counts them as empty", () => {
    const eg = '<span class="nx-eg">e.g. a hint</span>';
    const note = swapRow(swapRow(S.MKT_V1_TEMPLATE, "| | | | |", `| ${eg} | | | |`), "| 1 | | | | | |", `| 1 | ${eg} | | | ${eg} | |`);
    expect(counts(mkt(note))).toEqual(counts(mkt(S.MKT_V1_TEMPLATE)));
  });
});

describe("new-layout (v2) notes count the D6 way", () => {
  const empty = { competitorsFilled: 0, hooksFilled: 0, hooksTotal: 10, backlog: NO_VIDEOS, brandKit: { filled: 0, total: 6 }, stripeLink: "" };
  const researched = { competitorsFilled: 2, hooksFilled: 9, hooksTotal: 10, backlog: { total: 1, scripted: 0, recorded: 1, edited: 0, scheduled: 0 }, brandKit: { filled: 2, total: 6 }, stripeLink: "" };

  it("every v2 sample, as written, padded and CRLF", () => {
    for (const note of [S.MKT_V2_TEMPLATE, S.MKT_V2_REQUESTED, S.MKT_HALF_DELETED]) for (const form of forms(note)) expect(withTotal(mkt(form))).toEqual(empty);
    for (const note of [S.MKT_V2_RESEARCHED, S.MKT_V2_PADDED, S.MKT_V2_REVIEWED]) for (const form of forms(note)) expect(withTotal(mkt(form))).toEqual(researched);
  });

  it("hooks: a Don't use row needs no demo shot; a placeholder hook or demo shot doesn't count", () => {
    let note = S.MKT_V2_TEMPLATE;
    note = swapRow(note, "| 2 | 🟢 Recommended | | | | |", "| 2 | 🟢 Recommended | TBD | Screen: one knob | | |");
    note = swapRow(note, "| 4 | 🟡 Medium | | | | |", `| 4 | 🟡 Medium | "Hook four." | — | Link in bio. | |`);
    note = swapRow(note, "| 5 | 🟡 Medium | | | | |", `| 5 | 🟡 Medium | "Hook five." | Screen: knob up | | |`);
    note = swapRow(note, "| 10 | 🔴 Don't use | | — | — | |", "| 10 | 🔴 Don't use | Follow-ask opening. 0.4× usual across 3 videos. | — | — | |");
    expect(mkt(note).hooksFilled).toBe(2);
  });

  it("competitors: placeholders and MISSING: rows don't count", () => {
    let note = swapRow(S.MKT_V2_TEMPLATE, "| | | | |", "| TBD | | | |");
    note = swapRow(note, "| | | | |", "| [Acme Vox](https://example.com/acme-vox) | | | |");
    expect(mkt(note).competitorsFilled).toBe(1);
    expect(mkt(S.MKT_V2_RESEARCHED).competitorsFilled).toBe(2);
  });

  it("a placeholder in the Stripe row is neither a payment link nor a filled brand kit row", () => {
    const stripeRow = '| Stripe product / payment link | <span class="nx-eg">e.g. the Stripe payment link, never a secret key</span> |';
    const withValue = (v: string) => mkt(swapRow(S.MKT_V2_TEMPLATE, stripeRow, `| Stripe product / payment link | ${v} |`));
    expect(withValue("https://buy.stripe.com/test_demo").stripeLink).toBe("https://buy.stripe.com/test_demo");
    expect(withValue("https://buy.stripe.com/test_demo").brandKit).toEqual({ filled: 1, total: 6 });
    for (const v of ["TBD", "—", "e.g. the Stripe payment link, never a secret key</span>"]) {
      expect(withValue(v).stripeLink, v).toBe("");
      expect(withValue(v).brandKit, v).toEqual({ filled: 0, total: 6 });
    }
  });
});

describe("snapshot.marketing and marketingCounts", () => {
  it("holds parseMarketing's result, or null without the note", () => {
    for (const note of [S.MKT_V1_FILLED, S.MKT_V2_RESEARCHED, S.MKT_V2_REVIEWED]) expect(mkt(note).marketing).toEqual(parseMarketing(note));
    const none = buildSnapshot("Demo_Tool", "x", {});
    expect(none.marketing).toBeNull();
    expect(withTotal(none)).toEqual({ competitorsFilled: 0, hooksFilled: 0, hooksTotal: 3, backlog: NO_VIDEOS, brandKit: { filled: 0, total: 0 }, stripeLink: "" });
  });

  it("without a Rating column, or without a hooks table, there are 3 hook slots", () => {
    expect(marketingCounts(null).hooksTotal).toBe(3);
    const noHooks = S.MKT_V2_TEMPLATE.replace("## 2. Hook scripts (native UGC demo)", "## 2. Something else");
    expect(mkt(noHooks).marketing?.hooks).toBeNull();
    expect(mkt(noHooks).hooksTotal).toBe(3);
    expect(marketingCounts(parseMarketing(S.MKT_V2_RESEARCHED))).toEqual({ ...counts(mkt(S.MKT_V2_RESEARCHED)), hooksTotal: 10 });
  });
});

describe("snapshot.profile, pitch and core mechanics", () => {
  const SPECS = { SPEC_EMPTY: S.SPEC_EMPTY, SPEC_FILLED: S.SPEC_FILLED, SPEC_SPAN_ONLY: S.SPEC_SPAN_ONLY, SPEC_TBD: S.SPEC_TBD, SPEC_NO_TABLE: S.SPEC_NO_TABLE };

  it("holds parseProfile's result, with the hub's category", () => {
    const hubFm = { category: "[[04_Company_Ops/Categories/Audio_Tools|Audio Tools]]" };
    for (const [name, note] of Object.entries(SPECS)) {
      const p = spec(note, hubFm);
      expect(p.profile, name).toEqual(parseProfile(note, S.frontmatterOf(note), { sprint_status: "building", ...hubFm }));
      expect([p.pitch, p.mechanics], name).toEqual([p.profile.pitch, p.profile.mechanics]);
    }
    expect(spec(S.SPEC_FILLED, hubFm).profile).toMatchObject({ complete: true, category: "Audio Tools", priceParsed: { amount: 29, currency: "USD", model: "one-time" } });
    expect(spec(S.SPEC_SPAN_ONLY).profile.missing.map((m) => m.field)).toEqual(["Who buys it", "Job it does", "Price"]);
  });

  it("without a Dev Spec, all 7 fields are missing", () => {
    const p = buildSnapshot("Demo_Tool", "x", {});
    expect(p.profile.missing).toHaveLength(7);
    expect(p.profile.complete).toBe(false);
    expect([p.pitch, p.mechanics]).toEqual(["", []]);
  });

  it("pitch and mechanics equal HEAD's for every spec without examples in them: as written, padded, CRLF", () => {
    const extra = S.SPEC_FILLED.replace(
      "> A one-knob de-esser that tames harsh S sounds in home-studio vocals.",
      "> A [[03_Notes/Pitch\\|one-knob]] `de-esser` for [home studios](https://example.com/studio).",
    )
      .replace("1. One knob sets how much the S sounds are softened", "1. [One knob](https://example.com/k) sets how much the S sounds are softened")
      .replace("2. Finds S sounds on its own and turns only those down", "   2.    Finds S sounds on its own   ")
      .replace("3. Before/after button to compare in one click", "10. Before/after button in `one` click");
    expect(extra).not.toBe(S.SPEC_FILLED);
    for (const note of [...Object.values(SPECS), extra]) {
      for (const form of forms(note)) {
        const p = spec(form);
        expect({ pitch: p.pitch, mechanics: p.mechanics }, form).toEqual(headSpec(form));
      }
    }
    expect(spec(extra).pitch).toBe("A one-knob de-esser for home studios.");
    expect(spec(extra).mechanics).toEqual(["One knob sets how much the S sounds are softened", "Finds S sounds on its own", "Before/after button in one click"]);
  });

  it("green examples, placeholder items and 1) numbering: where the profile differs from HEAD", () => {
    const eg = '<span class="nx-eg">e.g. one thing it does</span>';
    const withMechanics = (lines: string[]) => S.SPEC_FILLED.replace(/1\. One knob[^\n]*\n2\. [^\n]*\n3\. [^\n]*\n/, () => lines.map((l) => `${l}\n`).join(""));
    // Example-only items are left out instead of showing the span (HEAD) or an empty item.
    const egOnly = withMechanics([`1. ${eg}`, "2. ", "3. "]);
    expect(headSpec(egOnly).mechanics).toEqual([eg]);
    expect(spec(egOnly).mechanics).toEqual([]);
    // Placeholder items are left out, matching the profile's "Missing: Core mechanic".
    const tbd = withMechanics(["1. TBD", "2. ___", "3. —"]);
    expect(headSpec(tbd).mechanics).toEqual(["TBD", "___", "—"]);
    expect(spec(tbd).mechanics).toEqual([]);
    expect(spec(tbd).profile.missing.map((m) => m.field)).toEqual(["Core mechanic"]);
    // "1)" lists count, like "1." ones.
    const paren = withMechanics(["1) One knob", "2) Auto-detect", "3) Before/after"]);
    expect(headSpec(paren).mechanics).toEqual([]);
    expect(spec(paren).mechanics).toEqual(["One knob", "Auto-detect", "Before/after"]);
    // An example-only pitch is empty.
    const egPitch = S.SPEC_FILLED.replace("> A one-knob de-esser that tames harsh S sounds in home-studio vocals.", `> ${eg}`);
    expect(spec(egPitch).pitch).toBe("");
  });
});

// ---------------------------------------------------------------------------------------------------
// Regression tests for the 0.5.0 review findings
// ---------------------------------------------------------------------------------------------------

describe("v2 notes: left-over example text never counts as filled", () => {
  it("a half-deleted example in the brand kit or the backlog is no asset and no video", () => {
    const logo = '| Logo | <span class="nx-eg">e.g. link to the logo file</span> |';
    const video =
      '| 1 | <span class="nx-eg">e.g. screen recording + your voice, 20s</span> | <span class="nx-eg">e.g. TikTok, Reels, Shorts, X</span> | <span class="nx-eg">e.g. 1</span> | <span class="nx-eg">e.g. scripted</span> | <span class="nx-eg">e.g. launch day (day 14)</span> |';
    let note = swapRow(S.MKT_V2_TEMPLATE, logo, "| Logo | e.g. link to the logo file</span> |");
    note = swapRow(note, video, video.replace('<span class="nx-eg">e.g. scripted</span>', "e.g. scripted</span>"));
    note = note.replace("cycle_start: \n", "cycle_start: 2026-11-01\n");
    for (const form of forms(note)) {
      const p = mkt(form);
      expect(p.brandKit, form).toEqual({ filled: 0, total: 6 });
      expect(p.backlog, form).toEqual(NO_VIDEOS);
    }
    const p = mkt(note);
    expect(p.cycleStart).toBe("2026-11-01");
    const qs = sprintQuests(p, computeStatus(p, DEFAULT_THRESHOLDS, "2026-11-05"), "2026-11-05");
    for (const id of ["mkt-record", "mkt-schedule"]) expect(qs.find((q) => q.id === id)?.progress, id).toBeUndefined();
  });
  it("a typed Format with a placeholder Status is still a video; v1 keeps its old rule", () => {
    const v2 = swapRow(S.MKT_V2_TEMPLATE, "| 1 | <span class=\"nx-eg\">e.g. screen recording + your voice, 20s</span> | <span class=\"nx-eg\">e.g. TikTok, Reels, Shorts, X</span> | <span class=\"nx-eg\">e.g. 1</span> | <span class=\"nx-eg\">e.g. scripted</span> | <span class=\"nx-eg\">e.g. launch day (day 14)</span> |", "| 1 | Screen recording | | | TBD | |");
    expect(mkt(v2).backlog.total).toBe(1);
    const v1 = swapRow(S.MKT_V1_TEMPLATE, "| 1 | | | | | |", "| 1 | TBD | | | | |");
    expect(mkt(v1).backlog.total).toBe(headCounts(v1).backlog.total);
    expect(mkt(v1).backlog.total).toBe(1);
  });
});

describe("one link helper for the hub category", () => {
  it("the profile's category is the snapshot's category title", () => {
    for (const category of ["[[04_Company_Ops/Categories/Audio_Tools|Audio Tools]]", "[[04_Company_Ops/Categories/Games.md]]", "[[ Games ]]", "Games", ""]) {
      const p = spec(S.SPEC_FILLED, { category });
      expect(p.profile.category, category).toBe(p.category?.title ?? "");
    }
  });
});

// ---------------------------------------------------------------------------------------------------
// Fix round: one video rule for the counts, the quests and Videos to make; a secret key is never the payment link
// ---------------------------------------------------------------------------------------------------

describe("v2 notes count videos the way Videos to make shows them", () => {
  const status = (p: ProductSnapshot, today: string) => computeStatus(p, DEFAULT_THRESHOLDS, today);

  it("a video made by Use in a video counts at once, as not recorded yet, so Schedule every video stays open", async () => {
    const { applyTableOp } = await import("../src/data/tableEdit");
    const { backlogStatusOp, useHookOp } = await import("../src/data/marketingOps");
    for (const form of forms(S.MKT_V2_RESEARCHED)) {
      const m = parseMarketing(form);
      const used = applyTableOp(form, useHookOp(m, m.hooks!.rows[3])).text;
      const done = applyTableOp(used, backlogStatusOp(parseMarketing(used).backlog![0], "scheduled")).text.replace("cycle_start: \n", "cycle_start: 2026-11-01\n").replace("cycle_start: \r\n", "cycle_start: 2026-11-01\r\n");
      const p = mkt(done);
      expect(p.backlog, form).toEqual({ total: 2, scripted: 1, recorded: 0, edited: 0, scheduled: 1 });
      const qs = sprintQuests(p, status(p, "2026-11-10"), "2026-11-10");
      expect(qs.find((q) => q.id === "mkt-schedule"), form).toMatchObject({ state: "now", progress: { done: 1, total: 2 } });
      expect(qs.find((q) => q.id === "mkt-record"), form).toMatchObject({ state: "now", progress: { done: 1, total: 2 } });
    }
  });
  it("a row with only examples, or only a placeholder, still isn't a video", () => {
    expect(mkt(S.MKT_V2_TEMPLATE).backlog).toEqual(NO_VIDEOS);
    const tbd = S.MKT_V2_TEMPLATE.replace(/^\| 1 \| <span[^\n]*$/m, "| 1 | TBD | — | | ? | |");
    expect(tbd).not.toBe(S.MKT_V2_TEMPLATE);
    expect(mkt(tbd).backlog).toEqual(NO_VIDEOS);
  });
});

describe("old-layout (v1) notes: the Videos counter, Videos to make and the quests count the same videos", () => {
  const status = (p: ProductSnapshot, today: string) => computeStatus(p, DEFAULT_THRESHOLDS, today);
  it("Use in a video and Add a video with only a hook count at once in all three", async () => {
    const { applyTableOp } = await import("../src/data/tableEdit");
    const { addVideoOp, backlogStatusOp, useHookOp } = await import("../src/data/marketingOps");
    const { videoRule } = await import("../src/data/marketing");
    for (const form of forms(S.MKT_V1_FILLED)) {
      let note = form;
      for (const i of [1, 2]) note = applyTableOp(note, backlogStatusOp(parseMarketing(note).backlog![i], "scheduled")).text;
      const scheduledAll = parseMarketing(note);
      for (const op of [useHookOp(scheduledAll, scheduledAll.hooks!.rows[1]), addVideoOp({ hookNum: "2" }, scheduledAll)]) {
        const after = applyTableOp(note, op).text;
        const m = parseMarketing(after);
        const p = mkt(after);
        const section = (m.backlog ?? []).filter(videoRule(m));
        expect(section.length, form).toBe(4);
        expect(p.backlog, form).toMatchObject({ total: 4, scheduled: 3, scripted: 1 });
        const qs = sprintQuests(p, status(p, "2026-11-10"), "2026-11-10");
        expect(qs.find((q) => q.id === "mkt-schedule")?.state, form).not.toBe("done");
        expect(qs.find((q) => q.id === "mkt-record")?.state, form).not.toBe("done");
      }
    }
  });
  it("a v1 line with Format TBD is a video in the section too", async () => {
    const { videoRule } = await import("../src/data/marketing");
    const v1 = swapRow(S.MKT_V1_TEMPLATE, "| 1 | | | | | |", "| 1 | TBD | | | | |");
    const m = parseMarketing(v1);
    expect([(m.backlog ?? []).filter(videoRule(m)).length, mkt(v1).backlog.total]).toEqual([1, 1]);
  });
});

describe("a Stripe secret key in the brand kit is never filled and never the payment link", () => {
  const key = "sk" + "_live_" + "x".repeat(24);
  const stripeRow = '| Stripe product / payment link | <span class="nx-eg">e.g. the Stripe payment link, never a secret key</span> |';
  it("v2 and v1: the count, the link and the Stripe quest agree with the line on the card", () => {
    const v2 = mkt(swapRow(S.MKT_V2_TEMPLATE, stripeRow, `| Stripe product / payment link | ${key} |`).replace("cycle_start: \n", "cycle_start: 2026-11-01\n"));
    expect([v2.brandKit, v2.stripeLink]).toEqual([{ filled: 0, total: 6 }, ""]);
    const qs = sprintQuests(v2, computeStatus(v2, DEFAULT_THRESHOLDS, "2026-11-05"), "2026-11-05");
    expect(qs.find((q) => q.id === "mkt-stripe")?.state).not.toBe("done");
    const v1 = mkt(S.MKT_V1_FILLED.replace("https://buy.stripe.com/test_demo", `[pay](https://example.com/${key})`));
    expect([v1.brandKit, v1.stripeLink]).toEqual([{ filled: 3, total: 6 }, ""]);
  });
});
