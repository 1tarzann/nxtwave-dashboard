// Anonymized sample notes for tests and the preview harness. They mirror the vault's layout exactly
// (frontmatter keys in order, the H1, the breadcrumb, the template headings) with Demo_Tool as the product
// and made-up competitors. Tables are compact the way the templates write them, or padded the way
// Obsidian's table editor saves them. Every note ends with a newline, like the vault's files.

import { SEPARATOR, splitRow } from "../src/data/markdown";
import { readFrontmatterRaw } from "../src/data/templates";

/** <span class="nx-eg">text</span>: a green example. */
const eg = (text: string) => `<span class="nx-eg">${text}</span>`;

/** A compact row as the templates write it: "| a | b |", with an empty cell as "| |". */
const row = (...cells: string[]) => `|${cells.map((c) => (c === "" ? " " : ` ${c} `)).join("|")}|`;

const blank = (n: number) => Array.from({ length: n }, () => "");

/** A compact table: header, |---| separator, rows. */
const compact = (header: string[], rows: string[][]) => [row(...header), `|${"---|".repeat(header.length)}`, ...rows.map((r) => row(...r))];

/**
 * Lines of a table padded the way Obsidian's table editor saves it: every column as wide as its longest
 * cell (at least 3), separator cells of dashes that wide. Widths are string lengths, so 🟢 counts as 2.
 */
function padCells(cells: string[][]): string[] {
  const width = cells[0].map((_, i) => Math.max(3, ...cells.map((r) => (r[i] ?? "").length)));
  const line = (r: string[]) => `| ${width.map((w, i) => (r[i] ?? "").padEnd(w)).join(" | ")} |`;
  return [line(cells[0]), `| ${width.map((w) => "-".repeat(w)).join(" | ")} |`, ...cells.slice(1).map(line)];
}

const padded = (header: string[], rows: string[][]) => padCells([header, ...rows]);

/** The same note with every table padded the way Obsidian's table editor saves it (a table inside a "> " quote too). */
export function padTables(note: string): string {
  const lines = note.split("\n");
  for (let i = 0; i + 1 < lines.length; i++) {
    const prefix = /^>?\s*/.exec(lines[i])?.[0] ?? "";
    const isRow = (l: string) => l.startsWith(prefix) && l.slice(prefix.length).trim().startsWith("|");
    if (!isRow(lines[i]) || !lines[i + 1].startsWith(prefix) || !SEPARATOR.test(lines[i + 1].slice(prefix.length))) continue;
    let end = i + 2;
    while (end < lines.length && isRow(lines[end])) end++;
    const cells = lines
      .slice(i, end)
      .filter((_, k) => k !== 1)
      .map((l) => splitRow(l.slice(prefix.length)));
    lines.splice(i, end - i, ...padCells(cells).map((l) => prefix + l));
    i = end - 1;
  }
  return lines.join("\n");
}

/** The same note with Windows (CRLF) line endings. */
export const crlf = (s: string) => s.replace(/\r?\n/g, "\r\n");

/** A note's frontmatter the way Obsidian reads it: quoted values unquoted, empty values as null. */
export function frontmatterOf(note: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, raw] of Object.entries(readFrontmatterRaw(note))) {
    const v = raw.trim();
    out[k] = v === "" ? null : v.startsWith('"') ? JSON.parse(v) : v;
  }
  return out;
}

const note = (lines: string[]) => [...lines, ""].join("\n");

const HUB = '"[[02_Active_Sprints/Demo_Tool/Demo_Tool_Hub|Demo Tool Hub]]"';
const BREADCRUMB =
  "[[02_Active_Sprints/Master_Kanban|🏠 All Products]] ▸ [[02_Active_Sprints/Demo_Tool/Demo_Tool_Hub|Demo Tool]] · [[02_Active_Sprints/Demo_Tool/2_Marketing_Engine|📈 Marketing]] · [[02_Active_Sprints/Demo_Tool/1_Dev_Spec|💻 Dev]]";

// ---------------------------------------------------------------------------------------------------
// Marketing Engine (2_Marketing_Engine)
// ---------------------------------------------------------------------------------------------------

const MKT_KEYS = ["project", "hub", "doc_type", "owner", "sprint_status", "cycle_start", "gate_date", "tiktok", "instagram", "youtube", "x", "last_social_post_date", "last_updated"];

