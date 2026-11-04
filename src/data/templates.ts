// New-sprint files and line-level frontmatter edits. Pure string work, tested against the real templates.
// Frontmatter is edited line by line (not re-serialized), so a write changes only the lines it means to:
// field order, empty values and everything else stay byte-for-byte the same.

import { addDays } from "./dates";
import { DOC_FILES, DocKey, LinkRef } from "./types";

export interface NewSprintInput {
  name: string;
  productType: string;
  pitch: string;
  mechanics: string[];
  tiktok: string;
  instagram: string;
  youtube: string;
  repoUrl: string;
  category: LinkRef | null;
  originIdea: LinkRef | null;
}

export const TEMPLATE_FILES: Record<DocKey, string> = {
  spec: "TPL_1_Dev_Spec.md",
  marketing: "TPL_2_Marketing_Engine.md",
  analytics: "TPL_3_Analytics_And_Gate.md",
  launch: "TPL_4_Launch_Checklist.md",
  changelog: "TPL_5_Changelog.md",
  audit: "TPL_6_RedTeam_Audit.md",
};

/** "VocalChain AI!" → "VocalChain_AI". Folder names match the vault's existing style (Demo_Game). */
export function sanitizeName(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9_-]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

/** YAML-safe scalar. Handles like "@name", links and URLs must be quoted. */
export function yamlValue(v: string): string {
  const s = v.trim();
  if (s === "") return "";
  if (/^[A-Za-z0-9][A-Za-z0-9 _.\/-]*$/.test(s) && !/^(true|false|null|yes|no|~)$/i.test(s)) return s;
  return JSON.stringify(s);
}

export const wikilink = (l: LinkRef) => `[[${l.path}|${l.title}]]`;

const FM = /^---\r?\n([\s\S]*?)\r?\n---/;

/** Raw text after `key:` for every top-level frontmatter line. */
export function readFrontmatterRaw(raw: string): Record<string, string> {
  const m = FM.exec(raw);
  const out: Record<string, string> = {};
  if (!m) return out;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_]+):[ \t]?(.*)$/.exec(line);
    if (kv) out[kv[1]] = kv[2];
  }
  return out;
}

/**
 * Sets top-level frontmatter lines to already-YAML-formatted values (use yamlValue for user text).
 * Missing keys are appended at the end of the frontmatter.
 */
export function setFrontmatterRaw(raw: string, values: Record<string, string>): string {
  const m = FM.exec(raw);
  if (!m) return raw;
  const pending = new Set(Object.keys(values));
  const line = (k: string) => (values[k] === "" ? `${k}: ` : `${k}: ${values[k]}`);
  const lines = m[1].split(/\r?\n/).map((l) => {
    const k = /^([A-Za-z0-9_]+):/.exec(l)?.[1];
    if (k && k in values) {
      pending.delete(k);
      return line(k);
    }
    return l;
  });
  for (const k of pending) lines.push(line(k));
  const joined = lines.join("\n");
  return raw.replace(m[1], () => joined);
}

function links(folder: string, display: string) {
  const base = `02_Active_Sprints/${folder}`;
  return {
    hub: { path: `${base}/${folder}_Hub`, title: `${display} Hub` },
    breadcrumbDoc: `[[02_Active_Sprints/Master_Kanban|🏠 All Products]] ▸ [[${base}/${folder}_Hub|${display}]] · [[${base}/2_Marketing_Engine|📈 Marketing]] · [[${base}/1_Dev_Spec|💻 Dev]]`,
    breadcrumbHub: `[[02_Active_Sprints/Master_Kanban|🏠 All Products]] ▸ **${display}** · [[${base}/2_Marketing_Engine|📈 Marketing]] · [[${base}/1_Dev_Spec|💻 Dev]]`,
    doc: (k: DocKey, label: string) => `[[${base}/${DOC_FILES[k]}|${label}]]`,
  };
}

