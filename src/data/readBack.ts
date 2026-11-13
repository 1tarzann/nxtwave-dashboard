// Reading a note back after a table edit: does it still hold what the edit wrote? Both partners edit the same
// notes through Relay, which merges a file line by line, so a partner's change to the same cells can land on top
// of ours a moment after we save. Pure: no Obsidian, no clock.
//
// Cells are compared the way the dashboard reads them (examples stripped, trimmed, "\|" and <br> unescaped, the
// same reading tableEdit checks `expect` with), so a table that Obsidian's table editor re-padded, or a note with
// CRLF line endings, still holds the edit.

import { isPlaceholder, sectionRange, splitRow, stripExamples } from "./markdown";
import { applyTableOp, escapeCell, locateTable, readMarker, RowRef, TableLocation, TableOp } from "./tableEdit";

type Op<K extends TableOp["kind"]> = Extract<TableOp, { kind: K }>;

/**
 * True when `note` still holds what `op` wrote.
 *
 * - set: every written cell of each touched row. The row is found by its RowRef; an index row is also found by
 *   its "#" cell (or its label, the first cell, in a table without "#") after a row above it was added or removed.
 * - insert: some row holds the inserted values.
 * - delete: the deleted row is gone (the only row of a table is cleared instead, so it must still read as cleared).
 * - restore: the row is back.
 * - marker: readMarker gives the written attributes, or no marker after a removal.
 * - The table (or, for a marker, its section) is gone: false.
 *
 * `before` is the note just before the write. With it the check is exact: the written cells and the row's "#" or
 * label are read from the note the op made, so a cleared cell, an auto-numbered row or a deleted duplicate row are
 * judged right. Without it the op alone says what was written: an index row then has a name only when the op
 * wrote or expected its "#" or label cell, and a delete by index is judged from its `expect`.
 */
export function stillHolds(note: string, op: TableOp, before?: string): boolean {
  const now = note.split("\n");
  const m = madeBy(op, before);
  if (op.kind === "marker") return markerHolds(now, note, op, m);
  const t = locateTable(now, op.heading);
  if (!t) return false;
  switch (op.kind) {
    case "set": {
      const exact = m ? exactSetWants(t, op, m) : undefined;
      const wants = exact === undefined ? opSetWants(t, op) : exact;
      return wants !== null && wants.every((w) => rowHolds(t, w));
    }
    case "insert": {
      const cells = insertCells(op, m);
      // Nothing typed to look for.
      if (cells.every(([, v]) => v === "")) return true;
      const n = rowsHolding(t, cells);
      // More rows hold the values than before the save, so one that was already there doesn't count as ours.
      const tb = m && locateTable(m.before, op.heading);
      return n !== null && n > (tb ? rowsHolding(tb, cells) ?? 0 : 0);
    }
    case "delete":
      return deleteHolds(t, op, m);
    case "restore":
      return restoreHolds(t, op, m);
  }
}

// ---------------------------------------------------------------------------------------------------
// Reading cells
// ---------------------------------------------------------------------------------------------------

/** A line without its "\r". */
const text = (line: string) => (line.endsWith("\r") ? line.slice(0, -1) : line);

/** A cell's value the way the dashboard shows it: examples stripped, "\|" as |, <br> as a line break, trimmed. */
function norm(raw: string): string {
  return stripExamples(raw)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/\\\|/g, "|")
    .trim();
}

/** What a set or insert value reads as once it's in a cell (escaped the way tableEdit writes it). A cleared cell reads "". */
const written = (value: string) => norm(escapeCell(value));

/** Column by key, as tableEdit finds it: an exact header first, then the first header containing the key (any case). -1 when none. */
function colOf(t: TableLocation, key: string): number {
  const k = key.trim().toLowerCase();
  const lower = t.headers.map((h) => h.toLowerCase());
  const i = lower.indexOf(k);
  return i !== -1 || k === "" ? i : lower.findIndex((h) => h.includes(k));
}

