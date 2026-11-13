// The Developer's product profile line: whether competitor research has the 7 facts it needs, where each missing
// one goes, and a Fill in sheet for the 3 rows under the Dev Spec's pitch (Who buys it, Job it does, Price). The
// other 4 facts live elsewhere in the Dev Spec (its properties, the pitch, Core mechanics, Tech preset), so they get
// an Open Dev Spec button instead of a box. Writes go through saveEach: one profileOp per changed field (U1).

import { isPlaceholder } from "../data/markdown";
import { formValue, profileOp } from "../data/marketingOps";
import { parsePrice, PROFILE_EXAMPLES, SPEC_SECTIONS } from "../data/profile";
import type { ProductProfile } from "../data/profile";
import { DOC_FILES } from "../data/types";
import type { ProductSnapshot } from "../data/types";
import type { Ctx } from "./app";
import { sectionHead } from "./components";
import { h } from "./dom";
import { latestProduct, openNoteButton, readOnlyLine, saveEach, sheetOpener } from "./editors";
import { editSheet } from "./inline";
import type { FieldSpec } from "./inline";

/** All the facts research needs (ProductProfile's 7 required fields). */
const FACTS = 7;

/** The 3 lines under the pitch, as ProductProfile names them in `missing`. */
const TABLE_FIELDS = [
  { key: "buyer", field: "Who buys it" },
  { key: "job", field: "Job it does" },
  { key: "price", field: "Price" },
] as const;

const isTableField = (field: string): boolean => TABLE_FIELDS.some((f) => f.field === field);

/** Where Open Dev Spec jumps for each other fact (undefined: the top of the note, where the properties are). */
const OPEN_AT: Record<string, string | undefined> = {
  "Product type": undefined,
  "One-line pitch": SPEC_SECTIONS.pitch,
  "Target platforms": SPEC_SECTIONS.tech,
  "Core mechanic": SPEC_SECTIONS.mechanics,
};

/** A profile value the way the edit form shows it (line breaks and | as typed). */
const form = (v: string): string => formValue({ value: v, raw: v, example: "", col: "" });

const PERIODS: Array<[RegExp, string]> = [
  [/\/\s*(?:mo|month)\b|\b(?:per|a|each)\s+month\b|\bmonthly\b/i, "a month"],
  [/\/\s*(?:yr|year)\b|\b(?:per|a|each)\s+year\b|\b(?:yearly|annual|annually)\b/i, "a year"],
  [/\/\s*(?:wk|week)\b|\b(?:per|a|each)\s+week\b|\bweekly\b/i, "a week"],
];

/** $29, €19, CA$12.50: the amount in its own currency. */
function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD", minimumFractionDigits: amount % 1 ? 2 : 0, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${amount} ${currency}`.trim();
  }
}

/** What parsePrice understood from a typed price, in plain words: "Reads as $29 one-time", "Reads as $5 a month". */
export function priceReading(typed: string): string {
  if (isPlaceholder(typed)) return "Write it the way a buyer sees it, like $29 one-time or $5/month.";
  const { amount, currency, model } = parsePrice(typed);
  const price = amount === null ? null : money(amount, currency);
  switch (model) {
    case "one-time":
      return price ? `Reads as ${price} one-time` : "Reads as one-time. Add the amount, like $29 one-time.";
    case "subscription": {
      const period = PERIODS.find(([re]) => re.test(typed))?.[1];
      if (!price) return "Reads as a subscription. Add the amount, like $5/month.";
      return period ? `Reads as ${price} ${period}` : `Reads as a ${price} subscription`;
    }
    case "free":
      return "Reads as free";
    case "in-game":
      return "Reads as free + in-game items";
    default:
      return price ? `Reads as ${price}. Add how it's paid: one-time, /month, or free + in-game items.` : "Can't read a price yet. Write it like $29 one-time.";
  }
}

/**
 * The Fill in sheet: Who buys it, Job it does and Price, each changed one saved through its own profileOp. A line the
 * list doesn't have yet is added to it (profileOp), so every box can be saved.
 */
