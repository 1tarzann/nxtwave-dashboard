// Edits one markdown table (or one hidden marker line) in a note and returns the new text plus the op that
// undoes it. Pure: no Obsidian, no files.
//
// Both partners edit the same notes through Relay, which merges a file line by line, and Obsidian's table
// editor pads every row. So an op changes only the lines it must, and in a changed row only the text of the
// touched cells: padding, the other cells, CRLF line endings and the frontmatter keep every byte. Each op
// first checks that the note still holds what the user saw, and throws before anything changes.

import { exampleIn, FENCE, HEADING, isPlaceholder, SectionRange, sectionRange, SEPARATOR, splitRow, stripExamples } from "./markdown";
import { ratingColumn, ratingOf, rowExample, sectionName } from "./noteFormat";

/**
 * A data row: by position (0 = the first row under the separator), or by its value in a column, found by findRows:
 * {key:"3", col:"#"} is the row whose # cell is 3. {key:"Budget", col:"item"} is the row whose Item cell is "Budget",
 * else the row whose Item cell starts with "Budget" (any case), for key-value tables like Brand kit and Paid test plan.
 * A key more than one row has is refused (AmbiguousRowError) rather than guessed. `exact` turns off the "starts
 * with" fallback, for a full label that must never land on another row ("Logo" never finds "Logo (dark)").
 */
export type RowRef = { index: number } | { key: string; col: string; exact?: boolean };

export interface RowEdit {
  row: RowRef;
  /** New text per column. Keys match headers like col() (part of the header, any case); an exact header wins. */
  values: Record<string, string>;
  /**
   * What the user saw when the editor opened, per column, the way cell() reads it. Checked before anything changes.
   * Inverses expect the whole row, so an Undo never lands on another row after a partner adds or deletes one.
   */
  expect: Record<string, string>;
  /** Inverses only: `values` hold exact cell bytes (padding included) and are written as they are. */
  raw?: boolean;
  /** Inverses only: the exact row line to put back, after an edit that added cells to a short row. */
  line?: string;
}

/** Inverses only: where a removed marker was, so putting it back lands on the same line. */
export interface MarkerPlace {
  /** Line index the removed lines started at. */
  index: number;
  /** The line just above them, as written (no line ending). */
  prev: string;
  /** The blank line next to the marker that went with it, if any. */
  blank: "above" | "below" | false;
}

export type TableOp =
  /** Sets cells in one or more rows: all edits, or none. */
  | { kind: "set"; heading: string; edits: RowEdit[] }
  /**
   * Fills the first row whose cells are all placeholders, or else appends a row after the last one.
   * numberCol gets max(existing numbers) + 1 when its cell is a placeholder.
   */
  | { kind: "insert"; heading: string; values: Record<string, string>; numberCol?: string }
  /** Removes the row. The only data row is cleared instead (its "#" stays), unless evenIfLast (set by inverses). */
  | { kind: "delete"; heading: string; row: RowRef; expect: Record<string, string>; evenIfLast?: boolean }
  /**
   * Inverse of delete: puts the exact raw line back. A line with a number in the table's "#" column goes back before
   * the first line with a higher number (else as data row `at`), and is refused only when a line with all the same
   * cells is there already, so Undos of several deletes work in any order. Other lines go back as data row `at`;
   * rows (set by inverses) is how many data rows the delete left, and with another number the line isn't put back
   * (it's back already, or the table changed). sameNumber (set by inverses) is how many other lines had the line's
   * number when it was deleted: when more have it now, the number went to another line since and it isn't put back.
   */
  | { kind: "restore"; heading: string; at: number; raw: string; rows?: number; sameNumber?: number }
  /**
   * Upserts a marker line (attrs) or removes it (null), per D4. expect = the attrs the user saw (null = no marker).
   * raw and place are set by inverses only: the exact line to write, and where a removed marker was.
   */
  | {
      kind: "marker";
      heading: string;
      name: string;
      attrs: Record<string, string> | null;
      expect: Record<string, string> | null;
      raw?: string;
      place?: MarkerPlace;
    };

/** The note no longer holds what the user saw (a partner changed it). Nothing was written. */
export class ConflictError extends Error {
  /** The column key as the caller wrote it in `expect`, the marker name, or "" for a deleted row that can't go back. */
  readonly field: string;
  /** What the user saw: the cell's value, or the marker's attributes ("" = empty or no marker). */
  readonly expected: string;
  /** What the note holds now, read the same way. */
  readonly actual: string;

  constructor(field: string, expected: string, actual: string, message?: string) {
    super(message ?? changedMessage(`“${field}”`, expected, actual));
    this.name = "ConflictError";
    this.field = field;
    this.expected = expected;
    this.actual = actual;
  }
}

/** The section, its table, or a column the op names isn't in the note any more. */
export class TableNotFoundError extends Error {
  /** The heading the op named. */
  readonly heading: string;

  constructor(heading: string, message = `Couldn't find “${sectionName(heading)}” in this note. It may have been moved or deleted.`) {
    super(message);
    this.name = "TableNotFoundError";
    this.heading = heading;
  }
}

