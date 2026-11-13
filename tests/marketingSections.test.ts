// The pure parts of the Competitors and Hooks sections (src/ui/marketing.ts): the status lines, the video number
// "Use in a video" announces, and the edit sheets' save mapping, applied to the sample notes with the real table
// editor, so a sheet that changes nothing else never conflicts with what it showed (U2).

import { describe, expect, it } from "vitest";
import { parseMarketing } from "../src/data/marketing";
import type { MarketingNote } from "../src/data/marketing";
import { splitLink, useHookOp } from "../src/data/marketingOps";
import { parseProfile } from "../src/data/profile";
import { applyTableOp, ConflictError } from "../src/data/tableEdit";
import type { TableOp } from "../src/data/tableEdit";
import * as M from "../src/ui/marketing";
import * as S from "./samples";

const profileOf = (spec: string) => parseProfile(spec, S.frontmatterOf(spec), {});
const FILLED = profileOf(S.SPEC_FILLED);
const EMPTY = profileOf(S.SPEC_EMPTY);
const TBD = profileOf(S.SPEC_TBD);

const MISSING_3 = "MISSING: competitor 3 (checked 41, none passed all 6 checks)";
const MISSING_HOOK = "MISSING: evidence for a Recommended hook (needs 2 videos at 2×+ from 2 competitors)";

/** Each note as written, padded by Obsidian's table editor, and both again with CRLF line endings. */
const variants = (note: string): Record<string, string> => ({
  "as written": note,
  padded: S.padTables(note),
  crlf: S.crlf(note),
  "padded crlf": S.crlf(S.padTables(note)),
});

/** Applies the op, checks that its inverse gives the note back byte for byte, and returns the new note as data. */
function apply(note: string, op: TableOp): { text: string; m: MarketingNote } {
  const r = applyTableOp(note, op);
  expect(applyTableOp(r.text, r.inverse).text).toBe(note);
  return { text: r.text, m: parseMarketing(r.text) };
}

/** What an edit sheet hands save() when the user changed `typed` and nothing moved what they saw. */
function sheet<T extends Record<string, string | undefined>>(form: T, typed: Record<string, string>) {
  const seen = Object.fromEntries(Object.entries(form).filter(([, v]) => v !== undefined)) as Record<string, string>;
  const values = { ...seen, ...typed };
  const changed = Object.keys(typed).filter((k) => typed[k] !== seen[k]);
  return { values, changed, seen };
}

describe("readOnlyLine (U8)", () => {
  it("queued, scaled and killed products are read-only, in plain words", () => {
    expect(M.readOnlyLine("queued")).toBe("Queued: not in a sprint yet, so nothing here can be changed.");
    expect(M.readOnlyLine(" Queued ")).toBe("Queued: not in a sprint yet, so nothing here can be changed.");
    expect(M.readOnlyLine("scaled")).toBe("Archived: this sprint was decided (Scale), so nothing here can be changed.");
    expect(M.readOnlyLine("KILLED")).toBe("Archived: this sprint was decided (Kill), so nothing here can be changed.");
  });
  it("a running sprint can be changed", () => {
    for (const s of ["building", "launched", ""]) expect(M.readOnlyLine(s)).toBeNull();
  });
});

