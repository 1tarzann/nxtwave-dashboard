// The Marketing side's layout (src/ui/product.ts): which parts come first before and after launch, the counters'
// numbers and lines, and the ⓘ help text of the 0.5.0 sections (src/data/fields.ts).

import { describe, expect, it } from "vitest";
import { FIELDS } from "../src/data/fields";
import { parseMarketing } from "../src/data/marketing";
import { useHookOp } from "../src/data/marketingOps";
import { buildSnapshot } from "../src/data/snapshot";
import { applyTableOp } from "../src/data/tableEdit";
import { isVideoRow } from "../src/data/marketing";
import { afterLaunch, hooksSub, marketingParts, videosSub } from "../src/ui/product";
import { doc } from "./helpers";
import * as S from "./samples";

const mkt = (body: string) => buildSnapshot("Demo_Tool", "x", { marketing: doc("2_Marketing_Engine.md", S.frontmatterOf(body), body) });
const forms = (note: string) => [note, S.padTables(note), S.crlf(note), S.crlf(S.padTables(note))];

describe("afterLaunch: from sprint day 15 while the sprint runs", () => {
  it("is on from day 15 for watching and extended sprints", () => {
    expect(afterLaunch("watching", 15)).toBe(true);
    expect(afterLaunch("watching", 20)).toBe(true);
    expect(afterLaunch("extended", 33)).toBe(true);
    expect(afterLaunch("Watching ", 16)).toBe(true);
  });

  it("is off before day 15, without Day 1, and for products outside a running sprint", () => {
    expect(afterLaunch("watching", 14)).toBe(false);
    expect(afterLaunch("building", 14)).toBe(false);
    expect(afterLaunch("watching", null)).toBe(false);
    expect(afterLaunch("queued", 20)).toBe(false);
    expect(afterLaunch("scaled", 40)).toBe(false);
    expect(afterLaunch("killed", 22)).toBe(false);
  });

  it("counts a sprint still marked building on day 15 as launched, like the status colors do", () => {
    expect(afterLaunch("building", 15)).toBe(true);
  });
});

describe("marketingParts: the order of the Marketing side", () => {
  it("before launch: counters, competitors, hooks, videos, brand kit, then paid test, spend chart, social stats", () => {
    expect(marketingParts(false, true)).toEqual(["counters", "competitors", "hooks", "videos", "brandkit", "paidtest", "spend", "social"]);
  });

  it("after launch: paid test, spend chart and social stats first, then the rest in the same order", () => {
    expect(marketingParts(true, true)).toEqual(["paidtest", "spend", "social", "counters", "competitors", "hooks", "videos", "brandkit"]);
  });

  it("without a Marketing Engine: one line naming the missing note where its parts would be; the Analytics parts stay", () => {
    expect(marketingParts(false, false)).toEqual(["missingNote", "spend", "social"]);
    expect(marketingParts(true, false)).toEqual(["spend", "social", "missingNote"]);
  });

  it("shows every part exactly once", () => {
    for (const after of [false, true]) {
      const parts = marketingParts(after, true);
      expect(new Set(parts).size).toBe(parts.length);
    }
  });
});

describe("the hooks counter", () => {
  it("counts every rated hook in a new note and says so", () => {
    for (const note of forms(S.MKT_V2_RESEARCHED)) {
      const p = mkt(note);
      expect(p.hooksTotal).toBe(10);
      expect(hooksSub(p)).toBe("10 rated hooks");
    }
    expect(hooksSub(mkt(S.MKT_V2_TEMPLATE))).toBe("10 rated hooks");
  });

  it("names the old 3-hook layout", () => {
    for (const note of [...forms(S.MKT_V1_FILLED), S.MKT_V1_TEMPLATE]) {
      const p = mkt(note);
      expect(p.hooksTotal).toBe(3);
      expect(hooksSub(p)).toBe("3 hooks (old layout)");
    }
  });

  it("says when the note has no hooks yet", () => {
    const noHooks = S.MKT_V2_TEMPLATE.replace("## 2. Hook scripts", "## 2. Opening lines");
    expect(hooksSub(mkt(noHooks))).toBe("No hook list in the note yet");
  });
});

