// The product profile competitor research needs: 7 required fields read from the Dev Spec, and where
// each missing one goes. Pure: no Obsidian, no clock. Green examples never count as filled.

import { cell, col, isPlaceholder, parseLink, plainText, section, str, Table, tableIn } from "./markdown";
import { SPEC_SECTIONS } from "./noteFormat";
import { findRows } from "./tableEdit";

// The template's examples and the section keys live in noteFormat.ts (tableEdit uses them too).
export { PROFILE_EXAMPLES, SPEC_SECTIONS } from "./noteFormat";

export interface ProductProfile {
  /** Dev Spec property product_type. */
  productType: string;
  /** The first "> " line under the pitch heading, as plain text. */
  pitch: string;
  /** "Who buys it" row of the Item | Value table under the pitch, as typed (examples stripped). */
  buyer: string;
  /** "Job it does" row of the same table. */
  job: string;
  /** "Price" row of the same table, as typed. */
  price: string;
  priceParsed: { amount: number | null; currency: string; model: "one-time" | "subscription" | "free" | "in-game" | "unknown" };
  /** Tech preset → Target platforms. */
  platform: string;
  /** Tech preset → Distribution / store. Context only, never required. */
  store: string;
  /** Numbered items under Core mechanics, as plain text. Placeholders (empty, TBD, examples) are left out. */
  mechanics: string[];
  /** Title of the hub's category link ("Audio Tools"), or "". Context only, never required. */
  category: string;
  /**
   * The header texts of the Item | Value table under the pitch (its label and value columns), so a Fill in sheet's
   * edit op names the columns the note really has. Null when there's no profile table.
   */
  profileColumns: { label: string; value: string } | null;
  /**
   * Set when the profile table is there but some of its 3 lines aren't (a partner deleted the Price line): which
   * ones. A Fill in save adds such a line instead of editing it.
   */
  absent?: Array<"buyer" | "job" | "price">;
  /** The required fields that aren't filled yet, in field order, with where each one goes in plain words. */
  missing: { field: string; where: string }[];
  /** All 7 required fields are filled. */
  complete: boolean;
}

export type PriceModel = ProductProfile["priceParsed"]["model"];

/** Where each missing field goes, in plain words. */
const WHERE = {
  type: "Dev Spec → Product type (in the properties at the top)",
  pitch: "Dev Spec → 1. One-line pitch (the quote line under the heading)",
  table: "Dev Spec → 1. One-line pitch (the lines under the pitch)",
  noTable: "Dev Spec → 1. One-line pitch (paste the 3 lines from the Dev Spec template)",
  platforms: "Dev Spec → 4. Tech preset → Target platforms",
  mechanic: "Dev Spec → 2. Core mechanics (at least 1 numbered item)",
};

/** The 3 rows of the Item | Value table under the pitch, matched by their label (exactly, else by its start). */
const PROFILE_ROWS = [
  { key: "buyer", field: "Who buys it", prefix: "who buys" },
  { key: "job", field: "Job it does", prefix: "job" },
  { key: "price", field: "Price", prefix: "price" },
] as const;

/** The label and value columns of an Item | Value table: by header name, else the first two columns. */
function kvColumns(t: Table): { label: number; value: number } {
  const label = col(t, "item");
  const value = col(t, "value");
  return { label: label === -1 ? 0 : label, value: value === -1 ? 1 : value };
}

/**
 * Value of the Item | Value row whose label is `prefix`, else the first whose label starts with it (any case), or
 * null when no row matches: the rows an edit op finds (findRows), so a Fill in sheet shows the line its save writes.
 */
function rowValue(t: Table | null, prefix: string): string | null {
  if (!t) return null;
  const c = kvColumns(t);
  const at = findRows(t.rows.map((r) => r[c.label] ?? ""), prefix)[0];
  return at === undefined ? null : cell(t.rows[at], c.value);
}

/**
 * The pitch: the first quote line under the pitch heading that has text. A bare ">" never reads the line
 * below it, and an empty quote line above the pitch is skipped.
 */
function pitchLine(pitchSection: string): string {
  for (const line of pitchSection.split("\n")) {
    const text = plainText(/^[ \t]*>[ \t]?(.*)$/.exec(line)?.[1] ?? "");
    if (text !== "") return text;
  }
  return "";
}

/**
 * The product profile from the Dev Spec (body and properties) and the hub's properties.
 * A field is missing when its value is a placeholder (empty, TBD, ___, an example, …).
 */