/** The row the op names isn't in the table any more. Its message names the line in plain words. */
export class RowNotFoundError extends Error {
  readonly heading: string;
  readonly row: RowRef;

  constructor(heading: string, row: RowRef, title = sectionName(heading)) {
    const message =
      "index" in row
        ? `There's no line ${row.index + 1} under “${title}” any more. It may have been deleted.`
        : `${row.col.trim() === "#" ? `Number ${row.key}` : `“${row.key}”`} isn't under “${title}” any more. It may have been deleted.`;
    super(message);
    this.name = "RowNotFoundError";
    this.heading = heading;
    this.row = row;
  }
}

/**
 * The op names a row by a # or label that more than one row has, so it can't tell which one is meant. Nothing was
 * written: guessing could change the wrong line (two partners pressing Add a video at once can number two videos 3).
 */
export class AmbiguousRowError extends Error {
  readonly heading: string;
  readonly row: RowRef;

  constructor(heading: string, row: { key: string; col: string }, title: string, count: number, exact: boolean) {
    const numbered = row.col.trim() === "#";
    const what = numbered ? `are numbered ${row.key}` : exact ? `are called “${row.key}”` : `start with “${row.key}”`;
    super(`${count} lines under “${title}” ${what}, so it isn't clear which one to change. Give each its own ${numbered ? "number" : "name"} in the note, then try again.`);
    this.name = "AmbiguousRowError";
    this.heading = heading;
    this.row = row;
  }
}

export interface TableLocation {
  /** Line index of the header row. */
  headerLine: number;
  /** Line index of the |---| row under it. */
  separatorLine: number;
  /** Line index of each data row, in order. */
  rowLines: number[];
  /** First line after the table. */
  end: number;
  headers: string[];
  /** Cells as parseTable reads them (examples kept), padded to the header's length. */
  rows: string[][];
}

/**
 * The first table in the section whose heading contains `heading` (any case), found the way tableIn() finds it.
 * Lines may keep a trailing "\r". Headings inside the frontmatter never count.
 */
export function locateTable(lines: string[], heading: string): TableLocation | null {
  const r = findSection(lines, heading);
  if (!r) return null;
  for (let i = r.start; i + 1 < r.end; i++) {
    if (!isRow(lines[i]) || !SEPARATOR.test(text(lines[i + 1]))) continue;
    const headers = splitRow(text(lines[i]));
    const rowLines: number[] = [];
    let end = i + 2;
    for (; end < r.end && isRow(lines[end]); end++) rowLines.push(end);
    const rows = rowLines.map((at) => {
      const cells = splitRow(text(lines[at]));
      while (cells.length < headers.length) cells.push("");
      return cells;
    });
    return { headerLine: i, separatorLine: i + 1, rowLines, end, headers, rows };
  }
  return null;
}

/** Applies one op to a note. Returns the new text and the op that turns it back into `note`, byte for byte. */
export function applyTableOp(note: string, op: TableOp): { text: string; inverse: TableOp } {
  const lines = note.split("\n");
  // New lines end like the lines around them; this is only the fallback for a one-line note.
  const cr = note.includes("\r\n") ? "\r" : "";
  const inverse = run(lines, op, cr);
  return { text: lines.join("\n"), inverse };
}

/**
 * The rows a RowRef key names, given each row's cell in the key's column as written: every row whose cell reads as
 * the key (any case, examples stripped, <br> and \| read as typed), else, for a key that isn't a number, every row
 * whose cell starts with it. "3" never finds row 30. tableEdit, the parsers and the edit sheets all find a row this
 * way, so a sheet always watches the row its save will write.
 */
export function findRows(cells: readonly string[], key: string, exactOnly = false): number[] {
  const k = norm(key).toLowerCase();
  const values = cells.map((c) => norm(c).toLowerCase());
  const exact = values.flatMap((v, i) => (v === k ? [i] : []));
  if (exact.length || exactOnly || k === "" || /^\d+$/.test(k)) return exact;
  return values.flatMap((v, i) => (v.startsWith(k) ? [i] : []));
}

/** Cell text that can't break a table: trimmed, line breaks as <br>, and any unescaped | as \|. */
export function escapeCell(v: string): string {
  return v
    .trim()
    .replace(/\r\n|\r|\n/g, "<br>")
    .replace(/\\?\|/g, (m) => (m === "|" ? "\\|" : m));
}

/**
 * A green example: <span class="nx-eg">text</span>. Passed as a set value, it clears the cell back to exactly
 * this example (an editor can put back the hint it shows instead of the nearest row's).
 */
export function exampleSpan(text: string): string {
  return `<span class="nx-eg">${escapeCell(text)}</span>`;
}

