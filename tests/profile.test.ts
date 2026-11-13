import { describe, expect, it } from "vitest";
import { section, tableIn } from "../src/data/markdown";
import { parsePrice, parseProfile, PROFILE_EXAMPLES, ProductProfile, SPEC_SECTIONS } from "../src/data/profile";
import { applyTableOp } from "../src/data/tableEdit";
import { crlf, frontmatterOf, padTables, SPEC_EMPTY, SPEC_FILLED, SPEC_NO_TABLE, SPEC_SPAN_ONLY, SPEC_TBD } from "./samples";

const HUB_FM = { sprint_status: "building", category: "[[04_Company_Ops/Categories/Audio_Tools|Audio Tools]]" };
const profile = (spec: string, hub: Record<string, unknown> = HUB_FM) => parseProfile(spec, frontmatterOf(spec), hub);
const fields = (p: ProductProfile) => p.missing.map((m) => m.field);

const ALL_FIELDS = ["Product type", "One-line pitch", "Who buys it", "Job it does", "Price", "Target platforms", "Core mechanic"];
const TABLE = "Dev Spec → 1. One-line pitch (the lines under the pitch)";
const NO_TABLE = "Dev Spec → 1. One-line pitch (paste the 3 lines from the Dev Spec template)";
const MECHANICS = ["One knob sets how much the S sounds are softened", "Finds S sounds on its own and turns only those down", "Before/after button to compare in one click"];

describe("parseProfile on the 5 sample specs", () => {
  it("the empty template misses all 7 fields, each with where it goes", () => {
    const p = profile(SPEC_EMPTY);
    expect(p.complete).toBe(false);
    expect(p.missing).toEqual([
      { field: "Product type", where: "Dev Spec → Product type (in the properties at the top)" },
      { field: "One-line pitch", where: "Dev Spec → 1. One-line pitch (the quote line under the heading)" },
      { field: "Who buys it", where: TABLE },
      { field: "Job it does", where: TABLE },
      { field: "Price", where: TABLE },
      { field: "Target platforms", where: "Dev Spec → 4. Tech preset → Target platforms" },
      { field: "Core mechanic", where: "Dev Spec → 2. Core mechanics (at least 1 numbered item)" },
    ]);
    expect(p).toMatchObject({ productType: "", pitch: "", buyer: "", job: "", price: "", platform: "", store: "", mechanics: [] });
    expect(p.priceParsed).toEqual({ amount: null, currency: "", model: "unknown" });
  });
  it("the filled spec is complete", () => {
    expect(profile(SPEC_FILLED)).toEqual({
      productType: "Audio plugin",
      pitch: "A one-knob de-esser that tames harsh S sounds in home-studio vocals.",
      buyer: "Home-studio vocalists who record and mix their own songs",
      job: "Softens harsh S sounds in a vocal with one knob",
      price: "$29 one-time",
      priceParsed: { amount: 29, currency: "USD", model: "one-time" },
      platform: "macOS + Windows (VST3, AU)",
      store: "Own website, direct download",
      mechanics: MECHANICS,
      category: "Audio Tools",
      profileColumns: { label: "Item", value: "Value" },
      missing: [],
      complete: true,
    });
  });
  it("profile rows that hold only examples are missing (padded table right above ## 2.)", () => {
    const p = profile(SPEC_SPAN_ONLY);
    expect(p.missing).toEqual([
      { field: "Who buys it", where: TABLE },
      { field: "Job it does", where: TABLE },
      { field: "Price", where: TABLE },
    ]);
    expect(p).toMatchObject({ buyer: "", job: "", price: "", platform: "macOS + Windows (VST3, AU)", complete: false });
    expect(p.mechanics).toEqual(MECHANICS);
  });
  it("TBD is missing, in the profile table and in the tech preset", () => {
    const p = profile(SPEC_TBD);
    expect(fields(p)).toEqual(["Who buys it", "Job it does", "Price", "Target platforms"]);
    expect(p.missing.find((m) => m.field === "Target platforms")?.where).toBe("Dev Spec → 4. Tech preset → Target platforms");
    // Values stay as typed; `missing` says what isn't filled.
    expect(p).toMatchObject({ buyer: "TBD", job: "TBD", price: "TBD", platform: "TBD" });
    expect(p.priceParsed).toEqual({ amount: null, currency: "", model: "unknown" });
  });
  it("without the profile table, the 3 rows say to paste it from the template", () => {
    const p = profile(SPEC_NO_TABLE);
    expect(p.missing).toEqual([
      { field: "Who buys it", where: NO_TABLE },
      { field: "Job it does", where: NO_TABLE },
      { field: "Price", where: NO_TABLE },
    ]);
    expect(p).toMatchObject({ productType: "Audio plugin", platform: "macOS + Windows (VST3, AU)", buyer: "", job: "", price: "" });
  });
  it("padded and CRLF specs give the same profile as compact ones", () => {
    for (const s of [SPEC_EMPTY, SPEC_FILLED, SPEC_SPAN_ONLY, SPEC_TBD, SPEC_NO_TABLE]) {
      const base = profile(s);
      expect(profile(crlf(s))).toEqual(base);
      expect(profile(padTables(s))).toEqual(base);
      expect(profile(crlf(padTables(s)))).toEqual(base);
    }
  });
  it("only the 7 field labels are ever used, in field order", () => {
    for (const s of [SPEC_EMPTY, SPEC_FILLED, SPEC_SPAN_ONLY, SPEC_TBD, SPEC_NO_TABLE]) {
      const f = fields(profile(s));
      expect(f).toEqual(ALL_FIELDS.filter((x) => f.includes(x)));
    }
  });
});