function profileSheet(ctx: Ctx, p: ProductSnapshot, profile: ProductProfile): void {
  // The profile as the sheet last read it: which lines the list has, and its column names, for the save.
  let shown = profile;
  // The hint follows the box as you type: the price check runs on every keystroke and only rewrites it.
  const priceHint = h("span", null, priceReading(profile.price));
  const fields: FieldSpec[] = [
    { key: "buyer", label: "Who buys it", kind: "text", value: form(profile.buyer), example: PROFILE_EXAMPLES.buyer },
    { key: "job", label: "Job it does", kind: "text", value: form(profile.job), example: PROFILE_EXAMPLES.job },
    {
      key: "price",
      label: "Price",
      kind: "text",
      value: form(profile.price),
      example: PROFILE_EXAMPLES.price,
      hint: priceHint,
      check: (v) => {
        const text = priceReading(v);
        if (priceHint.textContent !== text) priceHint.textContent = text;
        return null;
      },
    },
  ];
  editSheet(ctx, {
    title: "Product profile",
    intro: "Competitor research uses these to find products that really compete with this one.",
    fields,
    save: async (values, changed, seen) =>
      saveEach(
        ctx,
        p,
        "spec",
        TABLE_FIELDS.filter((f) => changed.includes(f.key)).map((f) => ({
          label: f.field,
          // Expects what the user saw (U2): seen holds every box, the partner's text after Keep mine.
          op: () => profileOp(shown, f.key, values[f.key], seen[f.key]),
        })),
      ),
    current: () => {
      const now = latestProduct(ctx, p)?.profile;
      if (!now?.profileColumns) return null;
      shown = now;
      return { buyer: form(now.buyer), job: form(now.job), price: form(now.price) };
    },
  });
}

/**
 * The profile line for the Developer side (#nx-sec-profile): "Ready for competitor research ✓", or "Missing for
 * research: Who buys it, Price" with where each missing fact goes. Fill in edits the 3 rows under the pitch; the
 * other facts get an Open Dev Spec button. Read-only for a queued or archived product (U8).
 */
export function profileLine(ctx: Ctx, p: ProductSnapshot): HTMLElement {
  const profile = p.profile;
  const locked = readOnlyLine(p.status);
  const missing = profile.missing;
  const filled = Math.max(0, FACTS - missing.length);
  const root = h(
    "section",
    { class: "nx-section nx-ed-section nx-prof", id: "nx-sec-profile", "aria-label": "Product profile" },
    sectionHead(ctx, "profile", undefined, h("strong", null, `${filled} of ${FACTS} filled in`)),
  );
  if (!p.paths.spec) {
    root.append(h("p", { class: "nx-ed-locked" }, `${p.displayName} has no Dev Spec note (${DOC_FILES.spec}).`));
    return root;
  }
  if (locked) root.append(h("p", { class: "nx-ed-locked" }, locked));

  const hasTable = profile.profileColumns !== null;
  const tableMissing = missing.some((m) => isTableField(m.field));
  const fill =
    locked || !hasTable
      ? null
      : sheetOpener(tableMissing ? "Fill in" : "Edit", () => profileSheet(ctx, p, profile), {
          name: tableMissing ? "Fill in the product profile" : "Edit the product profile",
          id: `ed:profile:${p.name}`,
          variant: tableMissing ? "primary" : "quiet",
        });
  const status = profile.complete ? "Ready for competitor research ✓" : `Missing for research: ${missing.map((m) => m.field).join(", ")}`;
  root.append(h("div", { class: ["nx-prof-line", profile.complete && "is-ready"] }, h("p", { class: "nx-prof-status" }, status), fill));

  if (!hasTable) {
    root.append(
      h(
        "p",
        { class: "nx-prof-paste" },
        h("span", null, "Paste the 3 lines from the Dev Spec template (Who buys it, Job it does, Price) under the pitch."),
        locked ? null : openNoteButton(ctx, p, "spec", "Open Dev Spec →", SPEC_SECTIONS.pitch, "Open Dev Spec at the pitch"),
      ),
    );
  }

  // Without the table, the paste line above covers its 3 rows.
  const items = missing.filter((m) => hasTable || !isTableField(m.field));
  if (items.length) {
    root.append(
      h(
        "ul",
        { class: "nx-prof-list" },
        items.map((m) =>
          h(
            "li",
            { class: "nx-prof-item" },
            h("span", { class: "nx-prof-field" }, m.field),
            h("span", { class: "nx-prof-where" }, m.where),
            locked || isTableField(m.field) ? null : openNoteButton(ctx, p, "spec", "Open Dev Spec →", OPEN_AT[m.field], `Open Dev Spec to fill in ${m.field}`),
          ),
        ),
      ),
    );
  }
  return root;
}