/** [label](url) that survives a table cell: brackets in the label escaped, spaces and parentheses in the URL encoded. */
export function mdLink(label: string, url: string): string {
  const u = url.trim().replace(/\s/g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29");
  const l = label.trim().replace(/[[\]]/g, "\\$&");
  if (u === "") return l;
  return `[${l === "" ? u : l}](${u})`;
}

/**
 * Attributes of a hidden marker line such as <!-- nx-research: date=2026-11-20 checked=41 -->, found anywhere in
 * the note (names are unique) outside the frontmatter and code fences, or null when there is none.
 * The only marker reader for D4 markers.
 */
export function readMarker(body: string, name: string): Record<string, string> | null {
  const lines = body.split(/\r?\n/);
  const at = findMarker(lines, name);
  return at === -1 ? null : markerOf(lines[at])?.attrs ?? null;
}

// ---------------------------------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------------------------------

/** A line without its "\r" (a note split on "\n" keeps it). */
function text(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

function crOf(line: string): string {
  return line.endsWith("\r") ? "\r" : "";
}

function isRow(line: string): boolean {
  return text(line).trim().startsWith("|");
}

/**
 * The ending ("\r" or "") for lines put in before index `at`: that of the nearest line above that has one (the
 * note's last line has none), else `fallback`. A note whose frontmatter and tables end lines differently stays so.
 */
function eolAt(lines: string[], at: number, fallback: string): string {
  const i = Math.min(at, lines.length - 1) - 1;
  return i >= 0 ? crOf(lines[i]) : fallback;
}

/** Inserts lines before index `at` (at = lines.length appends). A note that doesn't end with a newline still doesn't. */
function insertLines(lines: string[], at: number, add: string[], cr: string): void {
  if (at < lines.length) {
    lines.splice(at, 0, ...add.map((l) => l + cr));
    return;
  }
  lines[lines.length - 1] += cr;
  lines.push(...add.map((l, i) => (i < add.length - 1 ? l + cr : l)));
}

/** Removes n lines from `at`. When that removes the last line, the line before it loses its ending, as in an editor. */
function removeLines(lines: string[], at: number, n: number): void {
  lines.splice(at, n);
  if (at === lines.length && at > 0) lines[at - 1] = text(lines[at - 1]);
}

/** Index of the first line after the frontmatter (0 when there is none). */
function bodyStart(lines: string[]): number {
  if (text(lines[0] ?? "") !== "---") return 0;
  for (let i = 1; i < lines.length; i++) if (/^---\s*$/.test(text(lines[i]))) return i + 1;
  return 0;
}

/** sectionRange over the note's body, so a frontmatter line never counts as a heading. */
function findSection(lines: string[], heading: string): SectionRange | null {
  const from = bodyStart(lines);
  const r = sectionRange(lines.slice(from), heading);
  return r && { headingLine: r.headingLine + from, start: r.start + from, end: r.end + from, level: r.level };
}

function titleOf(lines: string[], r: SectionRange): string {
  return HEADING.exec(text(lines[r.headingLine]))?.[2] ?? "";
}

// ---------------------------------------------------------------------------------------------------
// Rows and cells
// ---------------------------------------------------------------------------------------------------

interface Shape {
  /** [start, end) of each cell's text between its pipes, padding included. */
  cells: Array<[number, number]>;
  /** Index just after the trailing pipe, or null when the row has none. */
  pipeEnd: number | null;
}

/** Where each cell of a row sits in the line, split exactly as splitRow() splits it (an escaped \| stays in its cell). */
function shape(line: string): Shape {
  const end = line.trimEnd().length;
  let a = line.length - line.trimStart().length;
  let b = end;
  if (a < b && line[a] === "|") a++;
  let pipeEnd: number | null = null;
  if (a < b && line[b - 1] === "|" && !(b - 2 >= a && line[b - 2] === "\\")) {
    b--;
    pipeEnd = end;
  }
  const cells: Array<[number, number]> = [];
  let start = a;
  for (let i = a; i < b; i++) {
    if (line[i] === "\\" && i + 1 < b && line[i + 1] === "|") i++;
    else if (line[i] === "|") {
      cells.push([start, i]);
      start = i + 1;
    }
  }
  cells.push([start, b]);
  return { cells, pipeEnd };
}

/** A cell's text as written (padding included), or "" when the row is too short to have it. */
function rawCell(line: string, c: number): string {
  const span = shape(line).cells[c];
  return span ? line.slice(span[0], span[1]) : "";
}

/**
 * Width of each column in a padded table: its separator cell's width when that cell is padded the way Obsidian's
 * table editor writes it ("| --- |"), else null. A compact "|---|" separator never counts, so a cell there that
 * happens to be 3 wide isn't taken for an aligned one.
 */
function columnWidths(separator: string): Array<number | null> {
  return shape(separator).cells.map(([a, b]) => (/^\s/.test(separator.slice(a, b)) ? b - a : null));
}

/** A cell's value the way the dashboard shows it: examples stripped, "\|" as |, <br> as a line break, trimmed. */
function norm(raw: string): string {
  return stripExamples(raw)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/\\\|/g, "|")
    .trim();
}

/** Adds empty cells to the end of a short row so it has n cells. The bytes already there stay in place. */
function extendRow(line: string, n: number): string {
  const s = shape(line);
  const k = n - s.cells.length;
  if (k <= 0) return line;
  if (s.pipeEnd !== null) return line.slice(0, s.pipeEnd) + " |".repeat(k) + line.slice(s.pipeEnd);
  const end = s.cells[s.cells.length - 1][1];
  // A pipe right after a backslash would read as an escaped "\|", so it gets a space first.
  const pipe = line.slice(0, end).endsWith("\\") ? " |" : "|";
  return line.slice(0, end) + pipe + " |".repeat(k) + line.slice(end);
}

/**
 * A touched cell: one leading space, then the text. In an aligned column of a padded table (the cell is as wide
 * as its "| --- |" separator cell) shorter text is padded to that width so the pipes stay put; otherwise one
 * trailing space. An empty cell in a compact table is "| |".
 */
function cellText(value: string, width: number, aligned: boolean): string {
  if (aligned && value.length + 2 <= width) return ` ${value}`.padEnd(width);
  return value === "" ? " " : ` ${value} `;
}

/**
 * Replaces cell c's text; every other byte of the line stays. `raw` writes the bytes as given (inverses).
 * The last cell of a row without a trailing pipe gets no padding, so the line doesn't end in spaces.
 */
function putCell(line: string, c: number, value: string, sepWidth: number | null, raw: boolean): string {
  const ready = shape(line).cells.length > c ? line : extendRow(line, c + 1);
  const s = shape(ready);
  if (c >= s.cells.length) throw new Error(`Couldn't add a box to this line: “${line.trim()}”.`);
  const [a, b] = s.cells[c];
  const open = s.pipeEnd === null && c === s.cells.length - 1;
  const next = raw ? value : open ? (value === "" ? "" : ` ${value}`) : cellText(value, b - a, sepWidth === b - a);
  return ready.slice(0, a) + next + ready.slice(b);
}

// ---------------------------------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------------------------------

interface Table extends TableLocation {
  heading: string;
  title: string;
}

/** A section that isn't in the note any more (renamed or deleted heading). */
function noSection(heading: string): TableNotFoundError {
  return new TableNotFoundError(heading, `Couldn't find the “${sectionName(heading)}” part of this note. It may have been renamed or deleted.`);
}

function tableAt(lines: string[], heading: string): Table {
  const r = findSection(lines, heading);
  if (!r) throw noSection(heading);
  const t = locateTable(lines, heading);
  const title = titleOf(lines, r);
  if (!t) throw new TableNotFoundError(heading, `“${title}” has no list in this note any more.`);
  return { ...t, heading, title };
}

/** Column by key: an exact header first, then the first header containing the key (like col()), any case. */
function colIndex(t: Table, key: string): number {
  const k = key.trim().toLowerCase();
  const lower = t.headers.map((h) => h.toLowerCase());
  let i = lower.indexOf(k);
  // An empty key only finds an empty header: as part of a header it would match the first column.
  if (i === -1 && k !== "") i = lower.findIndex((h) => h.includes(k));
  if (i === -1) throw new TableNotFoundError(t.heading, `The list under “${t.title}” has no “${key}” heading any more.`);
  return i;
}

function rowIndex(t: Table, ref: RowRef): number {
  if ("index" in ref) {
    if (Number.isInteger(ref.index) && ref.index >= 0 && ref.index < t.rows.length) return ref.index;
    throw new RowNotFoundError(t.heading, ref, t.title);
  }
  const c = colIndex(t, ref.col);
  // "3" must not find row 30; labels match exactly, else by their start ("Budget" → "Budget (max $300 per sprint)").
  const found = findRows(t.rows.map((r) => r[c] ?? ""), ref.key, ref.exact === true);
  if (found.length === 0) throw new RowNotFoundError(t.heading, ref, t.title);
  if (found.length > 1) {
    const exact = norm(t.rows[found[0]][c] ?? "").toLowerCase() === norm(ref.key).toLowerCase();
    throw new AmbiguousRowError(t.heading, ref, t.title, found.length, exact);
  }
  return found[0];
}

/** The table's "#" column (a header that is exactly "#"), or -1. */
function numberColumn(t: Table): number {
  return t.headers.findIndex((h) => h.trim() === "#");
}

/** The number in a row's "#" cell, or null when the table has no "#" column or the cell holds no plain number. */
function numberOf(t: Table, line: string): number | null {
  const c = numberColumn(t);
  if (c === -1) return null;
  const v = norm(rawCell(line, c));
  return /^\d+$/.test(v) ? Number(v) : null;
}

function checkExpect(t: Table, row: number, expect: Record<string, string>): void {
  for (const [key, value] of Object.entries(expect)) {
    const c = colIndex(t, key);
    const expected = norm(value);
    const actual = norm(t.rows[row][c] ?? "");
    if (actual !== expected) throw new ConflictError(key, expected, actual, changedMessage(`“${t.headers[c]}”`, expected, actual));
  }
}

/** A 2-column Item | Value style table (Brand kit, Paid test plan, the profile): each row has its own example. */
function keyValue(t: Table): boolean {
  return t.headers.length === 2 && t.headers[0].trim() !== "#";
}

/**
 * The example a cleared cell gets when it has none of its own. In a key-value table: the template's example for
 * the row's label (brand kit, paid test plan, the profile rows), never another row's. Otherwise the example the
 * nearest other row shows in column c, rows above first; with a Rating column only from rows on the same side of
 * Don't use (D3, the same rule as ratingOf) as this row, judged from `own`, the row as this edit leaves it.
 */
function borrowExample(lines: string[], t: Table, row: number, c: number, own: string): string {
  if (keyValue(t)) return c === 0 ? "" : rowExample(t.title, norm(rawCell(own, 0)));
  const rating = ratingColumn(t.headers);
  const avoid = (line: string) => rating !== -1 && ratingOf(rawCell(line, rating)) === "avoid";
  const mine = avoid(own);
  const order: number[] = [];
  for (let r = row - 1; r >= 0; r--) order.push(r);
  for (let r = row + 1; r < t.rowLines.length; r++) order.push(r);
  for (const r of order) {
    const line = text(lines[t.rowLines[r]]);
    if (avoid(line) !== mine) continue;
    const ex = exampleIn(rawCell(line, c));
    if (ex !== "") return ex;
  }
  return "";
}

/**
 * What a cell gets for `value`, or null when it already shows that value. A cleared cell gets an example back:
 * its own, else the one borrowExample finds. A value that is itself an example span is written as given.
 */
function nextText(current: string, value: string, borrow: () => string): string | null {
  const v = escapeCell(value);
  const given = exampleIn(v);
  if (norm(v) === norm(current) && (given === "" || given === exampleIn(current))) return null;
  if (norm(v) !== "" || given !== "") return v;
  const ex = exampleIn(current) || borrow();
  return ex === "" ? "" : exampleSpan(ex);
}

interface Write {
  row: number;
  /** [column, value]: text to escape, or exact cell bytes when raw. */
  cells: Array<[number, string]>;
  raw: boolean;
  line?: string;
}

/** Resolves every row and column and checks every expect, before anything changes. */
function planEdits(t: Table, edits: RowEdit[]): Write[] {
  return edits.map((e) => {
    const row = rowIndex(t, e.row);
    checkExpect(t, row, e.expect);
    const cells = Object.entries(e.values).map(([k, v]): [number, string] => [colIndex(t, k), v]);
    return { row, cells, raw: e.raw === true, line: e.line };
  });
}

/** Writes the cells and returns the edits that put each changed row back. */
function applyWrites(lines: string[], t: Table, writes: Write[]): RowEdit[] {
  const widths = columnWidths(text(lines[t.separatorLine]));
  const rating = ratingColumn(t.headers);
  const before = new Map<number, string>();
  for (const w of writes) {
    const at = t.rowLines[w.row];
    let line = text(lines[at]);
    if (!before.has(w.row)) before.set(w.row, line);
    if (w.line !== undefined) line = text(w.line);
    else {
      // The Rating cell goes first, so a cell cleared in the same edit takes its example by the new rating.
      const cells = [...w.cells].sort(([a], [b]) => Number(b === rating) - Number(a === rating));
      for (const [c, value] of cells) {
        if (w.raw) {
          line = putCell(line, c, value, null, true);
          continue;
        }
        const own = line;
        const next = nextText(rawCell(line, c), value, () => borrowExample(lines, t, w.row, c, own));
        if (next !== null) line = putCell(line, c, next, widths[c] ?? null, false);
      }
    }
    lines[at] = line + crOf(lines[at]);
  }
  return [...before].flatMap(([row, old]) => undoRow(t, row, old, text(lines[t.rowLines[row]])));
}

/** Two rowExpect results hold the same text in every column. */
function sameCells(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k]);
}

