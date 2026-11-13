// Markdown readers for the sprint templates. Tables are found by heading text and columns by
// header name (not position), so small edits to a note don't break the dashboard.

import type { LinkRef } from "./types";

export interface Table {
  headers: string[];
  rows: string[][];
}

/** A heading line: group 1 is the #s, group 2 the title. */
export const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
/** A line that opens or closes a code fence. */
export const FENCE = /^\s*(```|~~~)/;

export interface SectionRange {
  /** Index of the heading line. */
  headingLine: number;
  /** First line after the heading. */
  start: number;
  /** Index of the next heading of the same or higher level, or lines.length. The section is lines[start..end). */
  end: number;
  /** Heading level, 1–6. */
  level: number;
}

/**
 * Where the first heading whose title contains `key` (case-insensitive) is, and where its section ends.
 * Headings inside code fences don't count. Lines may keep a trailing "\r" (a note split on "\n" only).
 */
export function sectionRange(lines: string[], key: string): SectionRange | null {
  const needle = key.toLowerCase();
  let inFence = false;
  let found: { headingLine: number; level: number } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, "");
    if (FENCE.test(line)) inFence = !inFence;
    if (inFence) continue;
    const m = HEADING.exec(line);
    if (!m) continue;
    if (!found) {
      if (m[2].toLowerCase().includes(needle)) found = { headingLine: i, level: m[1].length };
    } else if (m[1].length <= found.level) {
      return { ...found, start: found.headingLine + 1, end: i };
    }
  }
  return found ? { ...found, start: found.headingLine + 1, end: lines.length } : null;
}

/** Text under the first heading whose title contains `key` (case-insensitive), up to the next heading of the same or higher level. */
export function section(body: string, key: string): string | null {
  const lines = body.split(/\r?\n/);
  const r = sectionRange(lines, key);
  return r ? lines.slice(r.start, r.end).join("\n") : null;
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

/** The |---|---| line under a table header (compact or padded). */
export const SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

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

// Green examples: <span class="nx-eg">e.g. …</span> in an otherwise empty cell. They show the shape of an
// answer and never count as filled. Live Preview can leave half a span behind, so both halves are handled.
const EXAMPLE_OPEN = String.raw`<span\b[^>]*?\sclass\s*=\s*(?:"(?:[^"]*\s)?nx-eg(?:\s[^"]*)?"|'(?:[^']*\s)?nx-eg(?:\s[^']*)?')[^>]*>`;

/** An opening example tag: either quote style, other attributes allowed, any case. Not global, so test() and exec() are safe. */
export const EXAMPLE_OPEN_RE = new RegExp(EXAMPLE_OPEN, "i");

/**
 * One complete example span; group 1 is its inner text. Global: use it with replace(), match() or matchAll().
 * The inner text never holds another span tag, so a half-deleted span can't swallow the next one.
 */
export const EXAMPLE_RE = new RegExp(String.raw`${EXAMPLE_OPEN}((?:(?!</?span\b)[\s\S])*)</span\s*>`, "gi");

const SPAN_TAG = /<(\/?)span\b[^>]*>/gi;
const NEXT_SPAN_TAG = /<\/?span\b[^>]*>/i;

/**
 * Removes green examples: complete spans, a half-deleted opening tag (from the tag to the end of the string)
 * and a lone </span> whose opening tag is gone. Other text and other spans stay as written.
 */
export function stripExamples(s: string): string {
  let out = s.replace(EXAMPLE_RE, "");
  const half = EXAMPLE_OPEN_RE.exec(out);
  if (half) out = out.slice(0, half.index);
  let depth = 0;
  return out.replace(SPAN_TAG, (tag: string, close: string) => {
    if (!close) {
      depth++;
      return tag;
    }
    if (depth > 0) {
      depth--;
      return tag;
    }
    return "";
  });
}

/** Trimmed inner text of the first example span (complete or half-deleted), or "". */
export function exampleIn(s: string): string {
  const m = EXAMPLE_OPEN_RE.exec(s);
  if (!m) return "";
  const rest = s.slice(m.index + m[0].length);
  const end = rest.search(NEXT_SPAN_TAG);
  return (end === -1 ? rest : rest.slice(0, end)).trim();
}

const PLACEHOLDER_WORD = /^(?:tbd|todo|\?+|-|—|–|n\/?a|none)$/i;

/**
 * True when a value isn't a real answer yet. competitor-scout's is_placeholder uses the same rule, so the
 * dashboard's "Ready for research" and `scout profile` agree. Examples are stripped first, then the value is
 * trimmed and loses surrounding straight double quotes. Then: empty, a "___" blank, exactly TBD / TODO / ? / ?? /
 * - / — / – / n/a / na / none (any case), a "MISSING:" line from research, or left-over example text ("e.g. …").
 */
export function isPlaceholder(v: string): boolean {
  const s = stripExamples(v).trim().replace(/^"+|"+$/g, "").trim();
  return s === "" || s.includes("___") || PLACEHOLDER_WORD.test(s) || /^missing:/i.test(s) || /^e\.g\./i.test(s);
}

/** A cell's typed text. Green examples are stripped, so a cell that only holds an example is "". */
export function cell(row: string[], index: number): string {
  return index >= 0 ? stripExamples(row[index] ?? "").trim() : "";
}

/** "$1,240.50" → 1240.5, "0.9%" → 0.9, "" → null. */
export function num(s: string): number | null {
  const cleaned = s.replace(/[$,%\s]/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** A property value as text: lists joined with ", ", null and undefined as "", trimmed. */
export function str(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.map(str).join(", ");
  return String(v).trim();
}

/** A property link like "[[04_Company_Ops/Categories/Audio_Plugins|Audio Plugins]]": its path and title, or null. */
export function parseLink(v: unknown): LinkRef | null {
  const m = /\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]/.exec(str(v));
  if (!m) return null;
  const path = m[1].replace(/\.md$/, "").trim();
  return { path, title: (m[2] ?? path.split("/").pop() ?? path).trim() };
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

/** Removes green examples, `[[path|alias]]` → alias, `[[path]]` → last path segment, `[text](url)` → text, backticks. */
export function plainText(s: string): string {
  return stripExamples(s)
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
