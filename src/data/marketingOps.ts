// Pure builders for every edit the dashboard makes to the Marketing Engine and the Dev Spec profile, plus the
// checks its edit sheets run as you type. A builder only returns a TableOp (data/tableEdit); the host applies it,
// and applyTableOp first checks that the note still holds what the user saw. Pure: no Obsidian, no DOM, no clock.
//
// Expect rule (U2): a set or delete op expects the values the user saw, read the way cell() reads them
// (Cell.value, HookRow.ratingCell.value), keyed by Cell.col, the header text the cell was read from, so a renamed
// header still works. `seen` (an edit sheet's seen values, keyed like the builder's values) replaces a cell's own
// value only when the sheet moved it (the partner's text after "Keep mine"). A marker op expects
// MarketingNote.markers.<name> exactly.
// Rows: a numbered row goes by its # and a brand kit or paid test row by its label, unless another row has the same
// one (the parser marks it `repeated`); then it goes by its place and also expects its # or label and every cell the
// user was shown, so a row that moved conflicts instead of another row changing. A competitor always goes by its
// place and always expects its name as shown. Edit sheets find the row again in newer data with sameRow.
// Clearing (U3): an empty value is sent as "", and tableEdit puts the template's green example back. Nothing here
// writes "e.g." text. Pass only the fields the user changed (editSheet's `changed`).

import { daysBetween, isIsoDate } from "./dates";
import { isPlaceholder, plainText, stripExamples } from "./markdown";
import { isOldLayout } from "./marketing";
import type { BacklogRow, BacklogStatus, Cell, CompetitorRow, HookRow, KvRow, MarketingNote } from "./marketing";
import { MARKETING_SECTIONS, RATING_LABEL, ratingOf, SPEC_SECTIONS } from "./noteFormat";
import type { HookRating } from "./noteFormat";
import type { ProductProfile } from "./profile";
import { findRows, mdLink } from "./tableEdit";
import type { RowRef, TableOp } from "./tableEdit";
import { SPEND_CAP } from "./types";

/** A check's verdict on a typed value: an error blocks Save, a warn only shows under the field. */
export interface Check {
  level: "error" | "warn";
  text: string;
}

/** One cell to write: the cell as the user saw it and its new text. */
export interface CellEdit {
  cell: Cell;
  value: string;
  /** What the user saw in this cell, when the edit sheet moved it (after "Keep mine"). Defaults to cell.value. */
  seen?: string;
}

/** A cell an op only checks: what the user saw in it (seen, else cell.value). Nothing is written to it. */
export interface CellCheck {
  cell: Cell;
  seen?: string;
}

/** What an edit sheet saw for each field, keyed like the builder's values (editSheet's `seen`). */
export type Seen<T> = Partial<Record<keyof T, string>>;

export interface CompetitorValues {
  /** The product's name; joined with storeUrl into one [name](url) cell. */
  name?: string;
  storeUrl?: string;
  /** The top video's text ("184k views · 7.4× usual"); joined with videoUrl into one [video](url) cell. */
  video?: string;
  videoUrl?: string;
  hook?: string;
  why?: string;
}

export interface HookValues {
  /** Ignored in old v1 notes, which have no Rating column (nothing ever adds one). "" = not rated. */
  rating?: HookRating;
  hook?: string;
  demo?: string;
  cta?: string;
  basedOn?: string;
}

export interface BacklogValues {
  format?: string;
  platforms?: string;
  /** The hook's number in the Hook scripts table, e.g. "2". */
  hookNum?: string;
  /** scripted, recorded, edited or scheduled. */
  status?: string;
  goLive?: string;
}

/** The 4 steps of a video, in order, with the word each one shows. */
export const BACKLOG_STEPS: ReadonlyArray<{ value: Exclude<BacklogStatus, "">; label: string }> = [
  { value: "scripted", label: "Scripted" },
  { value: "recorded", label: "Recorded" },
  { value: "edited", label: "Edited" },
  { value: "scheduled", label: "Scheduled" },
];

// ---------------------------------------------------------------------------------------------------
// Messages (plain words: they show inside the edit sheet)
// ---------------------------------------------------------------------------------------------------

const STRIPE_TEXT = "That's a Stripe secret key. Keys never go in the vault. Paste the payment link (https://buy.stripe.com/…) instead.";
const BUDGET_TEXT = `The paid test is capped at $${SPEND_CAP} per sprint.`;
const BUDGET_UNREAD = "Write the budget as a dollar amount, like $100.";
const START_TEXT = "Paid ads start on day 15, after launch.";
const NOWHERE = "Nothing was saved: this part of the note is missing. Open the note to check.";
const NOTHING_TYPED = "Type at least one thing about the video first.";
const NO_BACKLOG = "This note has no content backlog yet, so there's nowhere to add the video. Open the note to check.";
const NO_HOOK_NUMBER = "This hook has no number in the note yet, so a video can't point to it.";
const NO_PROFILE_TABLE = "The Dev Spec doesn't have the 3 profile lines yet: paste them from the Dev Spec template under the pitch.";
const NOTHING_SHOWN = "Couldn't check what this would delete. Open the note and delete it there.";