/** What a row shows in every column, keyed by header, the way checkExpect reads it (a repeated header only once). */
function rowExpect(t: Table, line: string): Record<string, string> {
  const out: Record<string, string> = {};
  t.headers.forEach((h, c) => {
    if (colIndex(t, h) === c) out[h] = norm(rawCell(line, c));
  });
  return out;
}

/**
 * The edit that turns row `now` back into `old`: the old bytes of each changed cell, or the whole old line when
 * cells were added (or a changed column can't be named). It expects the whole row as `now` has it, so it refuses
 * rather than write into another row when a partner has added or deleted a row above it since.
 */
function undoRow(t: Table, row: number, old: string, now: string): RowEdit[] {
  if (old === now) return [];
  const expect = rowExpect(t, now);
  const o = shape(old).cells;
  const n = shape(now).cells;
  const values: Record<string, string> = {};
  let exact = o.length === n.length;
  n.forEach(([a, b], c) => {
    if (!exact) return;
    const was = old.slice(o[c][0], o[c][1]);
    if (was === now.slice(a, b)) return;
    if (c < t.headers.length && colIndex(t, t.headers[c]) === c) values[t.headers[c]] = was;
    else exact = false;
  });
  if (!exact) return [{ row: { index: row }, values: {}, expect, line: old }];
  return [{ row: { index: row }, values, expect, raw: true }];
}