export function parseProfile(specBody: string, specFm: Record<string, unknown>, hubFm: Record<string, unknown>): ProductProfile {
  const missing: ProductProfile["missing"] = [];
  const need = (field: string, value: string, where: string): string => {
    if (isPlaceholder(value)) missing.push({ field, where });
    return value;
  };

  const productType = need("Product type", str(specFm.product_type), WHERE.type);
  const pitch = need("One-line pitch", pitchLine(section(specBody, SPEC_SECTIONS.pitch) ?? ""), WHERE.pitch);

  // A pitch table without any of the 3 rows counts as no table (it's some other table).
  const table = tableIn(specBody, SPEC_SECTIONS.pitch);
  const hasRows = PROFILE_ROWS.some((r) => rowValue(table, r.prefix) !== null);
  const [buyer, job, price] = PROFILE_ROWS.map((r) =>
    need(r.field, (hasRows ? rowValue(table, r.prefix) : null) ?? "", hasRows ? WHERE.table : WHERE.noTable),
  );

  const tech = tableIn(specBody, SPEC_SECTIONS.tech);
  const platform = need("Target platforms", rowValue(tech, "target platform") ?? "", WHERE.platforms);

  const mechanics = (section(specBody, SPEC_SECTIONS.mechanics) ?? "")
    .split("\n")
    .map((l) => /^\s*\d+[.)]\s*(.*)$/.exec(l)?.[1] ?? "")
    .map(plainText)
    .filter((m) => !isPlaceholder(m));
  if (mechanics.length === 0) missing.push({ field: "Core mechanic", where: WHERE.mechanic });

  const absent = hasRows ? PROFILE_ROWS.filter((r) => rowValue(table, r.prefix) === null).map((r) => r.key) : [];

  return {
    productType,
    pitch,
    buyer,
    job,
    price,
    priceParsed: parsePrice(price),
    platform,
    store: rowValue(tech, "distribution") ?? "",
    mechanics,
    category: parseLink(hubFm.category)?.title ?? "",
    profileColumns: table && hasRows ? columnNames(table) : null,
    ...(absent.length ? { absent } : {}),
    missing,
    complete: missing.length === 0,
  };
}

/** The header texts of a table's label and value columns. */
function columnNames(t: Table): { label: string; value: string } {
  const c = kvColumns(t);
  return { label: t.headers[c.label] ?? "", value: t.headers[c.value] ?? "" };
}

/** "CA$", "A$" and the 3-letter codes are checked before the plain symbols. */
function currencyOf(text: string): string {
  const t = text.toUpperCase();
  const code = /\b(USD|EUR|GBP|CAD|AUD|JPY|CHF)\b/.exec(t);
  if (code) return code[1];
  if (/(^|[^A-Z])CA?\$/.test(t)) return "CAD";
  if (/(^|[^A-Z])AU?\$/.test(t)) return "AUD";
  if (t.includes("$")) return "USD";
  if (t.includes("€")) return "EUR";
  if (t.includes("£")) return "GBP";
  if (t.includes("¥")) return "JPY";
  return "";
}

const NUMBER = String.raw`\d+(?:[.,]\d+)*`;
const CODES = "USD|EUR|GBP|CAD|AUD|JPY|CHF";
/** A number next to a currency: "$29", "€ 19", "29 USD", "29,99 €". */
const PRICED = new RegExp(String.raw`(?:[$€£¥]|\b(?:${CODES})\b)\s*(${NUMBER})|(${NUMBER})\s*(?:[$€£¥]|(?:${CODES})\b)`, "i");
/** A number on its own: not part of a word (VST3, F2P) and not a trial length ("7-day", "30 days"). */
const BARE = new RegExp(String.raw`(?:^|[^\w.,])(${NUMBER})(?!\w|\s*-?\s*days?\b)`, "i");

/**
 * The price in the text: the first number next to a currency, else the first number on its own. "1,299.50" and
 * "29,99": a last separator followed by 1–2 digits is the decimal point.
 */
function amountOf(text: string): number | null {
  const priced = PRICED.exec(text);
  const s = priced ? priced[1] ?? priced[2] : BARE.exec(text)?.[1];
  if (s === undefined) return null;
  const last = Math.max(s.lastIndexOf("."), s.lastIndexOf(","));
  const digits = last !== -1 && s.length - last - 1 <= 2 ? `${s.slice(0, last).replace(/[.,]/g, "")}.${s.slice(last + 1)}` : s.replace(/[.,]/g, "");
  const n = Number(digits);
  return Number.isFinite(n) ? n : null;
}

const SUBSCRIPTION = /\/\s*(mo|month|yr|year|wk|week)\b|\b(per|a|each)\s+(month|year|week)\b|\b(monthly|yearly|annual|annually|weekly|subscription)\b/;
const FREE = /\bfree\b|\bf2p\b/;
const IN_GAME = /\bin[- ]?(game|app)\b|\brobux\b|\bmicro-?transactions?\b|\bitems?\b|\bgame ?pass(es)?\b/;
const ONE_TIME = /\bone[- ]?(time|off)\b|\bonce\b|\blifetime\b|\bperpetual\b/;

/**
 * Reads a typed price. "$29 one-time" → 29 USD one-time; "$9/mo", "$5/month", "$49/year" → subscription;
 * "free + in-game items" → in-game, 0; "free" or "$0" → free, 0; "€29" → EUR. A price with no "how it's paid"
 * word ("€29", "29 USD") keeps its amount with model "unknown". No number and no known model → unknown, null.
 * The currency is USD when an amount has no currency of its own, and "" when there's no amount.
 */
export function parsePrice(s: string): ProductProfile["priceParsed"] {
  const text = plainText(s);
  const low = text.toLowerCase();
  let amount = amountOf(text);
  let model: PriceModel = "unknown";
  if (SUBSCRIPTION.test(low)) model = "subscription";
  else if (FREE.test(low) && IN_GAME.test(low)) model = "in-game";
  else if ((FREE.test(low) && !amount) || amount === 0) model = "free";
  else if (ONE_TIME.test(low)) model = "one-time";
  if (model === "in-game" || model === "free") amount = 0;
  return { amount, currency: currencyOf(text) || (amount === null ? "" : "USD"), model };
}
