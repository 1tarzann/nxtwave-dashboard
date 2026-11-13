// The Marketing Engine note (2_Marketing_Engine) as data: competitors, hooks (the old 3-hook layout or 10 rated
// hooks), the video backlog, brand kit, paid test plan, the hidden research markers and the "How these 3 were
// picked" callout. Pure: no Obsidian, no clock. Tables are found by heading and columns by header name, so
// padded and compact tables, and LF and CRLF notes, read the same.

import { normalizeDate } from "./dates";
import { cell, col, exampleIn, isPlaceholder, parseTable, plainText, section, SEPARATOR, stripExamples, Table, tableIn } from "./markdown";
import { GENERIC_EXAMPLES, labelExample, MARKETING_SECTIONS, ratingColumn, ratingOf } from "./noteFormat";
import type { HookRating } from "./noteFormat";
import { findRows, readMarker } from "./tableEdit";

// The template's examples, the section keys and the rating rule live in noteFormat.ts (tableEdit uses them too).
export { GENERIC_EXAMPLES, MARKETING_SECTIONS, RATING_LABEL, ratingOf } from "./noteFormat";
export type { HookRating } from "./noteFormat";

export type BacklogStatus = "scripted" | "recorded" | "edited" | "scheduled" | "";

/** One table cell. */
export interface Cell {
  /** The typed text (cell(): examples stripped, trimmed). "" when the cell only holds an example. */
  value: string;
  /** The cell as written, examples and link syntax kept (trimmed, like every parsed cell). */
  raw: string;
  /**
   * Green hint text: the cell's own example, else the first example in its column, else the template's
   * (GENERIC_EXAMPLES), else "". Brand kit and paid test rows skip the column step. A column the table lacks has none.
   */
  example: string;
  /**
   * The header of the column it was read from, exactly as the note has it ("" when the table has no such column).
   * Edit ops take it as their column key, so a renamed header still works.
   */
  col: string;
}

export interface CompetitorRow {
  /** Data-row index in the table (the RowRef index tableEdit uses). */
  index: number;
  name: Cell;
  link: Cell;
  hook: Cell;
  why: Cell;
  /** The reason after "MISSING:" when research couldn't fill this slot, else null. */
  missing: string | null;
}

export interface HookRow {
  index: number;
  /** The "#" cell, e.g. "3". */
  num: string;
  /** "" in old v1 notes (no Rating column) and for rows not rated yet. */
  rating: HookRating;
  /** The Rating cell as written ("Medium", "🟡 Medium", "TBD"), so a save can expect exactly what the note holds. */
  ratingCell: Cell;
  hook: Cell;
  demo: Cell;
  cta: Cell;
  basedOn: Cell;
  /** The reason after "MISSING:" when research found too little evidence for this slot, else null. */
  missing: string | null;
  /** Set (true) when another row has the same #: edits then find this row by its place, never by its number. */
  repeated?: true;
}

export interface BacklogRow {
  index: number;
  num: string;
  format: Cell;
  /** Canonical names from the Platform(s) cell (see platformsOf). */
  platforms: string[];
  platformsCell: Cell;
  /** The Hook # cell as typed, e.g. "2" ("" when it only holds an example). */
  hookNum: string;
  /** The first of scheduled / edited / recorded / scripted in the Status cell (the snapshot counts' precedence). */
  status: BacklogStatus;
  /** The Status cell itself, so counts can keep today's rule (a row counts when Format or Status has text). */
  statusCell: Cell;
  goLive: Cell;
  /** Set (true) when another row has the same #: edits then find this row by its place, never by its number. */
  repeated?: true;
  /** Set (true) when a column the dashboard doesn't show (a partner's "Notes") holds text, so the row isn't free. */
  extra?: true;
}

/** One row of a two-column table (brand kit, paid test plan). */
export interface KvRow {
  index: number;
  /** The label cell (Asset / Item) as typed: "Logo", "Budget (max $300 per sprint)". "" for a row without one. */
  label: string;
  value: Cell;
  /** Set (true) when another row has the same label (any case): edits then find this row by its place. */
  repeated?: true;
}