/** The next number for a "#" column: the largest one there + 1, or 1. */
function nextNumber(t: Table, c: number): number {
  const nums = t.rows.map((r) => norm(r[c] ?? "")).filter((s) => /^\d+$/.test(s)).map(Number);
  return Math.max(0, ...nums) + 1;
}

/** A new row in the table's own style: indent and trailing pipe from the last row, padding when the table is padded. */
function newRow(lines: string[], t: Table, values: Map<number, string>): string {
  const style = text(lines[t.rowLines.length ? t.rowLines[t.rowLines.length - 1] : t.headerLine]);
  const lead = style.slice(0, style.length - style.trimStart().length);
  const head = shape(text(lines[t.headerLine])).cells;
  const widths = columnWidths(text(lines[t.separatorLine]));
  const texts = t.headers.map((_, c) => escapeCell(values.get(c) ?? ""));
  const cells = texts.map((v, c) => {
    const w = widths[c] ?? null;
    const aligned = w !== null && !!head[c] && head[c][1] - head[c][0] === w;
    return cellText(v, w ?? 0, aligned);
  });
  const body = `${lead}|${cells.join("|")}`;
  // Without a trailing pipe an empty last cell would vanish, so that row gets one.
  return shape(style).pipeEnd !== null || texts[texts.length - 1] === "" ? `${body}|` : body.trimEnd();
}