describe("researchLine", () => {
  it("not researched, nothing asked, profile complete", () => {
    expect(M.researchLine(parseMarketing(S.MKT_V2_TEMPLATE), FILLED, "2026-11-21")).toEqual({ text: "Not researched yet.", fillIn: false });
    expect(M.researchLine(null, FILLED, "2026-11-21")).toEqual({ text: "Not researched yet.", fillIn: false });
  });
  it("can't start: names every missing field and offers Fill in", () => {
    expect(M.researchLine(parseMarketing(S.MKT_V2_TEMPLATE), EMPTY, "2026-11-21")).toEqual({
      text: "Research can't start yet: the Dev Spec is missing Product type, One-line pitch, Who buys it, Job it does, Price, Target platforms and Core mechanic.",
      fillIn: true,
    });
    expect(M.researchLine(parseMarketing(S.MKT_V2_REQUESTED), TBD, "2026-11-21").text).toBe(
      "Research can't start yet: the Dev Spec is missing Who buys it, Job it does, Price and Target platforms.",
    );
  });
  it("asked and waiting: who asked and when", () => {
    const m = parseMarketing(S.MKT_V2_REQUESTED);
    const line = (today: string) => M.researchLine(m, FILLED, today).text;
    expect(line("2026-11-21")).toBe("The Marketer asked for research 3 days ago. Waiting for the Developer to run /competitors.");
    expect(line("2026-11-19")).toBe("The Marketer asked for research yesterday. Waiting for the Developer to run /competitors.");
    expect(line("2026-11-18")).toBe("The Marketer asked for research today. Waiting for the Developer to run /competitors.");
    // The other Mac's clock was ahead: never "asked for research tomorrow".
    expect(line("2026-11-17")).toBe("The Marketer asked for research today. Waiting for the Developer to run /competitors.");
    const byDev = parseMarketing(S.MKT_V2_REQUESTED.replace("by=marketing", "by=dev"));
    expect(M.researchLine(byDev, FILLED, "2026-11-18").text).toBe("The Developer asked for research today. Waiting for the Developer to run /competitors.");
    const unknown = parseMarketing(S.MKT_V2_REQUESTED.replace(" by=marketing", ""));
    expect(M.researchLine(unknown, FILLED, "2026-11-18").text).toBe("A partner asked for research today. Waiting for the Developer to run /competitors.");
    // A by= word that is a built-in name of every object is still an unknown partner.
    for (const by of ["constructor", "valueOf", "toString", "__proto__"]) {
      const odd = parseMarketing(S.MKT_V2_REQUESTED.replace("by=marketing", `by=${by}`));
      expect(M.researchLine(odd, FILLED, "2026-11-18").text, by).toBe("A partner asked for research today. Waiting for the Developer to run /competitors.");
    }
  });
  it("researched: date, counts and the round; a request older than the research isn't pending", () => {
    for (const [name, note] of Object.entries(variants(S.MKT_V2_RESEARCHED))) {
      expect(M.researchLine(parseMarketing(note), FILLED, "2026-11-21"), name).toEqual({ text: "Researched Nov 20 in 2 search rounds: checked 41 products, kept 2.", fillIn: false });
      // An incomplete profile doesn't hide research that already ran.
      expect(M.researchLine(parseMarketing(note), EMPTY, "2026-11-21").text, name).toBe("Researched Nov 20 in 2 search rounds: checked 41 products, kept 2.");
    }
    expect(M.researchLine(parseMarketing(S.MKT_V2_RESEARCHED), FILLED, "2027-01-05").text).toBe("Researched Nov 20, 2026 in 2 search rounds: checked 41 products, kept 2.");
  });
  it("researched with fewer facts, one product, or more than 3 rounds", () => {
    const marker = "<!-- nx-research: date=2026-11-20 checked=41 kept=2 rounds=2 sources=crawl4ai,shorts -->";
    const with_ = (line: string) => parseMarketing(S.MKT_V2_RESEARCHED.replace(marker, line));
    expect(M.researchLine(with_("<!-- nx-research: date=2026-11-20 -->"), FILLED, "2026-11-21").text).toBe("Researched Nov 20.");
    expect(M.researchLine(with_("<!-- nx-research: date=2026-11-20 checked=1 kept=1 rounds=1 -->"), FILLED, "2026-11-21").text).toBe(
      "Researched Nov 20 in 1 search round: checked 1 product, kept 1.",
    );
    expect(M.researchLine(with_("<!-- nx-research: date=2026-11-20 kept=3 rounds=4 -->"), FILLED, "2026-11-21").text).toBe("Researched Nov 20 in 4 search rounds: kept 3.");
  });
  it("read-only sections leave the Dev Spec out (research doesn't run for a queued product)", () => {
    const opts = { blockers: false };
    expect(M.researchLine(parseMarketing(S.MKT_V2_TEMPLATE), EMPTY, "2026-11-21", opts)).toEqual({ text: "Not researched yet.", fillIn: false });
    expect(M.researchLine(parseMarketing(S.MKT_V2_REQUESTED), EMPTY, "2026-11-21", opts).text).toBe(
      "The Marketer asked for research 3 days ago. Waiting for the Developer to run /competitors.",
    );
  });
  it("a request made after the research is pending again, or blocked by the profile", () => {
    const again = parseMarketing(S.MKT_V2_RESEARCHED.replace("nx-research-request: date=2026-11-18", "nx-research-request: date=2026-11-21"));
    expect(M.researchLine(again, FILLED, "2026-11-22").text).toBe("The Marketer asked for research yesterday. Waiting for the Developer to run /competitors.");
    expect(M.researchLine(again, TBD, "2026-11-22")).toEqual({
      text: "Research can't start yet: the Dev Spec is missing Who buys it, Job it does, Price and Target platforms.",
      fillIn: true,
    });
  });
});