/** Frontmatter with x: between youtube: and last_social_post_date:, and the H1 + breadcrumb under it. Empty values keep the vault's "key: ". */
function mktHead(values: Record<string, string> = {}): string[] {
  const v: Record<string, string> = { project: "Demo_Tool", hub: HUB, doc_type: "marketing_engine", owner: "marketing", sprint_status: "building", last_updated: "2026-11-04", ...values };
  return ["---", ...MKT_KEYS.map((k) => `${k}: ${v[k] ?? ""}`), "---", "", "# Demo Tool: Marketing Engine", "", BREADCRUMB, ""];
}

const H_SWIPE = "## 1. Competitor swipe (3 competitors)";
const H_HOOKS = "## 2. Hook scripts (native UGC demo)";
const H_BACKLOG = "## 3. Content backlog (made during days 1–14, scheduled for launch)";
const H_BRAND = "## 4. Brand kit";
const H_PAID = "## 5. Paid test plan";

const SWIPE = ["Competitor", "Top ad / video link", "Hook (first 3s)", "Why it works"];
const HOOKS_V1 = ["#", "Hook (spoken, first 3s)", "Demo shot", "CTA"];
const HOOKS_V2 = ["#", "Rating", "Hook (spoken, first 3s)", "Demo shot", "CTA", "Based on"];
const BACKLOG = ["#", "Format", "Platform(s)", "Hook #", "Status (scripted / recorded / edited / scheduled)", "Go-live date"];
const BRAND = ["Asset", "Link / status"];
const ITEM = ["Item", "Value"];
const ASSETS = ["Product name", "Logo", "Thumbnail / trailer", "Landing page", "Email capture", "Stripe product / payment link"];
const PAID = ["Video chosen for the $100 push", "Platform", "Start date", "Budget (max $300 per sprint)"];

const REC = "🟢 Recommended";
const MED = "🟡 Medium";
const AVOID = "🔴 Don't use";

/** The generic examples of the v2 template (plan appendix a). */
const EG = {
  competitor: eg("e.g. product name, linked to where it's sold"),
  video: eg("e.g. their best video: views and × their usual"),
  theirHook: eg("e.g. their exact first words, in quotes"),
  why: eg("e.g. shows the result by second 2"),
  hook: eg(`e.g. "I couldn't find a tool that does ___, so I built one."`),
  demo: eg("e.g. screen: one click, the result plays right away"),
  cta: eg("e.g. Link in bio."),
  basedOn: eg("e.g. 2 competitor videos at 2× their usual views"),
  avoidHook: eg("e.g. brand-first opening: logo and name before the demo"),
  avoidBasedOn: eg("e.g. 4 competitor videos at 0.2× their usual views"),
  format: eg("e.g. screen recording + your voice, 20s"),
  platforms: eg("e.g. TikTok, Reels, Shorts, X"),
  hookNum: eg("e.g. 1"),
  status: eg("e.g. scripted"),
  goLive: eg("e.g. launch day (day 14)"),
  assets: [
    eg("e.g. the name exactly as the store shows it"),
    eg("e.g. link to the logo file"),
    eg("e.g. link to a 1080×1920 image or a 15s video"),
    eg("e.g. link to the one-page site"),
    eg("e.g. link to the sign-up form"),
    eg("e.g. the Stripe payment link, never a secret key"),
  ],
  paid: [eg("e.g. backlog #2, the best free video after launch"), eg("e.g. Meta, TikTok or Google"), eg("e.g. day 15"), eg("e.g. $100 first, $300 at most")],
};

/** v1 template: compact §1, padded §2 (3 hooks, no Rating), compact §3, padded brand kit, compact paid test. Everything empty. */
export const MKT_V1_TEMPLATE = note([
  ...mktHead(),
  H_SWIPE,
  ...compact(SWIPE, [blank(4), blank(4), blank(4)]),
  "",
  H_HOOKS,
  ...padded(HOOKS_V1, [["1", `"I couldn't find a tool that does ___, so I built one."`, "", ""], ["2", "", "", ""], ["3", "", "", ""]]),
  "",
  H_BACKLOG,
  ...compact(BACKLOG, [["1", ...blank(5)]]),
  "",
  H_BRAND,
  ...padded(BRAND, ASSETS.map((a) => [a, ""])),
  "",
  H_PAID,
  ...compact(ITEM, PAID.map((p) => [p, ""])),
]);