// ---------------------------------------------------------------------------------------------------
// Ops
// ---------------------------------------------------------------------------------------------------

type Op<K extends TableOp["kind"]> = Extract<TableOp, { kind: K }>;

function run(lines: string[], op: TableOp, cr: string): TableOp {
  switch (op.kind) {
    case "set":
      return setOp(lines, op);
    case "insert":
      return insertOp(lines, op, cr);
    case "delete":
      return deleteOp(lines, op);
    case "restore":
      return restoreOp(lines, op, cr);
    case "marker":
      return markerOp(lines, op, cr);
  }
}

function setOp(lines: string[], op: Op<"set">): TableOp {
  const t = tableAt(lines, op.heading);
  const writes = planEdits(t, op.edits);
  return { kind: "set", heading: op.heading, edits: applyWrites(lines, t, writes) };
}

function insertOp(lines: string[], op: Op<"insert">, cr: string): TableOp {
  const t = tableAt(lines, op.heading);
  const values = new Map<number, string>();
  for (const [k, v] of Object.entries(op.values)) values.set(colIndex(t, k), v);
  const num = op.numberCol === undefined ? -1 : colIndex(t, op.numberCol);
  const skip = (c: number) => c === num || t.headers[c].trim() === "#";
  const free = t.rows.findIndex((r) => t.headers.every((_, c) => skip(c) || isPlaceholder(r[c] ?? "")));
  if (num >= 0 && isPlaceholder(values.get(num) ?? "")) {
    values.delete(num);
    if (free === -1 || isPlaceholder(t.rows[free][num] ?? "")) values.set(num, String(nextNumber(t, num)));
  }
  if (free !== -1) {
    const edits = applyWrites(lines, t, [{ row: free, cells: [...values], raw: false }]);
    // A filled row with a number of its own is taken back by that number, like an added one, so its Undo still
    // works after a partner (or another Undo) adds or deletes a row above it.
    const n = numberOf(t, text(lines[t.rowLines[free]]));
    const c = numberColumn(t);
    const own = n !== null && t.rows.filter((r, i) => i !== free && norm(r[c] ?? "") === String(n)).length === 0;
    return { kind: "set", heading: op.heading, edits: own ? edits.map((e) => ({ ...e, row: { key: String(n), col: "#" } })) : edits };
  }

  const row = newRow(lines, t, values);
  const at = (t.rowLines.length ? t.rowLines[t.rowLines.length - 1] : t.separatorLine) + 1;
  insertLines(lines, at, [row], eolAt(lines, at, cr));
  // A numbered row is taken back by its number, so undoing an earlier add or delete first doesn't move it.
  const n = numberOf(t, row);
  const ref: RowRef = n !== null && !t.rows.some((r) => norm(r[numberColumn(t)] ?? "") === String(n)) ? { key: String(n), col: "#" } : { index: t.rows.length };
  return { kind: "delete", heading: op.heading, row: ref, expect: rowExpect(t, row), evenIfLast: true };
}

function deleteOp(lines: string[], op: Op<"delete">): TableOp {
  const t = tableAt(lines, op.heading);
  const row = rowIndex(t, op.row);
  checkExpect(t, row, op.expect);
  if (t.rows.length === 1 && op.evenIfLast !== true) {
    const cells = t.headers.flatMap((h, c): Array<[number, string]> => (h.trim() === "#" ? [] : [[c, ""]]));
    return { kind: "set", heading: op.heading, edits: applyWrites(lines, t, [{ row, cells, raw: false }]) };
  }
  const raw = text(lines[t.rowLines[row]]);
  const n = numberOf(t, raw);
  const sameNumber = n === null ? undefined : t.rowLines.filter((at, i) => i !== row && numberOf(t, text(lines[at])) === n).length;
  removeLines(lines, t.rowLines[row], 1);
  return { kind: "restore", heading: op.heading, at: row, raw, rows: t.rows.length - 1, ...(sameNumber === undefined ? {} : { sameNumber }) };
}

