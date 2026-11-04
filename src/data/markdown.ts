// Markdown readers for the sprint templates. Tables are found by heading text and columns by
// header name (not position), so small edits to a note don't break the dashboard.

export interface Table {
  headers: string[];
  rows: string[][];
}

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const FENCE = /^\s*(```|~~~)/;

/** Text under the first heading whose title contains `key` (case-insensitive), up to the next heading of the same or higher level. */
export function section(body: string, key: string): string | null {
  const lines = body.split(/\r?\n/);
  const needle = key.toLowerCase();
  let inFence = false;
  let start = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (FENCE.test(line)) inFence = !inFence;
    if (inFence) continue;
    const m = HEADING.exec(line);
    if (!m) continue;
    if (start === -1) {
      if (m[2].toLowerCase().includes(needle)) {
        start = i + 1;
        level = m[1].length;
      }
    } else if (m[1].length <= level) {
      return lines.slice(start, i).join("\n");
    }
  }
  return start === -1 ? null : lines.slice(start).join("\n");
}

/** Split a table row on unescaped pipes. `[[a\|b]]` (Obsidian alias inside a table) stays one cell. */
export function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\" && s[i + 1] === "|") {
      cur += "\\|";
      i++;
    } else if (ch === "|") {
      cells.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

const SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/** First markdown table in `text`. */
export function parseTable(text: string | null): Table | null {
  if (!text) return null;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].trim().startsWith("|") || !SEPARATOR.test(lines[i + 1])) continue;
    const headers = splitRow(lines[i]);
    const rows: string[][] = [];
    for (let j = i + 2; j < lines.length && lines[j].trim().startsWith("|"); j++) {
      const cells = splitRow(lines[j]);
      while (cells.length < headers.length) cells.push("");
      rows.push(cells);
    }
    return { headers, rows };
  }
  return null;
}

export function tableIn(body: string, headingKey: string): Table | null {
  return parseTable(section(body, headingKey));
}

/** Index of the first header containing any of the keys (case-insensitive), or -1. */
export function col(table: Table, ...keys: string[]): number {
  const lower = table.headers.map((h) => h.toLowerCase());
  for (const k of keys) {
    const i = lower.findIndex((h) => h.includes(k.toLowerCase()));
    if (i !== -1) return i;
  }
  return -1;
}

export function cell(row: string[], index: number): string {
  return index >= 0 ? (row[index] ?? "").trim() : "";
}

/** "$1,240.50" → 1240.5, "0.9%" → 0.9, "" → null. */
export function num(s: string): number | null {
  const cleaned = s.replace(/[$,%\s]/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function isChecked(s: string): boolean {
  return /\[[xX]\]/.test(s);
}

/** Markdown list checkboxes (`- [ ]` / `- [x]`). Table cells like `| [ ] |` are not counted. */
export function countCheckboxes(text: string): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*[-*+]\s+\[([ xX])\]/.exec(line);
    if (!m) continue;
    total++;
    if (m[1] !== " ") done++;
  }
  return { done, total };
}

/** Removes `[[path|alias]]` → alias, `[[path]]` → last path segment, `[text](url)` → text, backticks. */
export function plainText(s: string): string {
  return s
    .replace(/\[\[([^\]|]+?)(?:\\?\|([^\]]+))?\]\]/g, (_m, p: string, a?: string) => a ?? p.split("/").pop() ?? p)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`/g, "")
    .trim();
}

export interface ChecklistLine {
  /** Index in the note's lines. */
  index: number;
  raw: string;
  indent: number;
  checked: boolean;
  /** Text after the checkbox, plain (no link syntax). */
  text: string;
  /** Text after the checkbox, as written. */
  source: string;
  /** Nearest heading above. */
  heading: string;
}

/** Every "- [ ]" / "- [x]" line, with its heading and indent level (tabs or 2+ spaces = nested). */
export function checklistLines(body: string): ChecklistLine[] {
  const out: ChecklistLine[] = [];
  let heading = "";
  let inFence = false;
  body.split(/\r?\n/).forEach((line, index) => {
    if (FENCE.test(line)) inFence = !inFence;
    if (inFence) return;
    const h = HEADING.exec(line);
    if (h) {
      heading = h[2].trim();
      return;
    }
    const m = /^(\s*)[-*+]\s+\[([ xX])\]\s?(.*)$/.exec(line);
    if (!m) return;
    const indent = m[1].replace(/\t/g, "  ").length >= 2 ? 1 : 0;
    out.push({ index, raw: line, indent, checked: m[2] !== " ", text: plainText(m[3].replace(/\*\*/g, "")), source: m[3], heading });
  });
  return out;
}