/** Filled v1 note: 3 competitors, 3 hooks with demo shots, 3 backlog rows (scheduled, recorded, scripted), brand kit 4 of 6 with a Stripe link, paid test 2 of 4. */
export const MKT_V1_FILLED = note([
  ...mktHead({ cycle_start: "2026-11-01", gate_date: "2026-11-28", tiktok: '"@demo_tool"', instagram: '"@demo.tool"', youtube: '"@demotool"' }),
  H_SWIPE,
  ...padded(SWIPE, [
    ["Acme Vox", "https://example.com/v/1", `"Your S's are too loud. One knob fixes that."`, "Result by second 1; 7.4× their usual views"],
    ["Beta Audio", "https://example.com/v/2", `"Harsh vocals? Watch the waveform."`, "Before/after by second 2; 3.1× their usual views"],
    ["Gamma Labs", "https://example.com/v/3", `"Stop drawing volume dips on every S."`, "Names the pain in the first line; 2.2× their usual views"],
  ]),
  "",
  H_HOOKS,
  ...padded(HOOKS_V1, [
    ["1", `"I couldn't find a de-esser with one knob, so I built one."`, "Screen: turn the knob, the S's go soft at second 1", "Link in bio."],
    ["2", `"Harsh S's in your vocal? Watch this."`, "Before/after: the same take, knob up", "$29 once, link in bio."],
    ["3", `"This is the whole plugin: one knob."`, "Close-up: the knob turning, the waveform calms", "Link in bio."],
  ]),
  "",
  H_BACKLOG,
  ...compact(BACKLOG, [
    ["1", "Screen recording + your voice, 20s", "TikTok, Reels, Shorts", "1", "scheduled", "2026-11-14"],
    ["2", "Before/after split screen, 15s", "TikTok, Reels", "2", "recorded", "2026-11-14"],
    ["3", "Close-up of the knob, 10s", "Shorts", "3", "scripted", "2026-11-16"],
  ]),
  "",
  H_BRAND,
  ...padded(BRAND, [
    ["Product name", "Demo Tool"],
    ["Logo", "https://example.com/demo-tool/logo.png"],
    ["Thumbnail / trailer", ""],
    ["Landing page", "https://example.com/demo-tool"],
    ["Email capture", ""],
    ["Stripe product / payment link", "https://buy.stripe.com/test_demo"],
  ]),
  "",
  H_PAID,
  ...compact(ITEM, [
    ["Video chosen for the $100 push", "Backlog #1"],
    ["Platform", "Meta"],
    ["Start date", ""],
    ["Budget (max $300 per sprint)", ""],
  ]),
]);

const REQUEST_MARKER = "<!-- nx-research-request: date=2026-11-18 by=marketing -->";

/** A fresh v2 note (plan appendix a). `swipeTail` goes at the end of §1, after the table and a blank line. */
function v2Template(swipeTail: string[] = []): string {
  return note([
    ...mktHead({ last_updated: '"2026-11-04"' }),
    H_SWIPE,
    ...compact(SWIPE, [[EG.competitor, EG.video, EG.theirHook, EG.why], blank(4), blank(4)]),
    "",
    ...swipeTail,
    H_HOOKS,
    ...compact(HOOKS_V2, [
      ["1", REC, EG.hook, EG.demo, EG.cta, EG.basedOn],
      ["2", REC, ...blank(4)],
      ["3", REC, ...blank(4)],
      ["4", MED, ...blank(4)],
      ["5", MED, ...blank(4)],
      ["6", MED, ...blank(4)],
      ["7", MED, ...blank(4)],
      ["8", MED, ...blank(4)],
      ["9", AVOID, EG.avoidHook, "—", "—", EG.avoidBasedOn],
      ["10", AVOID, "", "—", "—", ""],
    ]),
    "",
    H_BACKLOG,
    ...compact(BACKLOG, [["1", EG.format, EG.platforms, EG.hookNum, EG.status, EG.goLive]]),
    "",
    H_BRAND,
    ...compact(BRAND, ASSETS.map((a, i) => [a, EG.assets[i]])),
    "",
    H_PAID,
    ...compact(ITEM, PAID.map((p, i) => [p, EG.paid[i]])),
  ]);
}