describe("parseProfile details", () => {
  it("half-deleted examples count as empty", () => {
    const halfOpen = SPEC_SPAN_ONLY.replace(/<span class="nx-eg">e\.g\. \$29 one-time, \$5\/month, or free \+ in-game items<\/span>/, () => '<span class="nx-eg">e.g. $29 one-time');
    const orphan = SPEC_FILLED.replace("| Home-studio vocalists who record and mix their own songs |", "| e.g. who pays</span> |");
    expect(halfOpen).not.toBe(SPEC_SPAN_ONLY);
    expect(orphan).not.toBe(SPEC_FILLED);
    expect(profile(halfOpen).price).toBe("");
    expect(fields(profile(halfOpen))).toContain("Price");
    expect(profile(orphan).buyer).toBe("e.g. who pays");
    expect(fields(profile(orphan))).toEqual(["Who buys it"]);
  });
  it("an example-only pitch, product type or mechanic is missing", () => {
    const spec = SPEC_FILLED.replace(/^> .*$/m, '> <span class="nx-eg">e.g. one line a stranger understands</span>')
      .replace(/^1\. .*$/m, '1. <span class="nx-eg">e.g. one knob</span>')
      .replace(/^2\. .*$/m, "2. TBD")
      .replace(/^3\. .*$/m, "3. ");
    const p = parseProfile(spec, { ...frontmatterOf(spec), product_type: "___" }, HUB_FM);
    expect(fields(p)).toEqual(["Product type", "One-line pitch", "Core mechanic"]);
    expect(p.pitch).toBe("");
    expect(p.productType).toBe("___");
    expect(p.mechanics).toEqual([]);
  });
  it("mechanics: plain text, 1) style counts, placeholders are left out", () => {
    const spec = SPEC_FILLED.replace(/^1\. .*$/m, "1) [[Knob]] sets the `amount`").replace(/^2\. .*$/m, "2. TBD");
    expect(profile(spec).mechanics).toEqual(["Knob sets the amount", "Before/after button to compare in one click"]);
    expect(profile(spec).complete).toBe(true);
  });
  it("a table under the pitch without the 3 rows counts as no table; a missing row keeps the table hint", () => {
    const other = SPEC_FILLED.replace("| Who buys it |", "| Audience |").replace("| Job it does |", "| Goal |").replace("| Price |", "| Cost |");
    expect(profile(other).missing.map((m) => m.where)).toEqual([NO_TABLE, NO_TABLE, NO_TABLE]);
    const twoRows = SPEC_FILLED.replace("| Price | $29 one-time |\n", "");
    expect(twoRows).not.toBe(SPEC_FILLED);
    expect(profile(twoRows).missing).toEqual([{ field: "Price", where: TABLE }]);
  });
  it("labels match by prefix in any case, and other header names fall back to columns 1 and 2", () => {
    const spec = SPEC_FILLED.replace("| Item | Value |\n|---|---|\n| Who buys it |", "| Field | Answer |\n|---|---|\n| WHO BUYS IT (in their words) |");
    expect(spec).not.toBe(SPEC_FILLED);
    expect(profile(spec).buyer).toBe("Home-studio vocalists who record and mix their own songs");
    expect(profile(spec).complete).toBe(true);
  });
  it("category is the hub's category link title, context only", () => {
    expect(profile(SPEC_FILLED, { category: "[[04_Company_Ops/Categories/Games]]" }).category).toBe("Games");
    expect(profile(SPEC_FILLED, { category: "Games" }).category).toBe("");
    expect(profile(SPEC_FILLED, {}).category).toBe("");
    expect(profile(SPEC_FILLED, {}).complete).toBe(true);
  });
  it("no spec at all: everything is missing and the table hint says to paste it", () => {
    const p = parseProfile("", {}, {});
    expect(fields(p)).toEqual(ALL_FIELDS);
    expect(p.missing.filter((m) => m.where === NO_TABLE).map((m) => m.field)).toEqual(["Who buys it", "Job it does", "Price"]);
  });
  it("product type reads list and number properties as text", () => {
    expect(parseProfile(SPEC_FILLED, { product_type: ["Audio plugin", "VST3"] }, {}).productType).toBe("Audio plugin, VST3");
    expect(parseProfile(SPEC_FILLED, { product_type: null }, {}).missing.map((m) => m.field)).toEqual(["Product type"]);
  });
  it("PROFILE_EXAMPLES are the Dev Spec template's examples", () => {
    expect(SPEC_SPAN_ONLY).toContain(PROFILE_EXAMPLES.buyer);
    expect(SPEC_SPAN_ONLY).toContain(PROFILE_EXAMPLES.job);
    expect(SPEC_SPAN_ONLY).toContain(PROFILE_EXAMPLES.price);
  });
});