export interface MarketingNote {
  competitors: CompetitorRow[] | null;
  /** "v2" when the table has a Rating column (10 rated hooks), "v1" for the old 3-hook layout. */
  hooks: { layout: "v1" | "v2"; rows: HookRow[] } | null;
  backlog: BacklogRow[] | null;
  brandKit: KvRow[] | null;
  paidTest: KvRow[] | null;
  /** <!-- nx-research: … --> written by /competitors. Null when missing or without a valid date. */
  research: { date: string; checked: number | null; kept: number | null; rounds: number | null; sources: string[] } | null;
  /** <!-- nx-research-request: … --> written by Ask for research. Null when missing or without a valid date. */
  request: { date: string; by: string } | null;
  /** <!-- nx-reviewed: … --> written by Looks good: the date each part was last reviewed. */
  reviewed: { competitors: string | null; hooks: string | null };
  /** The "How these 3 were picked" callout under section 1: its date, its text lines (prefix "> " removed, examples and bold stripped, links kept) and the table inside it. */
  picked: { date: string | null; lines: string[]; table: Table | null } | null;
  /**
   * Each D4 marker's attributes exactly as readMarker() reads them (null = no marker), so a marker op's `expect`
   * is what the note holds, even with attributes this version doesn't know.
   */
  markers: { research: Record<string, string> | null; request: Record<string, string> | null; reviewed: Record<string, string> | null };
}