/** Fresh v2 note from the new template: 10 rated hook slots, green examples in the empty cells, last_updated quoted as the template writes it. */
export const MKT_V2_TEMPLATE = v2Template();

/** MKT_V2_TEMPLATE after the Marketer pressed Ask for research: one nx-research-request marker at the end of §1, no research yet. */
export const MKT_V2_REQUESTED = v2Template([REQUEST_MARKER, ""]);

/** v2 after a research run: 2 competitors + a MISSING row, the "How these 3 were picked" callout, 2 markers, 10 rated hooks (row 3 MISSING, row 6 with an example CTA), §3–5 partly filled. */
export const MKT_V2_RESEARCHED = note([
  ...mktHead({ last_updated: "2026-11-20" }),
  H_SWIPE,
  ...compact(SWIPE, [
    [
      "[Acme Vox](https://example.com/acme-vox)",
      "[184k views · 7.4× usual](https://example.com/v/1)",
      `"Your S's are too loud. One knob fixes that." (TikTok captions)`,
      "Result by second 1; 7.4× usual, 3 videos at 2×+",
    ],
    [
      "[Beta Audio](https://example.com/beta-audio)",
      "[92k views · 3.1× usual](https://example.com/v/2)",
      `"Harsh vocals? Watch the waveform." (Shorts captions)`,
      "Before/after by second 2; 3.1× usual, an ad running 45 days",
    ],
    ["MISSING: competitor 3 (checked 41, none passed all 6 checks)", EG.video, EG.theirHook, EG.why],
  ]),
  "",
  "> [!note]- How these 3 were picked (2026-11-20)",
  "> Checked 41 products in 2 rounds; 2 passed all 6 checks. Slot 3 stays MISSING rather than take a weaker match.",
  ">",
  ...compact(["Gate", "Acme Vox", "Beta Audio"], [
    ["G1 Type", "[pass](https://example.com/acme-vox)", "[pass](https://example.com/beta-audio)"],
    ["G4 Model + price", "[pass: $29 one-time](https://example.com/acme-vox#buy)", "[pass: $39 one-time](https://example.com/beta-audio#buy)"],
    ["G5 Short-form", "[pass: posted 2026-11-12](https://example.com/v/1)", "[pass: posted 2026-11-09](https://example.com/v/2)"],
  ]).map((l) => `> ${l}`),
  ">",
  "> Closest near misses:",
  "> - Gamma Labs: sold only inside a bundle (G6)",
  "> - Delta Example: no short-form posts in the last 180 days (G5)",
  "",
  "<!-- nx-research: date=2026-11-20 checked=41 kept=2 rounds=2 sources=crawl4ai,shorts -->",
  REQUEST_MARKER,
  "",
  H_HOOKS,
  ...compact(HOOKS_V2, [
    [
      "1",
      REC,
      `"I couldn't find a de-esser with one knob, so I built one."`,
      "Screen: turn the one knob, the S's soften at second 1",
      "Link in bio.",
      "[Acme Vox 7.4×](https://example.com/v/1), [Beta Audio 3.1×](https://example.com/v/2)",
    ],
    [
      "2",
      REC,
      `"Your vocal is fine. The S's are the problem."`,
      "Before/after: harsh take, knob up, same take smooth",
      "$29 once. Link in bio.",
      "[Acme Vox 2.6×](https://example.com/v/3), [Beta Audio 2.3×](https://example.com/v/4)",
    ],
    ["3", REC, "MISSING: evidence for a Recommended hook (needs 2 videos at 2×+ from 2 competitors)", EG.demo, EG.cta, EG.basedOn],
    ["4", MED, `"Stop drawing volume dips on every S."`, "Screen: a lane full of volume dips, then one knob", "Link in bio.", "[Beta Audio 2.2×](https://example.com/v/5)"],
    ["5", MED, `"One knob. That's the whole plugin."`, "Close-up: the knob turning, the waveform calms", "Link in bio.", "[Acme Vox ad, 45 days](https://example.com/ad/1)"],
    ["6", MED, `"Home studio vocals sound harsh? Try this."`, "Phone recording: knob up, play it back", EG.cta, "[Beta Audio 2.4×](https://example.com/v/6)"],
    ["7", MED, `"I built this for my own vocals first."`, "Screen: my own vocal track, knob turned live", "$29 once. Link in bio.", "[Acme Vox 2.1×](https://example.com/v/7)"],
    ["8", MED, `"Watch the S's go soft in one turn."`, "Split screen: before on the left, after on the right", "Link in bio.", "[Acme Vox ad, 31 days](https://example.com/ad/2)"],
    [
      "9",
      AVOID,
      "Brand-first opening: logo and name before the demo. 0.2× usual across 4 videos.",
      "—",
      "—",
      "[Acme Vox 0.2×](https://example.com/v/8), [Beta Audio 0.3×](https://example.com/v/9)",
    ],
    [
      "10",
      AVOID,
      "Follow-ask opening: asks for a follow before any result. 0.4× usual across 3 videos.",
      "—",
      "—",
      "[Beta Audio 0.4×](https://example.com/v/10), [Acme Vox 0.5×](https://example.com/v/11)",
    ],
  ]),
  "",
  H_BACKLOG,
  ...compact(BACKLOG, [
    ["1", "Screen recording + your voice, 20s", "TikTok, Reels, Shorts", "1", "recorded", EG.goLive],
    ["2", eg("e.g. before/after split screen, 15s"), eg("e.g. TikTok, Reels"), eg("e.g. 2"), EG.status, EG.goLive],
  ]),
  "",
  H_BRAND,
  ...compact(BRAND, [
    ["Product name", "Demo Tool"],
    ["Logo", EG.assets[1]],
    ["Thumbnail / trailer", EG.assets[2]],
    ["Landing page", "https://example.com/demo-tool"],
    ["Email capture", EG.assets[4]],
    ["Stripe product / payment link", EG.assets[5]],
  ]),
  "",
  H_PAID,
  ...compact(ITEM, [
    ["Video chosen for the $100 push", eg("e.g. backlog #1, the best free video after launch")],
    ["Platform", "Meta"],
    ["Start date", EG.paid[2]],
    ["Budget (max $300 per sprint)", "$100"],
  ]),
]);