describe("parsePrice", () => {
  const cases: [string, ProductProfile["priceParsed"]][] = [
    ["$29 one-time", { amount: 29, currency: "USD", model: "one-time" }],
    ["$9/mo", { amount: 9, currency: "USD", model: "subscription" }],
    ["$5/month", { amount: 5, currency: "USD", model: "subscription" }],
    ["$49/year", { amount: 49, currency: "USD", model: "subscription" }],
    ["free + in-game items", { amount: 0, currency: "USD", model: "in-game" }],
    ["free + Robux items", { amount: 0, currency: "USD", model: "in-game" }],
    ["free", { amount: 0, currency: "USD", model: "free" }],
    ["Free", { amount: 0, currency: "USD", model: "free" }],
    ["$0", { amount: 0, currency: "USD", model: "free" }],
    ["€29", { amount: 29, currency: "EUR", model: "unknown" }],
    ["€19", { amount: 19, currency: "EUR", model: "unknown" }],
    ["£29", { amount: 29, currency: "GBP", model: "unknown" }],
    ["29 USD", { amount: 29, currency: "USD", model: "unknown" }],
    ["pay what you want", { amount: null, currency: "", model: "unknown" }],
    ["", { amount: null, currency: "", model: "unknown" }],
    ["TBD", { amount: null, currency: "", model: "unknown" }],
  ];
  it.each(cases)("%j", (s, expected) => {
    expect(parsePrice(s)).toEqual(expected);
  });
  it("more ways people write a price", () => {
    expect(parsePrice("€29 one-time")).toEqual({ amount: 29, currency: "EUR", model: "one-time" });
    expect(parsePrice("£4.99 per month")).toEqual({ amount: 4.99, currency: "GBP", model: "subscription" });
    expect(parsePrice("$1,299.50 lifetime")).toEqual({ amount: 1299.5, currency: "USD", model: "one-time" });
    expect(parsePrice("29,99 € once")).toEqual({ amount: 29.99, currency: "EUR", model: "one-time" });
    expect(parsePrice("CA$39 one-time")).toEqual({ amount: 39, currency: "CAD", model: "one-time" });
    expect(parsePrice("A$15/month")).toEqual({ amount: 15, currency: "AUD", model: "subscription" });
    expect(parsePrice("US$29")).toEqual({ amount: 29, currency: "USD", model: "unknown" });
    expect(parsePrice("Free-to-play with game passes")).toEqual({ amount: 0, currency: "USD", model: "in-game" });
    expect(parsePrice("Free trial, then $12/mo")).toEqual({ amount: 12, currency: "USD", model: "subscription" });
    expect(parsePrice("$29")).toEqual({ amount: 29, currency: "USD", model: "unknown" });
  });
  it("strips green examples and link syntax first", () => {
    expect(parsePrice('<span class="nx-eg">e.g. $29 one-time, $5/month, or free + in-game items</span>')).toEqual({ amount: null, currency: "", model: "unknown" });
    expect(parsePrice('<span class="nx-eg">e.g. $29 one-time')).toEqual({ amount: null, currency: "", model: "unknown" });
    expect(parsePrice("[$29 one-time](https://example.com/buy)")).toEqual({ amount: 29, currency: "USD", model: "one-time" });
  });
});

