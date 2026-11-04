// Company-level checklists: SETUP_CHECKLIST.md and Business Model §8 ("Current status").

import { checklistLines, plainText, section } from "./markdown";
import { ChecklistItem, Role } from "./types";

function ownerFromTags(source: string): Role {
  const dev = /(^|\s)#dev\b/i.test(source);
  const mkt = /(^|\s)#marketing\b/i.test(source);
  if (dev && !mkt) return "dev";
  if (mkt && !dev) return "marketing";
  return "both";
}

const stripTags = (s: string) => s.replace(/(^|\s)#(dev|marketing)\b/gi, "").replace(/\s{2,}/g, " ").trim();

/** Top-level checklist lines become items; indented bullets right under them (checkbox or not) become details. */
export function parseChecklistNote(body: string, path: string, onlySection?: string): ChecklistItem[] {
  const text = onlySection ? section(body, onlySection) ?? "" : body;
  const items: ChecklistItem[] = [];
  const boxes = new Map(checklistLines(text).map((l) => [l.index, l]));
  let last: ChecklistItem | null = null;
  text.split(/\r?\n/).forEach((raw, index) => {
    const box = boxes.get(index);
    if (box && box.indent === 0) {
      last = { text: stripTags(box.text), raw: box.raw, checked: box.checked, group: box.heading, owner: ownerFromTags(box.source), details: [], path };
      items.push(last);
      return;
    }
    const nested = /^(\t|\s{2,})[-*+]\s+(?:\[[ xX]\]\s*)?(.*)$/.exec(raw);
    if (nested && last) {
      last.details.push(stripTags(plainText(nested[2].replace(/\*\*/g, ""))));
      return;
    }
    if (raw.trim() !== "") last = null;
  });
  return items;
}

const STOP = new Set(["the", "and", "for", "with", "all", "our", "each", "set", "add", "get", "via", "your", "from", "into", "files", "file"]);

function words(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9$]+/)
      .filter((w) => w.length >= 3 && !STOP.has(w)),
  );
}

/** Business Model §8 mirrors the checklist; keep only items the checklist doesn't already cover. */
export function uniqueBusinessItems(business: ChecklistItem[], setup: ChecklistItem[]): ChecklistItem[] {
  const setupWords = setup.map((s) => words(s.text));
  return business.filter((b) => {
    const w = [...words(b.text)];
    if (!w.length) return false;
    return !setupWords.some((sw) => w.filter((x) => sw.has(x)).length / w.length >= 0.6);
  });
}