function restoreOp(lines: string[], op: Op<"restore">, cr: string): TableOp {
  const t = tableAt(lines, op.heading);
  const raw = text(op.raw);
  if (!raw.trim().startsWith("|") || /[\r\n]/.test(raw)) throw new Error("Can't put that line back: it isn't a single line of a list.");
  const n = numberOf(t, raw);
  let want = Number.isFinite(op.at) ? Math.floor(op.at) : t.rows.length;
  if (n !== null) {
    // A numbered line: refused only when it's back already (a line with the same cells), so the Undos of several
    // deletes work in any order. It goes back before the first line with a higher number.
    const same = rowExpect(t, raw);
    if (t.rowLines.some((at) => sameCells(rowExpect(t, text(lines[at])), same))) {
      throw new ConflictError("", "", "", `That line is back under “${t.title}” already, so it wasn't put back again.`);
    }
    // Its number went to another line since (a video added in the meantime): two lines with one number would make
    // every later edit or Undo of that number fail, so it stays out.
    if (op.sameNumber !== undefined && t.rowLines.filter((at) => numberOf(t, text(lines[at])) === n).length > op.sameNumber) {
      throw new ConflictError("", String(n), String(n), `Number ${n} was given to another line under “${t.title}” since, so the deleted one wasn't put back.`);
    }
    const higher = t.rowLines.findIndex((at) => (numberOf(t, text(lines[at])) ?? -1) > n);
    if (higher !== -1) want = higher;
  } else if (op.rows !== undefined && t.rows.length !== op.rows) {
    const count = (k: number) => `${k} ${k === 1 ? "line" : "lines"}`;
    throw new ConflictError(
      "",
      String(op.rows),
      String(t.rows.length),
      `“${t.title}” changed since that line was deleted: it has ${count(t.rows.length)} now (it had ${count(op.rows)}), so the line wasn't put back. It may be back already.`,
    );
  }
  const at = Math.min(Math.max(0, want), t.rows.length);
  const pos = at < t.rowLines.length ? t.rowLines[at] : (t.rowLines.length ? t.rowLines[t.rowLines.length - 1] : t.separatorLine) + 1;
  insertLines(lines, pos, [raw], eolAt(lines, pos, cr));
  return { kind: "delete", heading: op.heading, row: { index: at }, expect: rowExpect(t, raw), evenIfLast: true };
}

// ---------------------------------------------------------------------------------------------------
// Markers (D4): single-line HTML comments at the end of a section, in a fixed order
// ---------------------------------------------------------------------------------------------------

/** D4 order of the markers at the end of section 1. */
const MARKER_ORDER = ["nx-research", "nx-research-request", "nx-reviewed"];

const MARKER_LABEL: Record<string, string> = {
  "nx-research": "The research result",
  "nx-research-request": "The research request",
  "nx-reviewed": "The review mark",
};

const MARKER_LINE = /^\s*<!--\s*([A-Za-z0-9_-]+):(.*?)-->\s*$/;
const WORD = /^[A-Za-z0-9_-]+$/;

function markerOf(line: string): { name: string; attrs: Record<string, string> } | null {
  const m = MARKER_LINE.exec(text(line));
  if (!m) return null;
  const attrs: Record<string, string> = {};
  for (const part of m[2].trim().split(/\s+/)) {
    const i = part.indexOf("=");
    if (i > 0) attrs[part.slice(0, i)] = part.slice(i + 1);
  }
  return { name: m[1], attrs };
}

const isNxMarker = (line: string | undefined) => line !== undefined && (markerOf(line)?.name.startsWith("nx-") ?? false);

/** Line index of the marker named `name`, skipping the frontmatter and code fences, or -1. */
function findMarker(lines: string[], name: string): number {
  let inFence = false;
  for (let i = bodyStart(lines); i < lines.length; i++) {
    if (FENCE.test(text(lines[i]))) inFence = !inFence;
    else if (!inFence && markerOf(lines[i])?.name === name) return i;
  }
  return -1;
}

/** <!-- name: k=v k=v -->. Empty values are left out; values can't hold spaces (D4). */
function markerLine(name: string, attrs: Record<string, string>): string {
  if (!WORD.test(name)) throw new Error(`Can't save “${name}”: it isn't a name the dashboard writes.`);
  const pairs = Object.entries(attrs)
    .filter(([, v]) => v.trim() !== "")
    .map(([k, v]) => {
      if (!WORD.test(k) || /\s/.test(v.trim()) || v.includes("-->")) throw new Error(`Can't save “${k}=${v}”: it can't hold spaces.`);
      return `${k}=${v.trim()}`;
    });
  return ["<!--", `${name}:`, ...pairs, "-->"].join(" ");
}

function cleanAttrs(a: Record<string, string> | null): Record<string, string> | null {
  return a && Object.fromEntries(Object.entries(a).filter(([, v]) => v.trim() !== "").map(([k, v]) => [k, v.trim()]));
}

function sameAttrs(x: Record<string, string> | null, y: Record<string, string> | null): boolean {
  const a = cleanAttrs(x);
  const b = cleanAttrs(y);
  if (a === null || b === null) return a === b;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => Object.prototype.hasOwnProperty.call(b, k) && a[k] === b[k]);
}

const showAttrs = (a: Record<string, string> | null) => (a === null ? "" : Object.entries(a).map(([k, v]) => `${k}=${v}`).join(" "));

/**
 * A new marker: next to the section's other D4 markers in D4 order, or else after the section's last line of
 * content (its table, the "How these 3 were picked" callout, …) with a blank line before it and one after.
 */