/** The column that names a row: "#" when the table has one, else the first (a key-value table's label, a competitor's name). */
function nameCol(t: TableLocation): number {
  const i = t.headers.findIndex((h) => h.trim() === "#");
  return i === -1 ? 0 : i;
}

/** The row whose cell in column c is the key, as tableEdit finds it: exact (any case), else for a key that isn't a number the first that starts with it. */
function rowByKey(t: TableLocation, c: number, key: string): number {
  const k = norm(key).toLowerCase();
  const values = t.rows.map((r) => norm(r[c] ?? "").toLowerCase());
  const i = values.indexOf(k);
  return i !== -1 || k === "" || /^\d+$/.test(k) ? i : values.findIndex((v) => v.startsWith(k));
}

/** The row a RowRef names, or -1. */
function rowAt(t: TableLocation, ref: RowRef): number {
  if ("index" in ref) return Number.isInteger(ref.index) && ref.index >= 0 && ref.index < t.rows.length ? ref.index : -1;
  const c = colOf(t, ref.col);
  return c === -1 ? -1 : rowByKey(t, c, ref.key);
}

/** A row as the dashboard reads it, trailing empty cells left out: rows with the same signature look the same. */
function signature(cells: string[]): string {
  const v = cells.map(norm);
  while (v.length && v[v.length - 1] === "") v.pop();
  return JSON.stringify(v);
}

const count = (t: TableLocation, sig: string) => t.rows.filter((r) => signature(r) === sig).length;

// ---------------------------------------------------------------------------------------------------
// The note the op made
// ---------------------------------------------------------------------------------------------------

interface Made {
  before: string[];
  after: string[];
  afterText: string;
  inverse: TableOp;
}