/** Paid ads may start on this sprint day (the day after launch, day 14). */
const PAID_START_DAY = 15;

/** What Don't use rows hold in Demo shot and CTA. */
const DASH = "—";
const isDash = (s: string) => /^[—–-]$/.test(s.trim());

/** The backlog's Hook # column: BacklogRow has no Cell for it, so it's found the way the parser finds it. */
const HOOK_NUM_COL = "hook";

// ---------------------------------------------------------------------------------------------------
// Form text and links
// ---------------------------------------------------------------------------------------------------

/** Escaped table text the way a form shows it: <br> as a line break, \| as |. tableEdit writes it back escaped. */
function shown(s: string): string {
  return s.replace(/<br\s*\/?>/gi, "\n").replace(/\\\|/g, "|");
}

/** A cell's typed text the way an edit form shows it (line breaks as new lines, \| as |). Use it for FieldSpec.value. */
export function formValue(c: Cell): string {
  return shown(c.value);
}

/** Exactly one [label](url) and nothing else; the label trimmed, its brackets escaped. */
const ONE_LINK = /^\[((?:\\[[\]]|[^[\]\\]|\\(?![[\]]))+)\]\(([^()\s]+)\)$/;
const BARE_URL = /^(?:https?:\/\/|www\.)\S+$/i;

/**
 * A link cell as two form fields. "[Acme Vox](https://example.com/a)" → { label: "Acme Vox", url: "https://example.com/a" };
 * a bare URL → { label: "", url }; anything else → { label: the whole text, url: "" }.
 * joinLink(splitLink(c)) gives c.value back (as the note compares text), so a form can't change a cell by accident.
 */
export function splitLink(c: Cell): { label: string; url: string } {
  const v = c.value;
  const m = ONE_LINK.exec(v);
  if (m && m[1] === m[1].trim()) return { label: shown(m[1].replace(/\\([[\]])/g, "$1")), url: m[2] };
  if (BARE_URL.test(v)) return { label: "", url: v };
  return { label: shown(v), url: "" };
}

/** The cell text for a label and a link: mdLink(label, url), the label alone without a link, the bare link without a label. */
export function joinLink(label: string, url: string): string {
  const l = label.trim();
  const u = url.trim();
  if (u === "") return l;
  if (l === "") return u.replace(/\s/g, "%20");
  return mdLink(l, u);
}

/** What a link cell's expect is: its own value, unless the sheet moved what it saw for one of the two parts. */
function linkSeen(c: Cell, label?: string, url?: string): string | undefined {
  if (label === undefined && url === undefined) return undefined;
  const was = splitLink(c);
  const l = label ?? was.label;
  const u = url ?? was.url;
  return l === was.label && u === was.url ? undefined : joinLink(l, u);
}

/** A piece of a cell's text for a card: plain text, or a link with a safe http(s) address. */
export interface TextPart {
  text: string;
  /** Only http: and https: addresses; anything else stays plain text. */
  url?: string;
}