const PLATFORM_NAMES: [RegExp, string][] = [
  [/tik\s*tok/i, "TikTok"],
  [/\breels?\b|\binstagram\b|^ig$/i, "Reels"],
  [/\bshorts?\b|\byou\s*tube\b|^yt$/i, "Shorts"],
  [/^x$|^x\s*\(|\btwitter\b|\bx\.com\b/i, "X"],
];

/**
 * "TikTok, Reels, Shorts, X" → ["TikTok", "Reels", "Shorts", "X"]. Splits on , ; / + & · and "and".
 * "Instagram Reels" → Reels, "YouTube" → Shorts, "Twitter" → X. Unknown names are kept as written; repeats,
 * placeholders (TBD, —) and example text are dropped.
 */
export function platformsOf(s: string): string[] {
  const text = plainText(s);
  if (isPlaceholder(text)) return [];
  const out: string[] = [];
  for (const part of text.split(/[,;/+&·]|\band\b/i)) {
    const token = part.trim();
    if (isPlaceholder(token)) continue;
    const name = PLATFORM_NAMES.find(([re]) => re.test(token))?.[1] ?? token;
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

const STATUSES: BacklogStatus[] = ["scheduled", "edited", "recorded", "scripted"];

/** First of scheduled / edited / recorded / scripted found in the text (any case), else "". */
function statusOf(v: string): BacklogStatus {
  const s = v.toLowerCase();
  return STATUSES.find((k) => s.includes(k)) ?? "";
}

/** The reason after "MISSING:", or null. */
function missingOf(v: string): string | null {
  return v.startsWith("MISSING:") ? v.slice("MISSING:".length).trim() : null;
}

/** The first example in column `c` among `rows`, or "". */
function firstExample(rows: string[][], c: number): string {
  if (c < 0) return "";
  for (const r of rows) {
    const e = exampleIn(r[c] ?? "");
    if (e) return e;
  }
  return "";
}

/** For each column: the first example in it among `rows`, else the generic one. */
function columnHints<K extends string>(rows: string[][], cols: Record<K, number>, generic: Record<K, string>): Record<K, string> {
  const out = {} as Record<K, string>;
  for (const k of Object.keys(cols) as K[]) out[k] = firstExample(rows, cols[k]) || generic[k];
  return out;
}

/** { repeated: true } when another of `keys` names the same row the way tableEdit finds rows (findRows), else {}. */
function repeatedAt(keys: string[], i: number): { repeated?: true } {
  return keys[i] !== "" && findRows(keys, keys[i]).length > 1 ? { repeated: true } : {};
}

/**
 * A backlog row someone filled in: one of its 5 cells besides # holds more than a placeholder, so a video made by
 * "Use in a video" counts at once. Rows holding only examples (the template's slot) aren't videos. The Videos
 * section, its counter and the quests all count v2 notes by this rule.
 */
export function isVideoRow(r: BacklogRow): boolean {
  return [r.format.value, r.platformsCell.value, r.hookNum, r.statusCell.value, r.goLive.value].some((v) => !isPlaceholder(v));
}

/**
 * Which backlog rows are videos, by the note's layout: in new notes (v2) isVideoRow; old notes (v1: no Rating
 * column) keep the rule they always had, a row whose Format or Status has any text. The Videos section, its counter
 * and the quests all use this one rule, so they always agree (a v1 video added by the dashboard is written as
 * scripted, so it counts at once).
 */
export function videoRule(m: MarketingNote | null | undefined): (r: BacklogRow) => boolean {
  if (m?.hooks?.layout === "v2") return isVideoRow;
  return (r) => r.format.value !== "" || r.statusCell.value !== "";
}

/** Old-layout notes (v1) count a video by its Format or Status, so a video the dashboard adds there gets a Status. */
export function isOldLayout(m: MarketingNote | null | undefined): boolean {
  return !!m && m.hooks?.layout !== "v2";
}

/** A cell of column `c`. A column the table doesn't have gives an empty cell with no example. */
function toCell(t: Table, row: string[], c: number, hint: string): Cell {
  if (c < 0) return { value: "", raw: "", example: "", col: "" };
  const raw = row[c] ?? "";
  return { value: cell(row, c), raw, example: exampleIn(raw) || hint, col: t.headers[c] ?? "" };
}

function parseCompetitors(body: string): CompetitorRow[] | null {
  const t = tableIn(body, MARKETING_SECTIONS.competitors);
  if (!t) return null;
  const c = { name: col(t, "competitor"), link: col(t, "link", "video"), hook: col(t, "hook"), why: col(t, "why") };
  const hint = columnHints(t.rows, c, GENERIC_EXAMPLES.competitors);
  return t.rows.map((r, index) => {
    const name = toCell(t, r, c.name, hint.name);
    return { index, name, link: toCell(t, r, c.link, hint.link), hook: toCell(t, r, c.hook, hint.hook), why: toCell(t, r, c.why, hint.why), missing: missingOf(name.value) };
  });
}

function parseHooks(body: string): MarketingNote["hooks"] {
  const t = tableIn(body, MARKETING_SECTIONS.hooks);
  if (!t) return null;
  // Only a header that is or starts with "Rating": "Demo shot (demonstrating it)" must not turn an old note into v2.
  const ratingCol = ratingColumn(t.headers);
  const numCol = col(t, "#");
  const c = { hook: col(t, "hook"), demo: col(t, "demo"), cta: col(t, "cta"), basedOn: col(t, "based on") };
  const ratings = t.rows.map((r) => ratingOf(cell(r, ratingCol)));
  const hintAvoid = columnHints(t.rows.filter((_, i) => ratings[i] === "avoid"), c, GENERIC_EXAMPLES.avoidHooks);
  const hintOther = columnHints(t.rows.filter((_, i) => ratings[i] !== "avoid"), c, GENERIC_EXAMPLES.hooks);
  const nums = t.rows.map((r) => cell(r, numCol));
  const rows = t.rows.map((r, index): HookRow => {
    const rating = ratings[index];
    const hint = rating === "avoid" ? hintAvoid : hintOther;
    const hook = toCell(t, r, c.hook, hint.hook);
    return {
      index,
      num: cell(r, numCol),
      rating,
      ratingCell: toCell(t, r, ratingCol, ""),
      hook,
      demo: toCell(t, r, c.demo, hint.demo),
      cta: toCell(t, r, c.cta, hint.cta),
      basedOn: toCell(t, r, c.basedOn, hint.basedOn),
      missing: missingOf(hook.value),
      ...repeatedAt(nums, index),
    };
  });
  return { layout: ratingCol === -1 ? "v1" : "v2", rows };
}

function parseBacklog(body: string): BacklogRow[] | null {
  const t = tableIn(body, MARKETING_SECTIONS.backlog);
  if (!t) return null;
  const numCol = col(t, "#");
  const c = { format: col(t, "format"), platforms: col(t, "platform"), hookNum: col(t, "hook"), status: col(t, "status"), goLive: col(t, "go-live", "go live", "date") };
  const hint = columnHints(t.rows, c, GENERIC_EXAMPLES.backlog);
  const nums = t.rows.map((r) => cell(r, numCol));
  // Columns the dashboard doesn't read, and the other "#" columns the insert op skips too.
  const known = new Set([numCol, ...Object.values(c)]);
  const unread = t.headers.flatMap((h, i) => (known.has(i) || h.trim() === "#" ? [] : [i]));
  return t.rows.map((r, index): BacklogRow => {
    const platformsCell = toCell(t, r, c.platforms, hint.platforms);
    const statusCell = toCell(t, r, c.status, hint.status);
    const extra = unread.some((i) => !isPlaceholder(r[i] ?? ""));
    return {
      index,
      num: cell(r, numCol),
      format: toCell(t, r, c.format, hint.format),
      platforms: platformsOf(platformsCell.value),
      platformsCell,
      hookNum: cell(r, c.hookNum),
      status: statusOf(statusCell.value),
      statusCell,
      goLive: toCell(t, r, c.goLive, hint.goLive),
      ...repeatedAt(nums, index),
      ...(extra ? { extra: true as const } : {}),
    };
  });
}

/** A two-column table. The brand kit's columns are found exactly as snapshot.ts always found them, so its counts can stay the same. */
function parseKv(body: string, heading: string, labelKeys: string[], valueKeys: string[], generic: Record<string, string>): KvRow[] | null {
  const t = tableIn(body, heading);
  if (!t) return null;
  const labelCol = col(t, ...labelKeys);
  const valueCol = col(t, ...valueKeys);
  const labels = t.rows.map((r) => cell(r, labelCol));
  return t.rows.map((r, index): KvRow => {
    const label = labels[index];
    return { index, label, value: toCell(t, r, valueCol, labelExample(generic, label)), ...repeatedAt(labels, index) };
  });
}

/** A whole number written in a marker, or null. */
function wholeNumber(v: string | undefined): number | null {
  return v !== undefined && /^\d+$/.test(v) ? Number(v) : null;
}

function parseResearch(body: string): MarketingNote["research"] {
  const m = readMarker(body, "nx-research");
  const date = normalizeDate(m?.date);
  if (!m || !date) return null;
  // D4 writes sources=a,b; competitor-scout has joined them with "+", so both read as a list.
  const sources = (m.sources ?? "").split(/[,+]/).map((s) => s.trim()).filter(Boolean);
  return { date, checked: wholeNumber(m.checked), kept: wholeNumber(m.kept), rounds: wholeNumber(m.rounds), sources };
}

function parseRequest(body: string): MarketingNote["request"] {
  const m = readMarker(body, "nx-research-request");
  const date = normalizeDate(m?.date);
  return m && date ? { date, by: m.by ?? "" } : null;
}

const PICKED_TITLE = /^\s*>\s*\[![^\]]*\][-+]?\s*how these\b.*\bpicked\b/i;

/** **bold** and __bold__ as plain text: the callout's lines are shown as text, links aside. */
const BOLD = /(\*\*|__)(.+?)\1/g;

/** The "> [!note]- How these 3 were picked (YYYY-MM-DD)" callout in section 1, or null. */
function parsePicked(body: string): MarketingNote["picked"] {
  const lines = (section(body, MARKETING_SECTIONS.competitors) ?? "").split("\n");
  const start = lines.findIndex((l) => PICKED_TITLE.test(l));
  if (start === -1) return null;
  const inner: string[] = [];
  for (let i = start + 1; i < lines.length && /^\s*>/.test(lines[i]); i++) inner.push(lines[i].replace(/^\s*>\s?/, ""));

  // The first table inside the quote: a "|" row, a |---| row, then rows. Its lines are left out of `lines`.
  const from = inner.findIndex((l, i) => l.trim().startsWith("|") && SEPARATOR.test(inner[i + 1] ?? ""));
  let to = from === -1 ? -1 : from + 2;
  while (to !== -1 && to < inner.length && inner[to].trim().startsWith("|")) to++;
  const text = from === -1 ? inner : [...inner.slice(0, from), ...inner.slice(to)];

  return {
    date: normalizeDate(/\d{4}-\d{2}-\d{2}/.exec(lines[start])?.[0]),
    lines: text.map((l) => stripExamples(l).replace(BOLD, "$2").trim()).filter(Boolean),
    table: from === -1 ? null : parseTable(inner.slice(from, to).join("\n")),
  };
}

/** Reads a Marketing Engine note, old (v1) or new (v2) layout. Every table and marker is optional; empty rows are kept. */
export function parseMarketing(body: string): MarketingNote {
  const reviewed = readMarker(body, "nx-reviewed");
  return {
    competitors: parseCompetitors(body),
    hooks: parseHooks(body),
    backlog: parseBacklog(body),
    brandKit: parseKv(body, MARKETING_SECTIONS.brandKit, ["asset"], ["link", "status", "value"], GENERIC_EXAMPLES.brandKit),
    paidTest: parseKv(body, MARKETING_SECTIONS.paidTest, ["item"], ["value"], GENERIC_EXAMPLES.paidTest),
    research: parseResearch(body),
    request: parseRequest(body),
    reviewed: { competitors: normalizeDate(reviewed?.competitors), hooks: normalizeDate(reviewed?.hooks) },
    picked: parsePicked(body),
    markers: { research: readMarker(body, "nx-research"), request: readMarker(body, "nx-research-request"), reviewed },
  };
}