/** The op applied to `before` again (it's pure), or null without `before` or when it no longer applies there. */
function madeBy(op: TableOp, before: string | undefined): Made | null {
  if (before === undefined) return null;
  try {
    const r = applyTableOp(before, op);
    return { before: before.split("\n"), after: r.text.split("\n"), afterText: r.text, inverse: r.inverse };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------
// set
// ---------------------------------------------------------------------------------------------------

/** One row a set op wrote, in terms of the note's table now. */
interface RowWant {
  /** Where the row was written (its data-row index), or null. */
  at: number | null;
  /** How many rows the table had right after the write, or null when unknown. */
  rows: number | null;
  /** A key ref to find it by: the column (in the table now) and the key. */
  key: { col: number; key: string } | null;
  /** Its "#" cell or label as the edit left it, or null when unknown: finds the row after rows above it moved. */
  name: string | null;
  /** Column (in the table now) → what the cell must read. */
  cells: Map<number, string>;
}

/**
 * The row is found by its key and its name ("#" or label). Only when nothing goes by either does its old position
 * count, and then only while the table has as many rows as the write left: after a row was removed, the row that
 * slid into that place isn't ours, even when it happens to hold the same text.
 */
function rowHolds(t: TableLocation, w: RowWant): boolean {
  const tries = new Set<number>();
  if (w.key) {
    // A key column the edit wrote finds the row by its new value.
    const r = rowByKey(t, w.key.col, w.cells.get(w.key.col) ?? w.key.key);
    if (r !== -1) tries.add(r);
  }
  if (w.name) {
    const c = nameCol(t);
    t.rows.forEach((row, r) => {
      if (norm(row[c] ?? "") === w.name) tries.add(r);
    });
  }
  if (!tries.size && w.at !== null && w.at >= 0 && w.at < t.rows.length && (w.rows === null || w.rows === t.rows.length)) tries.add(w.at);
  return [...tries].some((r) => [...w.cells].every(([c, v]) => norm(t.rows[r][c] ?? "") === v));
}

/**
 * The rows a set op wrote, read from the note it made: undefined when that can't be read (fall back to the op),
 * null when a column it wrote isn't in the table any more.
 */
function exactSetWants(t: TableLocation, op: Op<"set">, m: Made): RowWant[] | null | undefined {
  const tb = locateTable(m.before, op.heading);
  const ta = locateTable(m.after, op.heading);
  if (!tb || !ta || tb.rows.length !== ta.rows.length) return undefined;
  const rows = new Map<number, RowWant>();
  for (const e of op.edits) {
    // Every edit's row is found before anything is written, as tableEdit does.
    const r = rowAt(tb, e.row);
    if (r === -1) return undefined;
    const w = rows.get(r) ?? { at: r, rows: ta.rows.length, key: null, name: norm(ta.rows[r][nameCol(ta)] ?? "") || null, cells: new Map<number, string>() };
    rows.set(r, w);
    const cols = e.line !== undefined ? ta.headers.map((_, c) => c) : Object.keys(e.values).map((k) => colOf(ta, k));
    for (const ca of cols) {
      if (ca === -1) return undefined;
      const c = colOf(t, ta.headers[ca]);
      if (c === -1) return null;
      w.cells.set(c, norm(ta.rows[r][ca] ?? ""));
    }
  }
  return [...rows.values()];
}

/** The rows a set op wrote, from the op alone (later edits of the same row and column win). null when a column it names is gone. */
function opSetWants(t: TableLocation, op: Op<"set">): RowWant[] | null {
  const rows = new Map<string, RowWant>();
  const nc = nameCol(t);
  for (const e of op.edits) {
    const id = "index" in e.row ? `i:${e.row.index}` : `k:${e.row.col}\u0000${e.row.key}`;
    let w = rows.get(id);
    if (!w) {
      let key: RowWant["key"] = null;
      if (!("index" in e.row)) {
        const c = colOf(t, e.row.col);
        if (c === -1) return null;
        key = { col: c, key: e.row.key };
      }
      w = { at: "index" in e.row ? e.row.index : null, rows: null, key, name: null, cells: new Map() };
      rows.set(id, w);
    }
    const row = w;
    if (e.line !== undefined) {
      // An inverse that puts a whole line back.
      const cells = splitRow(text(e.line));
      t.headers.forEach((_, c) => row.cells.set(c, norm(cells[c] ?? "")));
    } else {
      for (const [k, v] of Object.entries(e.values)) {
        const c = colOf(t, k);
        if (c === -1) return null;
        row.cells.set(c, e.raw ? norm(v) : written(v));
      }
    }
    // Its name: what this edit wrote into the "#" or label column, else what the user saw there.
    const seen = Object.entries(e.expect).find(([k]) => colOf(t, k) === nc);
    if (row.cells.has(nc)) row.name = row.cells.get(nc) || null;
    else if (row.name === null && seen) row.name = norm(seen[1]) || null;
  }
  return [...rows.values()];
}

// ---------------------------------------------------------------------------------------------------
// insert, delete, restore
// ---------------------------------------------------------------------------------------------------

/**
 * Column key → what the inserted row's cell reads: from the row the insert made, else from the op (a placeholder
 * in its number column is left out: the insert numbered the row itself).
 */
function insertCells(op: Op<"insert">, m: Made | null): Array<[string, string]> {
  if (m) {
    const ta = locateTable(m.after, op.heading);
    const inv = m.inverse;
    // An appended row is undone by deleting it (by its number when it has one); a filled free row by setting it back.
    const ref = inv.kind === "delete" ? inv.row : inv.kind === "set" ? inv.edits[0]?.row : undefined;
    const r = ref && ta ? rowAt(ta, ref) : -1;
    const cols = ta ? Object.keys(op.values).map((k) => colOf(ta, k)) : [];
    if (ta && r >= 0 && r < ta.rows.length && cols.every((c) => c !== -1)) return cols.map((c) => [ta.headers[c], norm(ta.rows[r][c] ?? "")]);
  }
  const num = op.numberCol?.trim().toLowerCase();
  return Object.entries(op.values)
    .filter(([k, v]) => !(k.trim().toLowerCase() === num && isPlaceholder(v)))
    .map(([k, v]) => [k, written(v)]);
}

/** How many rows hold every cell (column key → value), or null when one of the columns is gone. */
function rowsHolding(t: TableLocation, cells: Array<[string, string]>): number | null {
  const cols: Array<[number, string]> = [];
  for (const [k, v] of cells) {
    const c = colOf(t, k);
    if (c === -1) return null;
    cols.push([c, v]);
  }
  return t.rows.filter((row) => cols.every(([c, v]) => norm(row[c] ?? "") === v)).length;
}

function deleteHolds(t: TableLocation, op: Op<"delete">, m: Made | null): boolean {
  if (m) {
    const tb = locateTable(m.before, op.heading);
    const ta = locateTable(m.after, op.heading);
    const r = tb ? rowAt(tb, op.row) : -1;
    if (tb && ta && r !== -1) {
      // The only row of a table was cleared instead: it must still read as cleared.
      if (ta.rows.length === tb.rows.length) return count(t, signature(ta.rows[r])) > 0;
      // Fewer rows that look like it than before (identical empty rows count one by one).
      const sig = signature(tb.rows[r]);
      return count(t, sig) < count(tb, sig);
    }
  }
  if (!("index" in op.row)) {
    const kc = colOf(t, op.row.col);
    if (kc === -1) return false;
    const r = rowByKey(t, kc, op.row.key);
    if (r === -1) return true;
    // Still there: only a cleared last row counts as deleted ("#" kept, every other cell empty).
    return t.rows[r].every((cell, c) => t.headers[c]?.trim() === "#" || norm(cell) === "");
  }
  // By index, without the note it was deleted from: no row may still show what the user saw in it.
  const seen = Object.entries(op.expect)
    .map(([k, v]): [number, string] => [colOf(t, k), norm(v)])
    .filter(([, v]) => v !== "");
  if (seen.some(([c]) => c === -1)) return false;
  return !seen.length || !t.rows.some((row) => seen.every(([c, v]) => norm(row[c] ?? "") === v));
}

function restoreHolds(t: TableLocation, op: Op<"restore">, m: Made | null): boolean {
  const sig = signature(splitRow(text(op.raw)));
  const tb = m ? locateTable(m.before, op.heading) : null;
  return count(t, sig) > (tb ? count(tb, sig) : 0);
}

// ---------------------------------------------------------------------------------------------------
// Markers
// ---------------------------------------------------------------------------------------------------

/** Index of the first line after the frontmatter (0 when there is none). */
function bodyStart(lines: string[]): number {
  if (text(lines[0] ?? "") !== "---") return 0;
  for (let i = 1; i < lines.length; i++) if (/^---\s*$/.test(text(lines[i]))) return i + 1;
  return 0;
}

function cleanAttrs(a: Record<string, string> | null): Record<string, string> | null {
  return a && Object.fromEntries(Object.entries(a).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v !== ""));
}

/** Same attributes, empty values left out (a marker never writes them). null only matches null. */
function sameAttrs(x: Record<string, string> | null, y: Record<string, string> | null): boolean {
  const a = cleanAttrs(x);
  const b = cleanAttrs(y);
  if (a === null || b === null) return a === b;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => Object.prototype.hasOwnProperty.call(b, k) && a[k] === b[k]);
}

function markerHolds(now: string[], note: string, op: Op<"marker">, m: Made | null): boolean {
  if (!sectionRange(now.slice(bodyStart(now)), op.heading)) return false;
  const want = m ? readMarker(m.afterText, op.name) : op.attrs === null ? null : op.raw !== undefined ? readMarker(op.raw, op.name) : op.attrs;
  return sameAttrs(readMarker(note, op.name), want);
}