const LINKISH = /\[((?:\\.|[^\]\\])+)\]\(([^()\s]+)\)|\[\[([^\]|\\]+?)(?:\\?\|([^\]]+))?\]\]|((?:https?:\/\/|www\.)[^\s<>"'()[\]]+)/gi;
const HTML_TAG = /<\/?[a-z][^>]*>/gi;

/** Table escapes undone for reading: <br> as a line break, \| \[ \] as | [ ], and other HTML tags dropped. */
function readable(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(HTML_TAG, "")
    .replace(/\\([|[\]])/g, "$1");
}

/** The address when it's a web link (http or https; "www." gets https), else undefined: obsidian:, file:, javascript: never become links. */
export function safeUrl(u: string): string | undefined {
  try {
    const url = new URL(/^www\./i.test(u) ? `https://${u}` : u);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A cell's text split into plain text and links for a card: [label](url) and bare http(s) addresses become links,
 * [[note|alias]] shows its alias, and any other address (javascript:, file:, …) stays plain text.
 */
export function linkParts(value: string): TextPart[] {
  const out: TextPart[] = [];
  const text = (s: string) => {
    const t = readable(s);
    if (t === "") return;
    const last = out[out.length - 1];
    if (last && last.url === undefined) last.text += t;
    else out.push({ text: t });
  };
  let at = 0;
  for (const m of value.matchAll(LINKISH)) {
    text(value.slice(at, m.index));
    at = (m.index ?? 0) + m[0].length;
    if (m[1] !== undefined) {
      const url = safeUrl(m[2]);
      const label = readable(m[1]);
      if (url) out.push({ text: label, url });
      else text(m[1]);
    } else if (m[3] !== undefined) {
      text(m[4] ?? m[3].split("/").pop() ?? m[3]);
    } else {
      const raw = m[5];
      const bare = raw.replace(/[.,;:!?]+$/, "");
      const url = safeUrl(bare);
      if (url) out.push({ text: bare, url });
      else text(bare);
      text(raw.slice(bare.length));
    }
  }
  text(value.slice(at));
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Set ops
// ---------------------------------------------------------------------------------------------------

/** Throws the Stripe refusal when any value holds a secret key: keys never go in the vault. Every write path uses it. */
export function refuseSecrets(values: string[]): void {
  if (values.some(stripeSecret)) throw new Error(STRIPE_TEXT);
}

/**
 * One set op on one row: each cell's new text keyed by Cell.col, expecting seen ?? Cell.value. Cells whose column
 * the note doesn't have (col "") are skipped; when nothing is left it throws a plain Error. `row` is the row's
 * index (Cell rows' `index`), or a RowRef. `checks` are cells it only expects (a row found by its place checks its
 * # or label too). Refuses Stripe secret keys.
 */
export function cellEdits(heading: string, row: number | RowRef, edits: CellEdit[], checks: CellCheck[] = []): TableOp {
  const values: Record<string, string> = {};
  const expect: Record<string, string> = {};
  for (const e of edits) {
    if (e.cell.col === "") continue;
    values[e.cell.col] = e.value;
    expect[e.cell.col] = e.seen ?? e.cell.value;
  }
  if (Object.keys(values).length === 0) throw new Error(NOWHERE);
  refuseSecrets(Object.values(values));
  for (const c of checks) {
    if (c.cell.col !== "" && !Object.prototype.hasOwnProperty.call(expect, c.cell.col)) expect[c.cell.col] = c.seen ?? c.cell.value;
  }
  return { kind: "set", heading, edits: [{ row: typeof row === "number" ? { index: row } : row, values, expect }] };
}

/** A row's # as a cell an op can check. */
const numberCell = (num: string): Cell => ({ value: num, raw: num, example: "", col: "#" });

/**
 * Where a numbered row's edit goes: by its # (so a partner adding or deleting a row above doesn't move the edit),
 * else, when the row has no number or another row has the same one, by its place, checking its # and `shown` (every
 * cell the user was shown) so a row that moved conflicts instead of another row changing.
 */
function numbered(row: { index: number; num: string; repeated?: true }, shown: Cell[]): { ref: number | RowRef; checks: CellCheck[] } {
  if (/^\d+$/.test(row.num) && !row.repeated) return { ref: { key: row.num, col: "#" }, checks: [] };
  // A row without a # (or in a table without that column) is checked by its other cells only.
  return { ref: row.index, checks: [...(row.num !== "" ? [numberCell(row.num)] : []), ...shown].map((cell) => ({ cell })) };
}

/**
 * Edits a competitor row. name + storeUrl become one cell, mdLink(name, storeUrl); video + videoUrl likewise. A part
 * left out keeps what the user saw (seen, else the cell's own part), so changing only the link keeps the name.
 */
export function competitorOp(row: CompetitorRow, values: CompetitorValues, seen: Seen<CompetitorValues> = {}): TableOp {
  const edits: CellEdit[] = [];
  const link = (c: Cell, label: string | undefined, url: string | undefined, seenLabel: string | undefined, seenUrl: string | undefined) => {
    if (label === undefined && url === undefined) return;
    const was = splitLink(c);
    edits.push({ cell: c, value: joinLink(label ?? seenLabel ?? was.label, url ?? seenUrl ?? was.url), seen: linkSeen(c, seenLabel, seenUrl) });
  };
  link(row.name, values.name, values.storeUrl, seen.name, seen.storeUrl);
  link(row.link, values.video, values.videoUrl, seen.video, seen.videoUrl);
  if (values.hook !== undefined) edits.push({ cell: row.hook, value: values.hook, seen: seen.hook });
  if (values.why !== undefined) edits.push({ cell: row.why, value: values.why, seen: seen.why });
  // A competitor goes by its place, so every cell the sheet showed is checked (not only the name, which may be
  // empty on several lines): a line that moved conflicts instead of another competitor changing.
  return cellEdits(MARKETING_SECTIONS.competitors, row.index, edits, [
    { cell: row.name, seen: linkSeen(row.name, seen.name, seen.storeUrl) },
    { cell: row.link, seen: linkSeen(row.link, seen.video, seen.videoUrl) },
    { cell: row.hook, seen: seen.hook },
    { cell: row.why, seen: seen.why },
  ]);
}

const isRatingKey = (s: string): s is HookRating => s === "" || Object.prototype.hasOwnProperty.call(RATING_LABEL, s);

/** The Rating cell the user saw: the cell as written, unless the sheet moved the seen rating (a key or the cell text). */
function ratingSeen(row: HookRow, seen: string | undefined): string | undefined {
  if (seen === undefined) return undefined;
  if (!isRatingKey(seen)) return seen;
  if (seen === row.rating) return undefined;
  return seen === "" ? "" : RATING_LABEL[seen];
}

/** What a hook sheet saw: its fields, plus the Rating cell's text exactly as the sheet last read it. */
export type HookSeen = Seen<HookValues> & {
  /** The Rating cell's text the sheet last read for the rating it shows, expected exactly as written (never read as a key). */
  ratingText?: string;
};

/**
 * Edits a hook row. rating writes RATING_LABEL (the word with its icon; "" = not rated) and is ignored in v1 rows.
 * A row rated Don't use gets "—" in an empty Demo shot or CTA; a row leaving Don't use gets its "—" cleared, so the
 * template's examples show again. seen.ratingText, when given, is the Rating cell's expect as it is.
 */
export function hookOp(row: HookRow, values: HookValues, seen: HookSeen = {}): TableOp {
  const v2 = row.ratingCell.col !== "";
  // Only the 4 ratings are written; anything else (a select keeping a typed "TBD") leaves the cell as it is.
  const setRating = v2 && values.rating !== undefined && isRatingKey(values.rating);
  const rating: HookRating = setRating ? (values.rating as HookRating) : row.rating;
  const before: HookRating =
    seen.ratingText !== undefined ? ratingOf(seen.ratingText) : seen.rating === undefined ? row.rating : isRatingKey(seen.rating) ? seen.rating : ratingOf(seen.rating);
  const edits: CellEdit[] = [];
  if (setRating) {
    edits.push({ cell: row.ratingCell, value: rating === "" ? "" : RATING_LABEL[rating], seen: seen.ratingText ?? ratingSeen(row, seen.rating) });
  }
  if (values.hook !== undefined) edits.push({ cell: row.hook, value: values.hook, seen: seen.hook });
  for (const key of ["demo", "cta"] as const) {
    const c = row[key];
    const typed = values[key];
    if (typed !== undefined) {
      edits.push({ cell: c, value: rating === "avoid" && typed.trim() === "" ? DASH : typed, seen: seen[key] });
    } else if (setRating && rating === "avoid" && (seen[key] ?? c.value).trim() === "") {
      edits.push({ cell: c, value: DASH, seen: seen[key] });
    } else if (setRating && rating !== "avoid" && before === "avoid" && isDash(seen[key] ?? c.value)) {
      edits.push({ cell: c, value: "", seen: seen[key] });
    }
  }
  if (values.basedOn !== undefined) edits.push({ cell: row.basedOn, value: values.basedOn, seen: seen.basedOn });
  const at = numbered(row, [row.ratingCell, row.hook, row.demo, row.cta, row.basedOn]);
  return cellEdits(MARKETING_SECTIONS.hooks, at.ref, edits, at.checks);
}

/** Every editable cell of a video row. Hook # has no Cell of its own, so it's made from hookNum and found like the parser finds it. */
export function backlogCells(row: BacklogRow): Record<keyof BacklogValues, Cell> {
  return {
    format: row.format,
    platforms: row.platformsCell,
    hookNum: { value: row.hookNum, raw: row.hookNum, example: "", col: HOOK_NUM_COL },
    status: row.statusCell,
    goLive: row.goLive,
  };
}

const BACKLOG_KEYS: Array<keyof BacklogValues> = ["format", "platforms", "hookNum", "status", "goLive"];

/** The template's column keys, for a backlog without any row to read the note's own headers from. */
const BACKLOG_COLS: Record<keyof BacklogValues, string> = { format: "format", platforms: "platform", hookNum: HOOK_NUM_COL, status: "status", goLive: "go-live" };

/** Edits a video row (found by its #, else by its place). */
export function backlogOp(row: BacklogRow, values: BacklogValues, seen: Seen<BacklogValues> = {}): TableOp {
  const cells = backlogCells(row);
  const edits: CellEdit[] = [];
  for (const key of BACKLOG_KEYS) {
    const v = values[key];
    if (v !== undefined) edits.push({ cell: cells[key], value: v, seen: seen[key] });
  }
  const at = numbered(row, Object.values(cells));
  return cellEdits(MARKETING_SECTIONS.backlog, at.ref, edits, at.checks);
}

/** Moves a video to a status step: writes the plain word, expecting the Status cell the card showed. */
export function backlogStatusOp(row: BacklogRow, status: Exclude<BacklogStatus, "">): TableOp {
  const at = numbered(row, Object.values(backlogCells(row)));
  return cellEdits(MARKETING_SECTIONS.backlog, at.ref, [{ cell: row.statusCell, value: status }], at.checks);
}

/**
 * Edits a brand kit or paid test row: found by its label, or by its place when it has none or another row has the
 * same one; then it also checks the label, so a row that moved conflicts.
 */
export function kvOp(section: "brandKit" | "paidTest", row: KvRow, value: string, seen?: string): TableOp {
  const labelCol = section === "brandKit" ? "asset" : "item";
  const edit = [{ cell: row.value, value, seen }];
  // By its whole label only: "Logo" never lands on "Logo (dark)" once a partner renamed or deleted the Logo line.
  if (row.label !== "" && !row.repeated) return cellEdits(MARKETING_SECTIONS[section], { key: row.label, col: labelCol, exact: true }, edit);
  // By its place: a labelled row also checks its label (a table without a label column has none to check).
  const checks = row.label !== "" ? [{ cell: { value: row.label, raw: row.label, example: "", col: labelCol } }] : [];
  return cellEdits(MARKETING_SECTIONS[section], row.index, edit, checks);
}

const PROFILE_ROW_KEYS = { buyer: "Who buys", job: "Job", price: "Price" } as const;
/** The label a profile line gets when Fill in adds it (the Dev Spec template's). */
const PROFILE_ROW_LABELS = { buyer: "Who buys it", job: "Job it does", price: "Price" } as const;

/**
 * Edits one of the 3 profile rows under the Dev Spec's pitch (Who buys it, Job it does, Price). A line the list
 * doesn't have yet (profile.absent) is added to it, so Fill in can always save.
 */
export function profileOp(profile: ProductProfile, field: "buyer" | "job" | "price", value: string, seen?: string): TableOp {
  const cols = profile.profileColumns;
  if (!cols) throw new Error(NO_PROFILE_TABLE);
  if (profile.absent?.includes(field)) {
    refuseSecrets([value]);
    return { kind: "insert", heading: SPEC_SECTIONS.pitch, values: { [cols.label]: PROFILE_ROW_LABELS[field], [cols.value]: value } };
  }
  const cell: Cell = { value: profile[field], raw: profile[field], example: "", col: cols.value };
  return cellEdits(SPEC_SECTIONS.pitch, { key: PROFILE_ROW_KEYS[field], col: cols.label }, [{ cell, value, seen }]);
}

// ---------------------------------------------------------------------------------------------------
// Finding a row again (open edit sheets, U6)
// ---------------------------------------------------------------------------------------------------

/** Two rows' cells read the same. */
function sameCells(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * The same row in newer data, so an open edit sheet watches (and saves to) the row the user opened. `key` is its #,
 * label or name, matched whole (findRows without its "starts with" fallback, the way kvOp's and the numbered ops'
 * rows are found), so a renamed or deleted "Logo" is never taken for "Logo (dark)". When that key named one row
 * before and names one row now: that row, wherever it moved. With repeats (or no key): one whose cells (`cells`)
 * all still match, nearest its old place, else the one in the same place among them while their number is the
 * same. A row whose key changed is still found in its old place when nothing moved (as many rows as before, and
 * its new key isn't another row's old one), so a partner renaming it shows as their change. Null when it's gone or
 * can't be told apart: never another row.
 */
export function sameRow<T extends { index: number }>(
  before: readonly T[],
  row: T,
  after: readonly T[] | null | undefined,
  key: (r: T) => string,
  cells: (r: T) => string[],
): T | null {
  if (!after) return null;
  const k = key(row);
  const was = findRows(before.map(key), k, true);
  const now = findRows(after.map(key), k, true);
  if (k.trim() !== "" && was.length <= 1 && now.length === 1) return after[now[0]];
  // A line that moved is followed by its content before its place among the lines with the same key.
  const like = now.filter((i) => sameCells(cells(after[i]), cells(row)));
  if (like.length) return after[like.reduce((a, b) => (Math.abs(after[b].index - row.index) < Math.abs(after[a].index - row.index) ? b : a))];
  const nth = was.findIndex((i) => before[i].index === row.index);
  if (nth !== -1 && was.length === now.length && now.length > 0) return after[now[nth]];
  if (now.length === 0 && after.length === before.length) {
    const r = after.find((x) => x.index === row.index);
    if (r && findRows(before.map(key), key(r), true).length === 0) return r;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------
// Insert and delete
// ---------------------------------------------------------------------------------------------------

/** "Use in a video": fills the next free video row (or adds one, numbered) with this hook's number. */
export function useHookOp(m: MarketingNote, hook: HookRow): TableOp {
  if (!m.backlog) throw new Error(NO_BACKLOG);
  if (isPlaceholder(hook.num)) throw new Error(NO_HOOK_NUMBER);
  // An old-layout note counts a video by its Format or Status (videoRule): the new one starts as scripted.
  const status = isOldLayout(m) ? { [backlogCol(m, "status")]: "scripted" } : {};
  return { kind: "insert", heading: MARKETING_SECTIONS.backlog, values: { [HOOK_NUM_COL]: hook.num, ...status }, numberCol: "#" };
}

/** A backlog column's key: the note's own header when it has a video row, else the template's. */
function backlogCol(m: MarketingNote | null | undefined, key: keyof BacklogValues): string {
  const like = m?.backlog?.[0];
  return like && backlogCells(like)[key].col !== "" ? backlogCells(like)[key].col : BACKLOG_COLS[key];
}

/**
 * "Add a video": fills the first free video row (only examples) or adds a numbered one. Column names come from the
 * note's own headers when `m` has a video row, else the template's. Empty values are left out; with nothing typed
 * it throws a plain Error. Refuses Stripe secret keys.
 */
export function addVideoOp(values: BacklogValues, m?: MarketingNote | null): TableOp {
  const like = m?.backlog?.[0];
  const cells = like ? backlogCells(like) : null;
  const out: Record<string, string> = {};
  for (const key of BACKLOG_KEYS) {
    const v = values[key];
    if (v === undefined || v.trim() === "") continue;
    const col = cells ? cells[key].col : BACKLOG_COLS[key];
    if (col !== "") out[col] = v;
  }
  if (Object.keys(out).length === 0) throw new Error(NOTHING_TYPED);
  refuseSecrets(Object.values(out));
  // An old-layout note counts a video by its Format or Status (videoRule): one added without either starts as scripted.
  if (isOldLayout(m) && (values.format ?? "").trim() === "" && (values.status ?? "").trim() === "") out[backlogCol(m, "status")] = "scripted";
  return { kind: "insert", heading: MARKETING_SECTIONS.backlog, values: out, numberCol: "#" };
}

/** Deletes row `index`, expecting every cell the user was shown (by Cell.col). The only row is cleared instead. */
export function deleteRowOp(heading: string, index: number, shown: Cell[]): TableOp {
  const expect: Record<string, string> = {};
  for (const c of shown) if (c.col !== "") expect[c.col] = c.value;
  if (Object.keys(expect).length === 0) throw new Error(NOTHING_SHOWN);
  return { kind: "delete", heading, row: { index }, expect };
}

// ---------------------------------------------------------------------------------------------------
// Research markers
// ---------------------------------------------------------------------------------------------------

/** Who asks for research (U10): the device's role when it's dev or marketing, else marketing. */
export function requestBy(role: string): "dev" | "marketing" {
  return role === "dev" || role === "marketing" ? role : "marketing";
}

/** "Ask for research": writes <!-- nx-research-request: date=<today> by=<by> --> (or updates the one there). */
export function requestResearchOp(m: MarketingNote, today: string, by: string): TableOp {
  return { kind: "marker", heading: MARKETING_SECTIONS.competitors, name: "nx-research-request", attrs: { date: today, by }, expect: m.markers.request };
}

const MARKER_WORD = /^[A-Za-z0-9_-]+$/;

/** "Looks good" on one part: sets its date in <!-- nx-reviewed: competitors=… hooks=… --> and keeps the other part's. */
export function reviewedOp(m: MarketingNote, part: "competitors" | "hooks", today: string): TableOp {
  const prev = m.markers.reviewed ?? {};
  const attrs: Record<string, string> = { competitors: prev.competitors ?? "", hooks: prev.hooks ?? "" };
  // Attributes this version doesn't know stay, as long as a marker line can hold them.
  for (const [k, v] of Object.entries(prev)) {
    if (!Object.prototype.hasOwnProperty.call(attrs, k) && MARKER_WORD.test(k) && !/\s|-->/.test(v)) attrs[k] = v;
  }
  attrs[part] = today;
  return { kind: "marker", heading: MARKETING_SECTIONS.competitors, name: "nx-reviewed", attrs, expect: m.markers.reviewed };
}

export interface ResearchState {
  /** A research request is waiting: its marker is there, dated on or after the last research (or there's no research). */
  pending: boolean;
  /** Each part was reviewed (Looks good) on or after the last research date; with no research yet, once it was reviewed at all. */
  reviewed: { competitors: boolean; hooks: boolean };
}

/**
 * The marker rules agreed with competitor-scout: a /competitors run writes nx-research and deletes
 * nx-research-request and nx-reviewed, so a request still there on or after the research date came after that run.
 */
export function researchState(m: MarketingNote | null): ResearchState {
  const request = m?.request ?? null;
  const research = m?.research ?? null;
  const fresh = (d: string | null | undefined) => !!d && (!research || daysBetween(research.date, d) >= 0);
  return {
    pending: !!request && fresh(request.date),
    reviewed: { competitors: fresh(m?.reviewed.competitors), hooks: fresh(m?.reviewed.hooks) },
  };
}

// ---------------------------------------------------------------------------------------------------
// Checks (U11)
// ---------------------------------------------------------------------------------------------------

/** What a wrap or a paste can put inside a key: whitespace, no-break, soft hyphen and invisible characters, <br>, URL-encoded whitespace. */
const KEY_GAP = String.raw`(?:[\s ­​-‍⁠-⁤﻿]|<br\s*\/?>|%(?:20|0a|0d|09|a0))*`;
/** An underscore, also URL-encoded, escaped by Obsidian's paste (\_), as an HTML entity or full width. */
const KEY_UNDERSCORE = String.raw`(?:_|%5f|\\_|&#0*95;|＿)`;
const gapped = (word: string) => word.split("").join(KEY_GAP);

/**
 * A Stripe secret or restricted key (live or test, any case): sk_ or rk_ where a word can start (never inside a
 * handle like @spark_live_beats), then live_ or test_ and at least 10 key characters. The gap characters are allowed
 * only inside the key, so text around it is never glued onto it.
 */
const STRIPE_SECRET = new RegExp(
  String.raw`(?<!(?<!%[0-9a-f])[a-z0-9])[sr]${KEY_GAP}k${KEY_GAP}${KEY_UNDERSCORE}${KEY_GAP}(?:${gapped("live")}|${gapped("test")})${KEY_GAP}${KEY_UNDERSCORE}(?:${KEY_GAP}[0-9a-z]){10,}`,
  "i",
);

/**
 * True when the text holds a Stripe secret or restricted key, also inside a link, and also when a wrap or a paste
 * put a space, a line break or an invisible character in it. Payment links and publishable keys are fine.
 */
export function stripeSecret(s: string): boolean {
  return STRIPE_SECRET.test(s);
}

/** Refuses a Stripe secret key anywhere in the text (an error: blocks Save). */
export function stripeCheck(s: string): Check | null {
  return stripeSecret(s) ? { level: "error", text: STRIPE_TEXT } : null;
}

const MONEY = /(\$\s*|\busd\s*)?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(\s*k\b)?(\s*(?:usd|dollars?)\b)?/gi;

interface Amount {
  n: number;
  start: number;
  end: number;
  /** Written as a limit ("at most $300", "$300 max", "$300 total", "scale to $300"): the most that may be spent, not more spending. */
  cap: boolean;
  /** Inside "( … )" right after another amount ("$300 ($100 test + $200 scale)"): that amount split up, not more spending. */
  part?: boolean;
}

const CAP_BEFORE =
  /(?:at\s+most|max(?:imum)?|up\s+to|cap(?:ped)?(?:\s+(?:at|of))?|no\s+more\s+than|limit(?:\s+of)?|tops?|(?:in\s+)?total(?:\s+of)?|overall|budget\s+of|scale[sd]?\s+(?:up\s+)?to|stop(?:s|ping)?\s+at|→|->)\s*:?\s*$/i;
const CAP_AFTER = /^\s*(?:at\s+most|max(?:imum)?\b|cap\b|limit\b|tops?\b|in\s+total\b|total\b|overall\b|in\s+all\b|budget\b)/i;
/** Words between two amounts that make them choices or a range ("$100 or $250", "$100–$250"): the larger one counts. */
const EITHER = /(?:^|\s)(?:or|to)(?:\s|$)|[-–—]/i;
/** Words between two amounts that add them up. */
const PLUS = /[+,;&]|(?:^|\s)(?:and|plus|then)(?:\s|$)/i;

/** Dollar amounts in the text: the ones written with $ / USD / dollars when there are any, else every number that isn't a day. */
function dollarAmounts(text: string): Amount[] {
  const marked: Amount[] = [];
  const bare: Amount[] = [];
  for (const m of text.matchAll(MONEY)) {
    let n = Number(m[2].replace(/,/g, "") + (m[3] ?? ""));
    if (m[4]) n *= 1000;
    if (!Number.isFinite(n)) continue;
    const start = m.index ?? 0;
    const end = start + m[0].length;
    const before = text.slice(0, start);
    const after = text.slice(end);
    const a: Amount = { n, start, end, cap: CAP_BEFORE.test(before) || CAP_AFTER.test(after) };
    // Inside brackets that open right after an amount: a breakdown of that amount.
    const open = before.lastIndexOf("(");
    if (open > before.lastIndexOf(")") && /(?:\d|k|usd|dollars?)\s*$/i.test(before.slice(0, open))) a.part = true;
    if (m[1] || m[5]) marked.push(a);
    // A bare number that's a day ("day 15", "3 days") or a backlog number ("#2") isn't money.
    else if (!/(?:\bday|#)\s*$/i.test(before) && !/^\s*days?\b/i.test(after)) bare.push(a);
  }
  return marked.length ? marked : bare;
}

/**
 * What the text plans to spend at most: amounts joined by "+", "and", "plus", "then" or commas are added up, a range
 * or a choice ("$100–$250", "$100 or $250") counts its larger amount, and a limit ("$300 at most") counts as itself.
 */
function plannedSpend(text: string, amounts: Amount[]): number {
  const parts = amounts.filter((a) => a.part);
  if (parts.length) {
    // A breakdown is checked on its own (its parts added up), and the amount it splits stays.
    const rest = amounts.filter((a) => !a.part);
    return Math.max(plannedSpend(text, parts.map((a) => ({ ...a, part: false }))), rest.length ? plannedSpend(text, rest) : 0);
  }
  const spend = amounts.filter((a) => !a.cap);
  let total = 0;
  let term: Amount | null = null;
  let termValue = 0;
  for (const a of spend) {
    if (term === null) {
      term = a;
      termValue = a.n;
      continue;
    }
    const between = text.slice(term.end, a.start);
    if (EITHER.test(between) && !PLUS.test(between)) termValue = Math.max(termValue, a.n);
    else {
      total += termValue;
      termValue = a.n;
    }
    term = a;
  }
  total += termValue;
  return Math.max(spend.length ? total : 0, ...amounts.filter((a) => a.cap).map((a) => a.n));
}

/**
 * The paid test budget: an error when it plans more than $300 in total (split budgets add up; "$100 first, $300 at
 * most" is fine), a warn when there's text but no amount, else null. Empty text and examples are null.
 */
export function budgetCheck(s: string): Check | null {
  const text = plainText(s);
  if (isPlaceholder(text)) return null;
  const amounts = dollarAmounts(text);
  if (amounts.length === 0) return { level: "warn", text: BUDGET_UNREAD };
  return plannedSpend(text, amounts) > SPEND_CAP ? { level: "error", text: BUDGET_TEXT } : null;
}

/**
 * Warns when the paid test would start before sprint day 15. A date (YYYY-MM-DD) is counted from cycleStart (day 1),
 * and is null without one; "day 12" is read as written. No date, or one it can't read, is null.
 */
export function startDayCheck(date: string, cycleStart: string | null): Check | null {
  const text = plainText(date);
  if (isPlaceholder(text)) return null;
  const iso = /\b(\d{4}-\d{2}-\d{2})\b/.exec(text)?.[1];
  let day: number | null = null;
  if (iso && isIsoDate(iso)) {
    if (!cycleStart || !isIsoDate(cycleStart)) return null;
    day = daysBetween(cycleStart, iso) + 1;
  } else {
    const m = /\bday\s*(\d{1,3})\b/i.exec(text);
    if (m) day = Number(m[1]);
  }
  return day !== null && day < PAID_START_DAY ? { level: "warn", text: START_TEXT } : null;
}

/** Spoken words in a hook: quote marks, dashes and other punctuation-only tokens don't count; examples are left out. */
export function hookWords(s: string): number {
  return stripExamples(s)
    .replace(/<br\s*\/?>/gi, " ")
    .split(/\s+/)
    .filter((t) => /[\p{L}\p{N}]/u.test(t)).length;
}

/** Warns when a hook is longer than `max` spoken words: "14 words: aim for 12 or fewer." */
export function hookWordsCheck(s: string, max = 12): Check | null {
  const n = hookWords(s);
  return n > max ? { level: "warn", text: `${n} words: aim for ${max} or fewer.` } : null;
}

/** The warning when a Don't use hook is picked for a video. */
export function avoidHookWarning(hook: HookRow): string {
  const num = hook.num || String(hook.index + 1);
  return `Hook ${num} is rated Don't use: competitor videos with this opening got few views.`;
}