describe("Use in a video", () => {
  it("announces the number the insert op gives the new video", () => {
    const cases: Array<[string, string, string]> = [
      ["v2 template (row 1 holds only examples)", S.MKT_V2_TEMPLATE, "1"],
      ["v2 researched (row 2 holds only examples)", S.MKT_V2_RESEARCHED, "2"],
      ["v1 filled (3 videos, no free row)", S.MKT_V1_FILLED, "4"],
      ["v1 template (row 1 numbered, empty)", S.MKT_V1_TEMPLATE, "1"],
    ];
    for (const [name, base, expected] of cases) {
      for (const [variant, note] of Object.entries(variants(base))) {
        const m = parseMarketing(note);
        const hook = m.hooks!.rows[0];
        expect(M.nextVideoNumber(m), `${name}, ${variant}`).toBe(expected);
        const after = apply(note, useHookOp(m, hook)).m;
        const added = after.backlog!.filter((r) => r.hookNum === hook.num && !m.backlog!.some((b) => b.index === r.index && b.hookNum === hook.num));
        expect(added.map((r) => r.num), `${name}, ${variant}`).toEqual([expected]);
      }
    }
  });
  it("a video row without a number gets the next one", () => {
    const note = S.MKT_V1_FILLED.replace("| 3 | Close-up of the knob, 10s | Shorts | 3 | scripted | 2026-11-16 |", "| 3 | Close-up of the knob, 10s | Shorts | 3 | scripted | 2026-11-16 |\n| | | | | | |");
    const m = parseMarketing(note);
    expect(m.backlog).toHaveLength(4);
    expect(M.nextVideoNumber(m)).toBe("4");
    expect(apply(note, useHookOp(m, m.hooks!.rows[1])).m.backlog![3]).toMatchObject({ num: "4", hookNum: "2" });
  });
  it("each hook says which videos use it", () => {
    const v1 = parseMarketing(S.MKT_V1_FILLED);
    expect(v1.hooks!.rows.map((r) => M.videosUsing(v1, r))).toEqual([["1"], ["2"], ["3"]]);
    const v2 = parseMarketing(S.MKT_V2_RESEARCHED);
    // Video 2's Hook # holds only an example ("e.g. 2"), so it doesn't count.
    expect(v2.hooks!.rows.map((r) => M.videosUsing(v2, r))).toEqual([["1"], [], [], [], [], [], [], [], [], []]);
    const twice = parseMarketing(S.MKT_V1_FILLED.replace("| 3 | scripted |", "| #1 | scripted |"));
    expect(M.videosUsing(twice, twice.hooks!.rows[0])).toEqual(["1", "3"]);
    expect(M.videosUsing(twice, twice.hooks!.rows[2])).toEqual([]);
    expect(M.usedText(["2"])).toBe("In video 2");
    expect(M.usedText(["1", "3"])).toBe("In videos 1 and 3");
    expect(M.usedText(["1", "2", "4"])).toBe("In videos 1, 2 and 4");
  });
});