// ---------------------------------------------------------------------------------------------------
// Regression tests for the 0.5.0 review findings
// ---------------------------------------------------------------------------------------------------

describe("the pitch line", () => {
  const PITCH_LINE = "> A one-knob de-esser that tames harsh S sounds in home-studio vocals.";

  it("a bare '>' never reads the line under it", () => {
    const bare = SPEC_FILLED.replace(`${PITCH_LINE}\n\n`, ">\n");
    expect(bare).toContain("## 1. One-line pitch\n>\n| Item | Value |");
    expect(profile(bare).pitch).toBe("");
    expect(fields(profile(bare))).toEqual(["One-line pitch"]);
    expect(profile(crlf(bare)).pitch).toBe("");
    const emptyBare = SPEC_EMPTY.replace("## 1. One-line pitch\n> \n\n", "## 1. One-line pitch\n>\n");
    expect(emptyBare).not.toBe(SPEC_EMPTY);
    expect(fields(profile(emptyBare))).toEqual(ALL_FIELDS);
  });
  it("an empty quote line above the pitch is skipped, without a stray '>'", () => {
    const spaced = SPEC_FILLED.replace(PITCH_LINE, `>\n${PITCH_LINE}`);
    expect(profile(spaced).pitch).toBe("A one-knob de-esser that tames harsh S sounds in home-studio vocals.");
    expect(profile(spaced).complete).toBe(true);
  });
});

describe("parsePrice reads the price, not other numbers", () => {
  it("F2P is free, and numbers inside words or trial lengths aren't the price", () => {
    expect(parsePrice("F2P")).toEqual({ amount: 0, currency: "USD", model: "free" });
    expect(parsePrice("7-day free trial, then $5/month")).toEqual({ amount: 5, currency: "USD", model: "subscription" });
    expect(parsePrice("VST3 plugin, $29 one-time")).toEqual({ amount: 29, currency: "USD", model: "one-time" });
    expect(parsePrice("Free for 30 days, then $9/mo")).toEqual({ amount: 9, currency: "USD", model: "subscription" });
    expect(parsePrice("VST3 plugin, 29 one-time")).toEqual({ amount: 29, currency: "USD", model: "one-time" });
    expect(parsePrice("14-day trial, 49 EUR lifetime")).toEqual({ amount: 49, currency: "EUR", model: "one-time" });
  });
});

describe("what a Fill in sheet needs to write back exactly", () => {
  it("the profile table's own header texts and the section keys", () => {
    expect(profile(SPEC_FILLED).profileColumns).toEqual({ label: "Item", value: "Value" });
    const renamed = SPEC_FILLED.replace("| Item | Value |\n|---|---|\n| Who buys it |", "| Field | Answer |\n|---|---|\n| Who buys it |");
    expect(renamed).not.toBe(SPEC_FILLED);
    const p = profile(renamed);
    expect(p.profileColumns).toEqual({ label: "Field", value: "Answer" });
    const r = applyTableOp(renamed, {
      kind: "set",
      heading: SPEC_SECTIONS.pitch,
      edits: [{ row: { key: "Price", col: p.profileColumns!.label }, values: { [p.profileColumns!.value]: "$39 one-time" }, expect: { [p.profileColumns!.value]: p.price } }],
    });
    expect(profile(r.text).price).toBe("$39 one-time");
    expect(profile(SPEC_NO_TABLE).profileColumns).toBeNull();
    for (const key of [SPEC_SECTIONS.pitch, SPEC_SECTIONS.tech]) expect(tableIn(SPEC_FILLED, key), key).not.toBeNull();
    expect(section(SPEC_FILLED, SPEC_SECTIONS.mechanics)).toContain("1. One knob");
  });
});