/** MKT_V2_RESEARCHED with every table padded by Obsidian's table editor (the table inside the callout too). Cells are unchanged. */
export const MKT_V2_PADDED = padTables(MKT_V2_RESEARCHED);

/** MKT_V2_RESEARCHED after the Marketer pressed Looks good on the competitors only: an nx-reviewed marker without hooks=. */
export const MKT_V2_REVIEWED = MKT_V2_RESEARCHED.replace(REQUEST_MARKER, `${REQUEST_MARKER}\n<!-- nx-reviewed: competitors=2026-11-21 -->`);

/** v2 template where Live Preview broke two spans: §1 row 1 Competitor holds "e.g. orphan text</span>", the Stripe row an opening tag with no </span>. */
export const MKT_HALF_DELETED = MKT_V2_TEMPLATE.replace(EG.competitor, "e.g. orphan text</span>").replace(EG.assets[5], '<span class="nx-eg">e.g. half deleted');

// ---------------------------------------------------------------------------------------------------
// Dev Spec (1_Dev_Spec)
// ---------------------------------------------------------------------------------------------------

const PITCH = "A one-knob de-esser that tames harsh S sounds in home-studio vocals.";
const PROFILE_EXAMPLES = [
  ["Who buys it", eg("e.g. who pays, in their own words")],
  ["Job it does", eg("e.g. the one thing they buy it to do, in one sentence")],
  ["Price", eg("e.g. $29 one-time, $5/month, or free + in-game items")],
];
const PROFILE_FILLED = [
  ["Who buys it", "Home-studio vocalists who record and mix their own songs"],
  ["Job it does", "Softens harsh S sounds in a vocal with one knob"],
  ["Price", "$29 one-time"],
];
const MECHANICS = ["One knob sets how much the S sounds are softened", "Finds S sounds on its own and turns only those down", "Before/after button to compare in one click"];
const TECH_ITEMS = ["Engine / framework", "Language", "Target platforms", "Distribution / store", "Payment method"];
const TECH_FILLED = ["C++ audio plugin framework", "C++", "macOS + Windows (VST3, AU)", "Own website, direct download", "Stripe payment link"];
const BUILD_PLAN = [
  ["1–3", "Core mechanic 1 working"],
  ["4–7", "Mechanics 2–3 working"],
  ["8–11", "Polish core loop (no cosmetics)"],
  ["12–14", "Red-team audit, launch checklist, publish"],
];