describe("findHook", () => {
  it("finds a hook by its # after a partner deleted the row above it, and null once it's gone", () => {
    const m = parseMarketing(S.MKT_V2_RESEARCHED);
    const hook5 = m.hooks!.rows[4];
    const lines = S.MKT_V2_RESEARCHED.split("\n");
    const without4 = lines.filter((l) => !l.startsWith("| 4 |")).join("\n");
    const after = parseMarketing(without4);
    expect(M.findHook(after, hook5)).toMatchObject({ num: "5", index: 3 });
    expect(M.findHook(parseMarketing(lines.filter((l) => !l.startsWith("| 5 |")).join("\n")), hook5)).toBeNull();
    expect(M.findHook(null, hook5)).toBeNull();
  });
  it("a hook without a # is found by its place", () => {
    const note = S.MKT_V2_RESEARCHED.replace("| 7 | 🟡 Medium |", "| | 🟡 Medium |");
    const row = parseMarketing(note).hooks!.rows[6];
    expect(row.num).toBe("");
    expect(M.findHook(parseMarketing(note), row)).toMatchObject({ index: 6 });
  });
});

describe("the competitor sheet's save", () => {
  it("every competitor saves one changed field without a conflict, padded or CRLF", () => {
    for (const [name, note] of Object.entries(variants(S.MKT_V2_RESEARCHED))) {
      const rows = parseMarketing(note).competitors!;
      for (const row of rows.filter((r) => r.missing === null)) {
        const s = sheet(M.competitorForm(row), { why: "Shows the result first" });
        const after = apply(note, M.competitorSave(row, s.values, s.changed, s.seen)).m.competitors![row.index];
        expect(after.why.value, name).toBe("Shows the result first");
        expect(after.name.value, name).toBe(row.name.value);
      }
    }
  });
  it("changing only the store link keeps the name; changing only the name keeps the link", () => {
    const row = parseMarketing(S.MKT_V2_RESEARCHED).competitors![0];
    const url = sheet(M.competitorForm(row), { storeUrl: "https://example.com/acme-vox-2" });
    expect(apply(S.MKT_V2_RESEARCHED, M.competitorSave(row, url.values, url.changed, url.seen)).m.competitors![0].name.value).toBe("[Acme Vox](https://example.com/acme-vox-2)");
    const label = sheet(M.competitorForm(row), { name: "Acme Vox Pro" });
    expect(apply(S.MKT_V2_RESEARCHED, M.competitorSave(row, label.values, label.changed, label.seen)).m.competitors![0].name.value).toBe("[Acme Vox Pro](https://example.com/acme-vox)");
  });
  it("a MISSING row shows an empty Name, and filling it replaces the MISSING line", () => {
    const row = parseMarketing(S.MKT_V2_RESEARCHED).competitors![2];
    expect(row.missing).not.toBeNull();
    expect(M.competitorForm(row)).toMatchObject({ name: "", storeUrl: "" });
    const s = sheet(M.competitorForm(row), { name: "Gamma Labs", storeUrl: "https://example.com/gamma" });
    const after = apply(S.MKT_V2_RESEARCHED, M.competitorSave(row, s.values, s.changed, s.seen)).m.competitors![2];
    expect(after.name.value).toBe("[Gamma Labs](https://example.com/gamma)");
    expect(after.missing).toBeNull();
  });
  it("a MISSING row with only a link typed never turns the MISSING line into a link label", () => {
    const row = parseMarketing(S.MKT_V2_RESEARCHED).competitors![2];
    const s = sheet(M.competitorForm(row), { storeUrl: "https://example.com/gamma" });
    expect(apply(S.MKT_V2_RESEARCHED, M.competitorSave(row, s.values, s.changed, s.seen)).m.competitors![2].name.value).toBe("https://example.com/gamma");
  });
  it("a MISSING row whose reason changed while the sheet was open still saves, with the line the sheet last read", () => {
    const row = parseMarketing(S.MKT_V2_RESEARCHED).competitors![2];
    const later = S.MKT_V2_RESEARCHED.replace("checked 41, none passed", "checked 52, none passed");
    const behind = splitLink(parseMarketing(later).competitors![2].name).label;
    const s = sheet(M.competitorForm(row), { name: "Gamma Labs" });
    expect(() => applyTableOp(later, M.competitorSave(row, s.values, s.changed, s.seen))).toThrow(ConflictError);
    expect(apply(later, M.competitorSave(row, s.values, s.changed, s.seen, behind)).m.competitors![2].name.value).toBe("Gamma Labs");
  });
  it("a partner's change the user kept (Keep mine) is what the save expects", () => {
    const row = parseMarketing(S.MKT_V2_RESEARCHED).competitors![1];
    const partner = S.MKT_V2_RESEARCHED.replace("[Beta Audio](https://example.com/beta-audio)", "[Beta Audio X](https://example.com/beta-x)");
    const theirs = M.competitorForm(parseMarketing(partner).competitors![1]);
    const s = sheet(M.competitorForm(row), { name: "Beta Audio Pro" });
    // Saved against what the sheet first showed: the partner's change is refused.
    expect(() => applyTableOp(partner, M.competitorSave(row, s.values, s.changed, s.seen))).toThrow(ConflictError);
    // After Keep mine (and the link quietly taken from the partner), it overwrites knowingly.
    const seen = { ...s.seen, name: theirs.name, storeUrl: theirs.storeUrl };
    const values = { ...s.values, storeUrl: theirs.storeUrl };
    const changed = Object.keys(values).filter((k) => values[k as keyof typeof values] !== seen[k as keyof typeof seen]);
    expect(changed).toEqual(["name"]);
    expect(apply(partner, M.competitorSave(row, values, changed, seen)).m.competitors![1].name.value).toBe("[Beta Audio Pro](https://example.com/beta-x)");
  });
  it("fills an empty template row", () => {
    const row = parseMarketing(S.MKT_V2_TEMPLATE).competitors![1];
    const s = sheet(M.competitorForm(row), { name: "Delta Example", storeUrl: "https://example.com/delta", video: "40k views · 2.1× usual", videoUrl: "https://example.com/v/9" });
    const after = apply(S.MKT_V2_TEMPLATE, M.competitorSave(row, s.values, s.changed, s.seen)).m.competitors![1];
    expect([after.name.value, after.link.value]).toEqual(["[Delta Example](https://example.com/delta)", "[40k views · 2.1× usual](https://example.com/v/9)"]);
  });
});