function insertMarker(lines: string[], r: SectionRange, name: string, line: string, cr: string): void {
  const rank = (n: string) => (MARKER_ORDER.includes(n) ? MARKER_ORDER.indexOf(n) : MARKER_ORDER.length);
  const own = rank(name);
  const present: Array<{ at: number; rank: number }> = [];
  let inFence = false;
  for (let i = r.start; i < r.end; i++) {
    if (FENCE.test(text(lines[i]))) inFence = !inFence;
    const m = inFence ? null : markerOf(lines[i]);
    if (m && MARKER_ORDER.includes(m.name)) present.push({ at: i, rank: rank(m.name) });
  }
  const put = (at: number, add: string[]) => insertLines(lines, at, add, eolAt(lines, at, cr));
  if (present.length) {
    const before = present.filter((p) => p.rank < own);
    if (before.length) {
      const p = before.reduce((x, y) => (y.rank > x.rank || (y.rank === x.rank && y.at > x.at) ? y : x));
      put(p.at + 1, [line]);
    } else {
      const p = present.reduce((x, y) => (y.rank < x.rank || (y.rank === x.rank && y.at < x.at) ? y : x));
      put(p.at, [line]);
    }
    return;
  }
  let last = r.end - 1;
  while (last >= r.start && text(lines[last]).trim() === "") last--;
  if (last < r.start) last = r.headingLine;
  // After the blank line under the content, with a new blank below; or, with no blank there, a new one above.
  if (last + 1 < r.end) put(last + 2, [line, ""]);
  else put(last + 1, ["", line]);
}

/**
 * Removes a marker line and, when it stands alone, one blank line next to it, so a removal mirrors insertMarker:
 * the blank below when both neighbours are blank (that's the one insertMarker added), else the blank above.
 */
function removeMarker(lines: string[], at: number): MarkerPlace {
  const alone = !isNxMarker(lines[at - 1]) && !isNxMarker(lines[at + 1]);
  const isBlank = (i: number) => i >= 0 && i < lines.length && text(lines[i]).trim() === "";
  const blank: MarkerPlace["blank"] = !alone ? false : isBlank(at - 1) && isBlank(at + 1) ? "below" : isBlank(at - 1) ? "above" : false;
  const index = blank === "above" ? at - 1 : at;
  const place = { index, prev: index > 0 ? text(lines[index - 1]) : "", blank };
  removeLines(lines, index, blank ? 2 : 1);
  return place;
}

function markerOp(lines: string[], op: Op<"marker">, cr: string): TableOp {
  const r = findSection(lines, op.heading);
  if (!r) throw noSection(op.heading);
  const at = findMarker(lines, op.name);
  const current = at === -1 ? null : markerOf(lines[at])?.attrs ?? null;
  if (!sameAttrs(current, op.expect)) throw new ConflictError(op.name, showAttrs(cleanAttrs(op.expect)), showAttrs(current), markerMessage(op.name, op.expect, current));
  const base = { kind: "marker" as const, heading: op.heading, name: op.name };

  if (op.attrs === null) {
    if (at === -1) return { ...base, attrs: null, expect: null };
    const raw = text(lines[at]);
    return { ...base, attrs: current, expect: null, raw, place: removeMarker(lines, at) };
  }

  const line = op.raw !== undefined ? text(op.raw) : markerLine(op.name, op.attrs);
  const written = markerOf(line);
  if (!written || written.name !== op.name) throw new Error(`Can't save that line: it isn't one the dashboard writes for ${MARKER_LABEL[op.name]?.toLowerCase() ?? op.name}.`);
  if (at !== -1) {
    const old = text(lines[at]);
    if (old === line || (op.raw === undefined && sameAttrs(current, written.attrs))) return { ...base, attrs: current, expect: current };
    lines[at] = line + crOf(lines[at]);
    return { ...base, attrs: current, expect: written.attrs, raw: old };
  }
  const p = op.place;
  if (p && p.index >= 0 && p.index <= lines.length && (p.index === 0 ? p.prev === "" : text(lines[p.index - 1]) === p.prev)) {
    const add = p.blank === "above" ? ["", line] : p.blank === "below" ? [line, ""] : [line];
    insertLines(lines, p.index, add, eolAt(lines, p.index, cr));
  } else {
    insertMarker(lines, r, op.name, line, cr);
  }
  return { ...base, attrs: null, expect: written.attrs };
}

// ---------------------------------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------------------------------

function changedMessage(label: string, expected: string, actual: string): string {
  const now = actual === "" ? "it's empty now" : `it now says “${actual}”`;
  const was = expected === "" ? "it was empty" : `it said “${expected}”`;
  return `${label} changed in the note since you opened it: ${now} (${was}).`;
}

function markerMessage(name: string, expected: Record<string, string> | null, actual: Record<string, string> | null): string {
  const label = MARKER_LABEL[name] ?? "A hidden line the dashboard keeps";
  const what = actual === null ? "it's gone now" : expected === null ? "someone added it" : "it says something else now";
  return `${label} changed in the note since you opened it: ${what}.`;
}