interface SpecParts {
  productType: string;
  pitch: string;
  /** Lines between the "> " pitch line and "## 2.", blank lines included. */
  profile: string[];
  mechanics: string[];
  outOfScope: string[];
  tech: string[];
  fileTree: string[];
  /** How many build-plan rows are ticked. */
  built: number;
  questions: string[];
}

function specNote(p: SpecParts): string {
  return note([
    "---",
    "project: Demo_Tool",
    `hub: ${HUB}`,
    "doc_type: dev_spec",
    "owner: dev",
    "sprint_status: building",
    "cycle_start: ",
    "gate_date: ",
    `product_type: ${p.productType}`,
    "repo_url: ",
    "last_updated: 2026-11-04",
    "---",
    "",
    "# Demo Tool: Dev Spec",
    "",
    BREADCRUMB,
    "",
    "## 1. One-line pitch",
    `> ${p.pitch}`,
    ...p.profile,
    "## 2. Core mechanics (max 3)",
    ...[0, 1, 2].map((i) => `${i + 1}. ${p.mechanics[i] ?? ""}`),
    "",
    "## 3. Out of scope for this MVP",
    ...(p.outOfScope.length ? p.outOfScope : [""]).map((l) => `- ${l}`),
    "",
    "## 4. Tech preset",
    ...compact(ITEM, TECH_ITEMS.map((item, i) => [item, p.tech[i] ?? ""])),
    "",
    "## 5. File tree",
    "```",
    ...p.fileTree,
    "```",
    "",
    "## 6. Build plan (days 1–14)",
    ...compact(["Day", "Milestone", "Done"], BUILD_PLAN.map(([day, milestone], i) => [day, milestone, i < p.built ? "[x]" : "[ ]"])),
    "",
    "## 7. Open technical questions",
    ...(p.questions.length ? p.questions : [""]).map((l) => `- ${l}`),
  ]);
}

const FILLED_SPEC: SpecParts = {
  productType: "Audio plugin",
  pitch: PITCH,
  profile: ["", ...compact(ITEM, PROFILE_FILLED), ""],
  mechanics: MECHANICS,
  outOfScope: ["Multiband controls", "Preset browser"],
  tech: TECH_FILLED,
  fileTree: ["src/", "  deesser.cpp", "  knob_ui.cpp", "# build/ is made by the build script"],
  built: 1,
  questions: ["Does the AU build need its own signing step?"],
};

/** Fresh Dev Spec from the new TPL_1: empty pitch, the 3 profile rows holding only examples, empty mechanics and tech preset. All 7 profile fields missing. */
export const SPEC_EMPTY = specNote({
  productType: "",
  pitch: "",
  profile: ["", ...compact(ITEM, PROFILE_EXAMPLES), ""],
  mechanics: [],
  outOfScope: [],
  tech: [],
  fileTree: [],
  built: 0,
  questions: [],
});

/** Complete profile: a one-knob de-esser VST3/AU plugin for home-studio vocalists, "$29 one-time", "macOS + Windows (VST3, AU)". A "# " line sits inside the file-tree fence. */
export const SPEC_FILLED = specNote(FILLED_SPEC);

/** SPEC_FILLED, but the 3 profile rows still hold only their examples, in a padded table right above "## 2." (as Obsidian saved the pasted template). */
export const SPEC_SPAN_ONLY = specNote({ ...FILLED_SPEC, profile: ["", "", ...padded(ITEM, PROFILE_EXAMPLES)] });

/** SPEC_FILLED, but Who buys it, Job it does, Price and Target platforms say "TBD". */
export const SPEC_TBD = specNote({
  ...FILLED_SPEC,
  profile: ["", ...compact(ITEM, PROFILE_FILLED.map(([label]) => [label, "TBD"])), ""],
  tech: TECH_FILLED.map((v, i) => (TECH_ITEMS[i] === "Target platforms" ? "TBD" : v)),
});

/** SPEC_FILLED without the profile table under the pitch (a spec made before the TPL_1 paste). */
export const SPEC_NO_TABLE = specNote({ ...FILLED_SPEC, profile: [""] });