describe("the hook sheet's save", () => {
  it("every hook saves one changed field without a conflict, padded or CRLF", () => {
    for (const [name, note] of Object.entries(variants(S.MKT_V2_RESEARCHED))) {
      for (const row of parseMarketing(note).hooks!.rows) {
        const s = sheet(M.hookForm(row), { basedOn: "[Acme Vox 3×](https://example.com/v/20)" });
        const after = apply(note, M.hookSave(row, s.values, s.changed, s.seen)).m.hooks!.rows[row.index];
        expect(after.basedOn.value, `${name}, hook ${row.num}`).toBe("[Acme Vox 3×](https://example.com/v/20)");
      }
    }
  });
  it("the Rating select writes the word with its icon", () => {
    const row = parseMarketing(S.MKT_V2_RESEARCHED).hooks!.rows[0];
    const s = sheet(M.hookForm(row), { rating: "medium" });
    const after = apply(S.MKT_V2_RESEARCHED, M.hookSave(row, s.values, s.changed, s.seen)).m.hooks!.rows[0];
    expect([after.rating, after.ratingCell.value]).toEqual(["medium", "🟡 Medium"]);
  });
  it("a partner who wrote the rating without its icon doesn't block a rating change", () => {
    const row = parseMarketing(S.MKT_V2_RESEARCHED).hooks!.rows[3];
    const partner = S.MKT_V2_RESEARCHED.replace("| 4 | 🟡 Medium |", "| 4 | Medium |");
    const fresh = parseMarketing(partner).hooks!.rows[3];
    // Same rating, so the sheet's select didn't move; it read the cell's new words.
    expect(M.hookForm(fresh).rating).toBe(M.hookForm(row).rating);
    const ratingText = new Map([[row.rating as string, row.ratingCell.value]]);
    const s = sheet(M.hookForm(row), { rating: "recommended" });
    expect(() => applyTableOp(partner, M.hookSave(row, s.values, s.changed, s.seen, { ratingText }))).toThrow(ConflictError);
    ratingText.set(fresh.rating, fresh.ratingCell.value);
    expect(apply(partner, M.hookSave(row, s.values, s.changed, s.seen, { ratingText })).m.hooks!.rows[3].ratingCell.value).toBe("🟢 Recommended");
  });
  it("a MISSING hook shows an empty box, and writing one replaces the MISSING line", () => {
    const row = parseMarketing(S.MKT_V2_RESEARCHED).hooks!.rows[2];
    expect(row.hook.value).toBe(MISSING_HOOK);
    expect(M.hookForm(row).hook).toBe("");
    const s = sheet(M.hookForm(row), { hook: `"One knob. Soft S's. Watch."`, demo: "Screen: knob up at second 1" });
    const after = apply(S.MKT_V2_RESEARCHED, M.hookSave(row, s.values, s.changed, s.seen)).m.hooks!.rows[2];
    expect([after.hook.value, after.demo.value, after.missing]).toEqual([`"One knob. Soft S's. Watch."`, "Screen: knob up at second 1", null]);
    // Its reason changed while the sheet was open: the save expects the line the sheet last read.
    const later = S.MKT_V2_RESEARCHED.replace("needs 2 videos at 2×+", "needs 2 videos at 2× or more");
    const behind = parseMarketing(later).hooks!.rows[2].hook.value;
    expect(() => applyTableOp(later, M.hookSave(row, s.values, s.changed, s.seen))).toThrow(ConflictError);
    expect(apply(later, M.hookSave(row, s.values, s.changed, s.seen, { hookBehind: behind })).m.hooks!.rows[2].missing).toBeNull();
  });
  it("old v1 notes: no Rating in the form, and a save never adds the column (U9)", () => {
    for (const [name, note] of Object.entries(variants(S.MKT_V1_FILLED))) {
      const m = parseMarketing(note);
      const row = m.hooks!.rows[1];
      expect(M.hookForm(row), name).not.toHaveProperty("rating");
      const s = sheet(M.hookForm(row), { cta: "$29 once. Link in bio." });
      const after = apply(note, M.hookSave(row, { ...s.values, rating: "avoid" }, [...s.changed, "rating"], s.seen));
      expect(after.m.hooks!.layout, name).toBe("v1");
      expect(after.m.hooks!.rows[1].cta.value, name).toBe("$29 once. Link in bio.");
      expect(after.text.split(/\r?\n/).filter((l) => l.includes("Rating")), name).toEqual([]);
    }
  });
  it("a Don't use row rated back up gets its dashes cleared", () => {
    const row = parseMarketing(S.MKT_V2_RESEARCHED).hooks!.rows[8];
    expect(row.rating).toBe("avoid");
    const s = sheet(M.hookForm(row), { rating: "medium" });
    const after = apply(S.MKT_V2_RESEARCHED, M.hookSave(row, s.values, s.changed, s.seen)).m.hooks!.rows[8];
    expect([after.rating, after.demo.value, after.cta.value]).toEqual(["medium", "", ""]);
  });
  it("the MISSING constant matches the sample (guards the tests above)", () => {
    expect(parseMarketing(S.MKT_V2_RESEARCHED).competitors![2].name.value).toBe(MISSING_3);
  });
});