describe("the Videos scheduled counter counts what Videos to make shows", () => {
  it("v2 notes: the snapshot counts exactly the rows the section shows as videos", () => {
    for (const note of [...forms(S.MKT_V2_RESEARCHED), S.MKT_V2_TEMPLATE, S.MKT_V2_REVIEWED]) {
      const p = mkt(note);
      const videos = (p.marketing?.backlog ?? []).filter(isVideoRow);
      expect(p.backlog.total).toBe(videos.length);
      expect(p.backlog.scheduled).toBe(videos.filter((v) => v.status === "scheduled").length);
    }
    expect(mkt(S.MKT_V1_FILLED).backlog).toEqual({ total: 3, scripted: 1, recorded: 1, edited: 0, scheduled: 1 });
  });

  it("counts a video made by Use in a video at once, as not recorded yet", () => {
    for (const note of forms(S.MKT_V2_RESEARCHED)) {
      const m = parseMarketing(note);
      const hook2 = m.hooks?.rows.find((r) => r.num === "2");
      if (!hook2) throw new Error("the sample has no hook 2");
      const after = mkt(applyTableOp(note, useHookOp(m, hook2)).text);
      expect(after.backlog).toEqual({ total: 2, scripted: 1, recorded: 1, edited: 0, scheduled: 0 });
    }
  });

  it("says each step in the status steps' own words", () => {
    expect(videosSub({ total: 0, scripted: 0, recorded: 0, edited: 0, scheduled: 0 })).toBe("No videos planned yet");
    expect(videosSub({ total: 3, scripted: 1, recorded: 1, edited: 0, scheduled: 1 })).toBe("1 scripted · 1 recorded · 0 edited");
  });
});

describe("ⓘ help for the 0.5.0 sections", () => {
  const KEYS = ["competitors", "hooks", "research", "backlog", "brandKit", "paidTest", "profile"] as const;
  // A full stop after a heading number ("1. Competitor swipe") doesn't end a sentence.
  const sentences = (s: string) => s.split(/(?<=[^\d\s][.!?])\s+(?=[A-Z0-9“"])/).filter(Boolean).length;

  it("says what each part is and where it lives in the note, in 1 or 2 sentences each", () => {
    for (const k of KEYS) {
      const f = FIELDS[k];
      for (const text of [f.label, f.what, f.why, f.where, f.who]) expect(text.trim(), `${k}`).not.toBe("");
      expect(sentences(f.what), `${k}.what`).toBeLessThanOrEqual(2);
      expect(sentences(f.where), `${k}.where`).toBeLessThanOrEqual(2);
      expect(f.where, `${k}.where`).toMatch(/Marketing Engine|Dev Spec/);
    }
  });

  it("names the sections the way their titles do", () => {
    expect(FIELDS.competitors.label).toBe("Competitors");
    expect(FIELDS.hooks.label).toBe("Hooks");
    expect(FIELDS.backlog.label).toBe("Videos to make");
    expect(FIELDS.brandKit.label).toBe("Brand kit");
    expect(FIELDS.paidTest.label).toBe("Paid test plan");
  });

  it("uses plain words: no note-format terms, no banned words, and a rating icon never stands alone", () => {
    const jargon = /\b(table|cell|cells|marker|markers|frontmatter|op|ops|row index)\b/i;
    const banned = /\b(delve|leverage|seamless|robust|game-changer|unlock|elevate|revolutionize|cutting-edge)\b/i;
    for (const k of KEYS) {
      const text = Object.values(FIELDS[k]).join(" ");
      expect(text, k).not.toMatch(jargon);
      expect(text, k).not.toMatch(banned);
      for (const icon of ["🟢", "🟡", "🔴"]) {
        for (const at of [...text.matchAll(new RegExp(icon, "gu"))].map((x) => x.index ?? 0)) {
          expect(text.slice(at + icon.length).trimStart(), `${k}: ${icon}`).toMatch(/^(Recommended|Medium|Don't use)/);
        }
      }
    }
  });
});