export function fillTemplate(doc: DocKey, raw: string, input: NewSprintInput, today: string, startNow: boolean): string {
  const folder = sanitizeName(input.name);
  const display = folder.replace(/_/g, " ");
  const l = links(folder, display);
  let out = raw.replace(/\{\{date(?::YYYY-MM-DD)?\}\}/g, today);

  const values: Record<string, string> = {
    project: folder,
    hub: yamlValue(wikilink(l.hub)),
    sprint_status: startNow ? "building" : "queued",
    cycle_start: startNow ? today : "",
    gate_date: startNow ? addDays(today, 27) : "",
  };
  if (doc === "spec") {
    values.product_type = yamlValue(input.productType);
    values.repo_url = yamlValue(input.repoUrl);
  }
  if (doc === "marketing") {
    values.tiktok = yamlValue(input.tiktok);
    values.instagram = yamlValue(input.instagram);
    values.youtube = yamlValue(input.youtube);
  }
  // Only fill keys the template already has (formatting lock: no new fields).
  const existing = readFrontmatterRaw(out);
  out = setFrontmatterRaw(out, Object.fromEntries(Object.entries(values).filter(([k]) => k in existing)));

  // "# Dev Spec" → "# Demo Game: Dev Spec" + the breadcrumb line the vault uses under every H1.
  out = out.replace(/^# (?!.*:)(.+)$/m, (_m, title: string) => `# ${display}: ${title}\n\n${l.breadcrumbDoc}`);

  if (doc === "spec") {
    let heading = "";
    let pitchDone = false;
    out = out
      .split("\n")
      .map((line) => {
        const h = /^#{1,6}\s+(.*)$/.exec(line);
        if (h) {
          heading = h[1].toLowerCase();
          return line;
        }
        if (heading.includes("pitch") && !pitchDone && /^>\s*$/.test(line) && input.pitch.trim()) {
          pitchDone = true;
          return `> ${input.pitch.trim()}`;
        }
        const mech = /^(\d)\.\s*$/.exec(line);
        if (heading.includes("core mechanics") && mech) {
          const text = input.mechanics[Number(mech[1]) - 1]?.trim();
          return text ? `${mech[1]}. ${text}` : line;
        }
        return line;
      })
      .join("\n");
  }
  return out;
}

/** <Product>_Hub.md, copying the layout of the vault's existing hubs. */
export function buildHubNote(input: NewSprintInput, today: string, startNow: boolean, activeSprint: string | null): string {
  const folder = sanitizeName(input.name);
  const display = folder.replace(/_/g, " ");
  const l = links(folder, display);
  const fm = [
    "---",
    `project: ${folder}`,
    "doc_type: product_hub",
    `sprint_status: ${startNow ? "building" : "queued"}`,
    `category: ${input.category ? yamlValue(wikilink(input.category)) : ""}`,
    `origin_idea: ${input.originIdea ? yamlValue(wikilink(input.originIdea)) : ""}`,
    `cycle_start: ${startNow ? today : ""}`,
    `gate_date: ${startNow ? addDays(today, 27) : ""}`,
    `last_updated: ${today}`,
    "---",
  ].map((line) => line.replace(/: $/, ": "));
  const queued = startNow
    ? []
    : ["> [!note] Queued", `> No building or ad spend until ${activeSprint ?? "the current sprint"} has its day-28 verdict.`, ""];
  return [
    ...fm,
    "",
    `# ${display}: Product Hub`,
    "",
    l.breadcrumbHub,
    "",
    ...queued,
    "## Developer side",
    `- ${l.doc("spec", "1 · Dev Spec")}`,
    `- ${l.doc("launch", "4 · Launch Checklist")}`,
    `- ${l.doc("changelog", "5 · Changelog")}`,
    `- ${l.doc("audit", "6 · Red-Team Audit")}`,
    "",
    "## Marketing side",
    `- ${l.doc("marketing", "2 · Marketing Engine")}`,
    `- ${l.doc("analytics", "3 · Analytics and Gate")}`,
    "",
    "## Rules",
    "Runs on the [[00_Global_System/Launch_Framework|Launch Framework]]. When `sprint_status` changes, update it here and in all 6 docs.",
    "",
  ].join("\n");
}

/**
 * Ticks or unticks one checklist line. `match` is either the exact line as written (company notes)
 * or the start of the item text (launch checklist, e.g. "Checkout works"). Returns the note unchanged if not found.
 */
export function setChecklistLine(raw: string, match: { line?: string; textStart?: string }, checked: boolean): string {
  const lines = raw.split("\n");
  const i = lines.findIndex((l) => {
    const clean = l.replace(/\r$/, "");
    const m = /^(\s*[-*+]\s+\[)([ xX])(\]\s?)(.*)$/.exec(clean);
    if (!m) return false;
    if (match.line !== undefined) return clean === match.line.replace(/\r$/, "");
    return !!match.textStart && m[4].replace(/\*\*/g, "").toLowerCase().startsWith(match.textStart.toLowerCase());
  });
  if (i === -1) return raw;
  lines[i] = lines[i].replace(/^(\s*[-*+]\s+\[)[ xX](\])/, (_m, a: string, b: string) => `${a}${checked ? "x" : " "}${b}`);
  return lines.join("\n");
}