// ---------------------------------------------------------------------------------------------------
// Fix round
// ---------------------------------------------------------------------------------------------------

describe("the hook sheet expects the Rating cell's words as they are", () => {
  it("a partner retyped the same rating as a plain word, or cleared a TBD: the save goes through", () => {
    for (const [name, note] of Object.entries(variants(S.MKT_V2_RESEARCHED))) {
      const row = parseMarketing(note).hooks!.rows[1];
      const ratingText = new Map([[row.rating as string, row.ratingCell.value]]);
      const partner = applyTableOp(note, { kind: "set", heading: "hook scripts", edits: [{ row: { key: "2", col: "#" }, values: { rating: "recommended" }, expect: {} }] }).text;
      const fresh = parseMarketing(partner).hooks!.rows[1];
      expect(fresh.rating, name).toBe(row.rating);
      ratingText.set(fresh.rating, fresh.ratingCell.value);
      const s = sheet(M.hookForm(row), { rating: "medium" });
      // Built on the row the sheet opened with: only the Rating text it last read decides the expect.
      expect(apply(partner, M.hookSave(row, s.values, s.changed, s.seen, { ratingText })).m.hooks!.rows[1].ratingCell.value, name).toBe("🟡 Medium");
    }
    const tbd = S.MKT_V2_RESEARCHED.replace("| 4 | 🟡 Medium |", "| 4 | TBD |");
    const row = parseMarketing(tbd).hooks!.rows[3];
    expect([row.rating, row.ratingCell.value]).toEqual(["", "TBD"]);
    const ratingText = new Map([[row.rating as string, row.ratingCell.value]]);
    const cleared = S.MKT_V2_RESEARCHED.replace("| 4 | 🟡 Medium |", "| 4 | |");
    ratingText.set("", parseMarketing(cleared).hooks!.rows[3].ratingCell.value);
    const s = sheet(M.hookForm(row), { rating: "medium" });
    expect(apply(cleared, M.hookSave(row, s.values, s.changed, s.seen, { ratingText })).m.hooks!.rows[3].ratingCell.value).toBe("🟡 Medium");
  });
});

describe("Use in a video names the video the insert writes", () => {
  it("a free-looking row with text in a column the dashboard doesn't show isn't free", () => {
    const note = S.MKT_V2_RESEARCHED.replace("| # | Format | Platform(s) | Hook # | Status (scripted / recorded / edited / scheduled) | Go-live date |", "| # | Format | Platform(s) | Hook # | Status (scripted / recorded / edited / scheduled) | Go-live date | Notes |")
      .replace(/^(\| 1 \| Screen recording[^\n]*\|)$/m, "$1 |")
      .replace(/^(\| 2 \| <span[^\n]*\|)$/m, "$1 film at dusk |");
    const m = parseMarketing(note);
    expect(m.backlog!.map((r) => r.extra ?? false)).toEqual([false, true]);
    expect(M.nextVideoNumber(m)).toBe("3");
    const after = apply(note, useHookOp(m, m.hooks!.rows[3])).m;
    expect(after.backlog!.map((r) => `${r.num}:${r.hookNum}`)).toEqual(["1:1", "2:", "3:4"]);
  });
});

describe("findHook with a # two hooks share", () => {
  it("keeps the second hook 4 after a line above is added, and never swaps in the first", () => {
    const twins = S.MKT_V2_RESEARCHED.replace("| 5 | 🟡 Medium |", "| 4 | 🟡 Medium |");
    const before = parseMarketing(twins).hooks!.rows;
    const second = before[4];
    const above = parseMarketing(twins.replace("| 1 | 🟢 Recommended |", "| 0 | 🟡 Medium | \"Zero.\" | x | y | z |\n| 1 | 🟢 Recommended |")).hooks!;
    expect(M.findHook({ ...parseMarketing(twins), hooks: above }, second, before)).toMatchObject({ index: 5, hook: { value: second.hook.value } });
    const gone = parseMarketing(twins.split("\n").filter((l) => !l.startsWith(`| 4 | 🟡 Medium | "One knob.`)).join("\n"));
    expect(M.findHook(gone, second, before)).toBeNull();
  });
});
