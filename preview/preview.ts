// Browser harness: renders the real UI with fake products, plus a Simulate panel that triggers
// every microinteraction (live partner edits, new revenue, failed actions, reduced motion, dark mode).
//
// Each product's Marketing Engine and Dev Spec are real markdown from tests/samples.ts, kept in an in-memory
// vault. Table edits run the same code as in Obsidian (TableWriter: applyTableOp, last_updated, the read-back
// 2 s later), and the sections, counts and quests are read from those notes by the real buildSnapshot.

import { parseChecklistNote } from "../src/data/company";
import { addDays, daysBetween, toIsoDate } from "../src/data/dates";
import { MARKETING_SECTIONS, parseMarketing } from "../src/data/marketing";
import { buildSnapshot } from "../src/data/snapshot";
import { applyTableOp, RowRef, TableOp } from "../src/data/tableEdit";
import { refuseSecrets } from "../src/data/marketingOps";
import { fillTemplate, setChecklistLine, sprintInputTexts } from "../src/data/templates";
import { DEFAULT_THRESHOLDS, DashboardData, DOC_FILES, DOC_ORDER, DocKey, LedgerRow, ProductSnapshot, RawDoc } from "../src/data/types";
import { NoteIO, TableWriter } from "../src/obsidian/writeQueue";
import { DashboardApp } from "../src/ui/app";
import { applyMotionMode } from "../src/ui/motion";
import { h } from "../src/ui/dom";
import { Host, Prefs, Undo } from "../src/ui/host";
import * as S from "../tests/samples";

const today = toIsoDate(Date.now());
const startFor = (day: number) => addDays(today, -(day - 1));

// ── In-memory vault ─────────────────────────────────────────────────────────

/** Note path → markdown: each product's Marketing Engine and Dev Spec. The other 4 notes stay fake snapshot fields. */
const vault = new Map<string, string>();
const NOTE_DOCS = ["marketing", "spec"] as const;
type NoteDoc = (typeof NOTE_DOCS)[number];
type NoteSet = Record<NoteDoc, string>;

const folderOf = (name: string) => `HQ/02_Active_Sprints/${name}`;
const pathOf = (name: string, doc: DocKey) => `${folderOf(name)}/${DOC_FILES[doc]}.md`;

/** The samples are Demo_Tool's notes; another product gets them under its own name. */
function renamed(note: string, name: string): string {
  return name === "Demo_Tool" ? note : note.replace(/Demo_Tool/g, name).replace(/Demo Tool/g, name.replace(/_/g, " "));
}

/** Every date in the notes moved by the same number of days, so the sample's `from` lands on `to`. */
function movedDates(notes: NoteSet, from: string, to: string): NoteSet {
  const n = daysBetween(from, to);
  const move = (s: string) => (n === 0 ? s : s.replace(/\b\d{4}-\d{2}-\d{2}\b/g, (d) => addDays(d, n)));
  return { marketing: move(notes.marketing), spec: move(notes.spec) };
}

function seed(name: string, notes: NoteSet): void {
  for (const doc of NOTE_DOCS) vault.set(pathOf(name, doc), renamed(notes[doc], name));
}

function noteAt(path: string): string {
  const text = vault.get(path);
  if (text === undefined) throw new Error(`Can't find ${path.split("/").pop()}. Was it renamed?`);
  return text;
}

const io: NoteIO = {
  read: async (path) => noteAt(path),
  process: async (path, fn) => {
    const next = fn(noteAt(path));
    vault.set(path, next);
    return next;
  },
  today: () => today,
};
let writer = new TableWriter(io);

/** The snapshot fields the two notes decide, read by the real buildSnapshot. Scenario overrides never set these. */
const NOTE_FIELDS = ["marketing", "profile", "competitorsFilled", "hooksFilled", "hooksTotal", "backlog", "brandKit", "stripeLink", "pitch", "mechanics", "productType"] as const;
type NoteFields = Pick<ProductSnapshot, (typeof NOTE_FIELDS)[number]>;

function rawDoc(path: string): RawDoc | undefined {
  const text = vault.get(path);
  return text === undefined ? undefined : { path, frontmatter: S.frontmatterOf(text), body: text, mtime: 0 };
}

function fromNotes(name: string): NoteFields {
  const s = buildSnapshot(name, folderOf(name), { marketing: rawDoc(pathOf(name, "marketing")), spec: rawDoc(pathOf(name, "spec")) });
  return Object.fromEntries(NOTE_FIELDS.map((k) => [k, s[k]])) as NoteFields;
}

// ── Products and scenarios ──────────────────────────────────────────────────

function mk(name: string, over: Partial<ProductSnapshot>): ProductSnapshot {
  const base = buildSnapshot(name, folderOf(name), {}, { path: `${folderOf(name)}/${name}_Hub.md`, frontmatter: {}, body: "", mtime: 0 });
  return {
    ...base,
    warnings: [],
    paths: Object.fromEntries(DOC_ORDER.map((k) => [k, pathOf(name, k)])),
    organic: [
      { platform: "TikTok", followers: null, totalViews: null, bestVideoLink: "", bestVideoViews: null },
      { platform: "Instagram Reels", followers: null, totalViews: null, bestVideoLink: "", bestVideoViews: null },
      { platform: "YouTube Shorts", followers: null, totalViews: null, bestVideoLink: "", bestVideoViews: null },
    ],
    launchChecks: { done: 4, total: 13 },
    launchItems: [
      { text: "Core mechanics 1–3 work end-to-end", checked: true },
      { text: "Version tagged in 5_Changelog", checked: false },
      { text: "Build or store listing is live", checked: false },
      { text: "Checkout works with a real test purchase (Stripe or platform)", checked: false },
    ],
    milestones: { done: 1, total: 4 },
    ...over,
    // Last, so the sections, the counts and the quests all agree with the notes.
    ...fromNotes(name),
  };
}

const ledger = (rows: [number, number, number, number, number, number][]): LedgerRow[] =>
  rows.map(([day, spend, impressions, clicks, sales, revenue]) => ({ day, date: "", spend, impressions, clicks, signups: sales, sales, revenue, filled: true }));

type Scenario = {
  label: string;
  active: Partial<ProductSnapshot>;
  /** Demo_Tool's Marketing Engine and Dev Spec. Default: the fresh v2 template and an empty Dev Spec. */
  notes?: NoteSet;
  /** Moves every date in the notes so the first (a sample date) lands on the second. */
  dates?: [string, string];
};

const TEMPLATES: NoteSet = { marketing: S.MKT_V2_TEMPLATE, spec: S.SPEC_EMPTY };
const FILLED_V1: NoteSet = { marketing: S.MKT_V1_FILLED, spec: S.SPEC_FILLED };
const RESEARCHED: NoteSet = { marketing: S.MKT_V2_RESEARCHED, spec: S.SPEC_FILLED };
/** Dates in the samples: the filled v1 note's day 1, the research run, and the Ask for research press. */
const SAMPLE_DAY1 = "2026-11-01";
const SAMPLE_RESEARCH = "2026-11-20";
const SAMPLE_REQUEST = "2026-11-18";

const SCENARIOS: Record<string, Scenario> = {
  unstarted: { label: "Clock not started (today's real state)", active: { status: "building", cycleStart: null } },
  prelaunch: { label: "Day 3 · nothing filled yet (pre-launch)", active: { status: "building", cycleStart: startFor(3), lastChangelogDate: addDays(today, -1), marketingTouched: today } },
  day16empty: {
    label: "Day 16 · launched, nothing logged",
    notes: FILLED_V1,
    dates: [SAMPLE_DAY1, startFor(16)],
    active: { status: "watching", cycleStart: startFor(16), lastSocialPostDate: addDays(today, -1), lastChangelogDate: addDays(today, -2), handles: { tiktok: "@demo_tool", instagram: "@demo.tool", youtube: "@demotool", x: "" } },
  },
  build: {
    label: "Day 9 · building, healthy",
    notes: FILLED_V1,
    dates: [SAMPLE_DAY1, startFor(9)],
    active: { status: "building", cycleStart: startFor(9), lastChangelogDate: addDays(today, -1), marketingTouched: today, currentVersion: "0.2.0", changelog: [{ version: "0.2.0", date: addDays(today, -1), added: ["Wet/dry mix knob"], fixed: ["Audio buffer crash"], removed: [] }] },
  },
  staleBuild: { label: "Day 8 · stale (no changelog 4 days)", active: { status: "building", cycleStart: startFor(8), lastChangelogDate: addDays(today, -4), marketingTouched: addDays(today, -1) } },
  gate14: { label: "Day 14 · launch gate", active: { status: "building", cycleStart: startFor(14), lastChangelogDate: today, signedOffDev: true, launchChecks: { done: 13, total: 13 }, blockingIssuesOpen: 0, auditDate: addDays(today, -1) } },
  watch: {
    label: "Day 20 · watching, healthy, revenue",
    notes: FILLED_V1,
    dates: [SAMPLE_DAY1, startFor(20)],
    active: {
      status: "watching",
      cycleStart: startFor(20),
      lastSocialPostDate: today,
      lastChangelogDate: addDays(today, -6),
      handles: { tiktok: "@demo_tool", instagram: "@demo.tool", youtube: "", x: "" },
      repoUrl: "https://github.com/example/demo-tool",
      ledger: ledger([[15, 0, 0, 0, 0, 0], [16, 20, 3000, 24, 0, 0], [17, 25, 4200, 40, 1, 19.99], [18, 30, 5100, 51, 2, 39.98], [19, 25, 4000, 38, 1, 19.99], [20, 0, 0, 0, 1, 24]]),
      organic: [
        { platform: "TikTok", followers: 412, totalViews: 18400, bestVideoLink: "https://tiktok.com", bestVideoViews: 9100 },
        { platform: "Instagram Reels", followers: 96, totalViews: 3100, bestVideoLink: "", bestVideoViews: null },
        { platform: "YouTube Shorts", followers: 38, totalViews: 2200, bestVideoLink: "", bestVideoViews: null },
      ],
    },
  },
  staleWatch: { label: "Day 19 · stale (no post 4 days)", active: { status: "watching", cycleStart: startFor(19), lastSocialPostDate: addDays(today, -4), lastChangelogDate: addDays(today, -2) } },
  kill: { label: "Day 22 · kill signal ($120, 0 sales)", active: { status: "watching", cycleStart: startFor(22), lastSocialPostDate: today, totalSpendFm: 120, ledger: ledger([[16, 40, 6000, 20, 0, 0], [17, 40, 6000, 18, 0, 0], [18, 40, 5000, 15, 0, 0]]) } },
  verdict: { label: "Day 28 · verdict day", active: { status: "watching", cycleStart: startFor(28), lastSocialPostDate: today, ledger: ledger([[16, 50, 6000, 80, 3, 59.97]]) } },
  // Competitor research (0.5.0). Research ran yesterday; a request was made the day before that.
  researched: {
    label: "Research done · 10 rated hooks",
    notes: RESEARCHED,
    dates: [SAMPLE_RESEARCH, addDays(today, -1)],
    active: { status: "building", cycleStart: startFor(9), lastChangelogDate: addDays(today, -1), marketingTouched: addDays(today, -1) },
  },
  oldLayout: {
    label: "Old layout · 3 hooks",
    notes: FILLED_V1,
    dates: [SAMPLE_DAY1, startFor(9)],
    active: { status: "building", cycleStart: startFor(9), lastChangelogDate: addDays(today, -1), marketingTouched: today },
  },
  requested: {
    label: "Research asked, waiting",
    notes: { marketing: S.MKT_V2_REQUESTED, spec: S.SPEC_FILLED },
    dates: [SAMPLE_REQUEST, addDays(today, -1)],
    active: { status: "building", cycleStart: startFor(5), lastChangelogDate: today, marketingTouched: addDays(today, -1) },
  },
  profileMissing: {
    label: "Profile missing",
    notes: { marketing: S.MKT_V2_REQUESTED, spec: S.SPEC_EMPTY },
    dates: [SAMPLE_REQUEST, addDays(today, -1)],
    active: { status: "building", cycleStart: startFor(3), lastChangelogDate: today, marketingTouched: addDays(today, -1) },
  },
  day16researched: {
    label: "Day 16 · research done",
    notes: RESEARCHED,
    // Research ran on day 6.
    dates: [SAMPLE_RESEARCH, startFor(6)],
    active: {
      status: "watching",
      cycleStart: startFor(16),
      lastSocialPostDate: addDays(today, -1),
      lastChangelogDate: addDays(today, -2),
      marketingTouched: addDays(today, -1),
      handles: { tiktok: "@demo_tool", instagram: "@demo.tool", youtube: "@demotool", x: "" },
    },
  },
};

const SETUP = [
  "## P0: make the vault work for both partners",
  "- [x] Turn on sharing for the HQ folder",
  "- [ ] Partner installs the **Kanban** plugin #marketing",
  "- [ ] Both partners install BRAT",
  "\t- Settings → Community plugins → Browse → BRAT",
  "## P1: company setup",
  "- [ ] Business phone number",
  "- [ ] EIN (free, IRS website)",
  "- [ ] Business checking + $500 contribution each",
  "## P3: system hardening (later)",
  "- [ ] Decide where code repos live #dev",
].join("\n");
const BUSINESS = ["## 8. Current status", "- [ ] Business phone number", "- [ ] Pick a bookkeeping spreadsheet", "- [x] LLC filed"].join("\n");

let failNext = false;
/** "Relay overwrites my next save" is armed. */
let relayNext = false;
/** Bumped on every scenario switch: a read-back or Undo from before it does nothing. */
let generation = 0;
let simOpen = true;
let scenario = new URLSearchParams(location.search).get("s") ?? "watch";
let data: DashboardData;

function build(): DashboardData {
  const sc = SCENARIOS[scenario] ?? SCENARIOS.watch;
  generation++;
  writer = new TableWriter(io);
  vault.clear();
  const notes = sc.notes ?? TEMPLATES;
  seed("Demo_Tool", sc.dates ? movedDates(notes, ...sc.dates) : notes);
  seed("Sample_Game", TEMPLATES);
  return {
    hqRoot: "HQ",
    today,
    thresholds: DEFAULT_THRESHOLDS,
    archive: { scaled: [], killed: ["Old_Idea"] },
    ideas: [
      { path: "HQ/05_Idea_Pipeline/1_Brainstorm/Brainstorming.md", title: "Brainstorming", stage: "brainstorm", mtime: 0 },
      { path: "HQ/05_Idea_Pipeline/2_Rough_Drafts/Prompt Coach.md", title: "Prompt Coach", stage: "drafts", mtime: 0 },
      { path: "HQ/05_Idea_Pipeline/3_Accepted/Wallpaper Engine.md", title: "Wallpaper Engine", stage: "accepted", mtime: 0 },
    ],
    categories: [
      { path: "04_Company_Ops/Categories/Audio_Plugins", title: "Audio Plugins" },
      { path: "04_Company_Ops/Categories/Roblox_Games", title: "Roblox Games" },
    ],
    setup: parseChecklistNote(SETUP, "HQ/SETUP_CHECKLIST.md"),
    businessModel: parseChecklistNote(BUSINESS, "HQ/04_Company_Ops/NXTWAVE_Business_Model.md", "Current status"),
    products: [
      mk("Demo_Tool", { category: { path: "04_Company_Ops/Categories/Audio_Plugins", title: "Audio Plugins" }, ...sc.active }),
      mk("Sample_Game", { status: "queued", category: { path: "04_Company_Ops/Categories/Roblox_Games", title: "Roblox Games" } }),
    ],
  };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
function update(name: string, patch: Partial<ProductSnapshot>) {
  data = { ...data, products: data.products.map((p) => (p.name === name ? { ...p, ...patch } : p)) };
  app.setData(data);
}
async function act(name: string, patch: Partial<ProductSnapshot>): Promise<Undo> {
  await wait(450);
  if (failNext) {
    failNext = false;
    renderSim();
    throw new Error("Can't write 2_Marketing_Engine: the note was renamed. Open the product folder and check the file name.");
  }
  const before = data.products.find((p) => p.name === name)!;
  const prev = Object.fromEntries(Object.keys(patch).map((k) => [k, (before as any)[k]])) as Partial<ProductSnapshot>;
  update(name, patch);
  return async () => update(name, prev);
}

/** Reads a product's notes into its snapshot again, as the plugin does when a file changes. A changed Marketing Engine counts as Marketer activity today. */
function reread(name: string, touchedMarketing: boolean) {
  update(name, { ...fromNotes(name), ...(touchedMarketing ? { marketingTouched: today } : {}) });
}

/** One write to a note through the shared writer, then the snapshot read again. Returns what the writer returned. */
async function writeNote(name: string, doc: DocKey, path: string, op: TableOp, check: boolean) {
  const before = vault.get(path);
  const done = await writer.edit(path, op, { check });
  reread(name, doc === "marketing" && vault.get(path) !== before);
  return done;
}

// ── Partner and Relay simulation ────────────────────────────────────────────

/** What a partner's text looks like when Relay's merge keeps theirs instead of ours. */
const RELAY_TEXT = "Your partner typed this at the same moment";

/**
 * The note after Relay kept a partner's version of what `op` just wrote: the first written cell gets other text,
 * a deleted row comes back, a marker goes back to how it was. null when there's nothing to change.
 */
function relayOverwrite(note: string, op: TableOp, inverse: TableOp): string | null {
  const cellTo = (row: RowRef | undefined, col: string | undefined): string | null =>
    row && col ? applyTableOp(note, { kind: "set", heading: op.heading, edits: [{ row, values: { [col]: RELAY_TEXT }, expect: {} }] }).text : null;
  try {
    switch (op.kind) {
      case "set": {
        // The inverse names the changed row by position and its changed columns by header.
        const first = inverse.kind === "set" ? inverse.edits[0] : undefined;
        return cellTo(first?.row, Object.keys(first?.values ?? {})[0] ?? Object.keys(op.edits[0]?.values ?? {})[0]);
      }
      case "insert": {
        const row = inverse.kind === "delete" ? inverse.row : inverse.kind === "set" ? inverse.edits[0]?.row : undefined;
        return cellTo(row, Object.keys(op.values)[0]);
      }
      case "restore":
        return inverse.kind === "delete" ? cellTo(inverse.row, Object.keys(inverse.expect).find((k) => k.trim() !== "#")) : null;
      case "delete":
      case "marker":
        // The deleted row, or the marker as it was, comes back.
        return applyTableOp(note, inverse).text;
    }
  } catch {
    return null;
  }
}

/** Lines a partner might type into hook 2; each press picks one that differs from what's there. */
const PARTNER_HOOKS = [`"Two seconds in, the harsh S is already gone."`, `"One knob, and the S sounds stop hurting."`];

/** A partner edits hook 2's Hook cell in Obsidian: the table editor then re-pads every table in the note. */
function partnerEditsHook2(): void {
  const path = pathOf("Demo_Tool", "marketing");
  const note = vault.get(path);
  const current = note === undefined ? undefined : parseMarketing(note).hooks?.rows.find((r) => r.num === "2")?.hook.value;
  if (note === undefined || current === undefined) {
    app.toast("Demo Tool's Marketing Engine has no hook 2 to change.");
    return;
  }
  const line = PARTNER_HOOKS.find((l) => l !== current) ?? PARTNER_HOOKS[0];
  const edited = applyTableOp(note, { kind: "set", heading: MARKETING_SECTIONS.hooks, edits: [{ row: { key: "2", col: "#" }, values: { hook: line }, expect: {} }] }).text;
  vault.set(path, S.padTables(edited));
  reread("Demo_Tool", true);
}

// ── Host ────────────────────────────────────────────────────────────────────

const prefs: Prefs = { role: (new URLSearchParams(location.search).get("role") as Prefs["role"]) ?? "both", guideSeen: new URLSearchParams(location.search).has("noguide") };
const host: Host = {
  version: "preview",
  prefs,
  savePrefs: async (p) => {
    Object.assign(prefs, p);
  },
  tickLine: async (path, match, checked) => {
    await wait(350);
    if (failNext) {
      failNext = false;
      renderSim();
      throw new Error("Couldn't find that line in the note any more. Open the note and tick it by hand.");
    }
    if (path.endsWith("SETUP_CHECKLIST.md")) {
      const flip = (to: boolean, line: string) => {
        data = { ...data, setup: data.setup.map((i) => (i.raw === line ? { ...i, checked: to, raw: setChecklistLine(i.raw, { line: i.raw }, to) } : i)) };
        app.setData(data);
      };
      const line = match.line ?? "";
      flip(checked, line);
      const after = setChecklistLine(line, { line }, checked);
      return async () => flip(!checked, after);
    }
    const p = data.products.find((x) => path.startsWith(x.folder))!;
    const start = (match.textStart ?? "").toLowerCase();
    const set = (to: boolean) => update(p.name, { launchItems: data.products.find((x) => x.name === p.name)!.launchItems.map((i) => (i.text.toLowerCase().startsWith(start) ? { ...i, checked: to } : i)) });
    set(checked);
    return async () => set(!checked);
  },
  socialKit: () => ({ ok: !new URLSearchParams(location.search).has("nokit"), reason: "The scrape kit isn't set up on this computer (looked in ~/Developer/social-scrape-kit). See Settings → NXTWAVE Dashboard.", minGapHours: 6 }),
  refreshSocial: async (p, onStep) => {
    const done: ("tiktok" | "instagram")[] = [];
    const errors: string[] = [];
    for (const pl of ["tiktok", "instagram"] as const) {
      if (!p.handles[pl]) continue;
      onStep(`Reading ${pl === "tiktok" ? "TikTok" : "Instagram"} ${p.handles[pl]}… (about a minute)`);
      await wait(900);
      if (failNext) {
        failNext = false;
        renderSim();
        errors.push("Instagram: not logged in on this computer. Use “Log in to Instagram” in Settings → NXTWAVE Dashboard (one time).");
        continue;
      }
      done.push(pl);
    }
    const now = new Date().toISOString().slice(0, 16);
    const cur = data.products.find((x) => x.name === p.name)!;
    update(p.name, {
      organic: cur.organic.map((o) =>
        o.platform.toLowerCase().startsWith("tiktok") && done.includes("tiktok")
          ? { ...o, followers: 1500, totalViews: 23500, bestVideoLink: "https://www.tiktok.com/@demo_tool/video/111", bestVideoViews: 20000 }
          : o.platform.toLowerCase().startsWith("instagram") && done.includes("instagram")
            ? { ...o, followers: 96, totalViews: 3100, bestVideoLink: "https://www.instagram.com/reel/AAA/", bestVideoViews: 1900 }
            : o,
      ),
      socialRefreshed: { ...cur.socialRefreshed, ...Object.fromEntries(done.map((d) => [d, now])) },
      lastSocialPostDate: today,
    });
    return { updated: done, errors };
  },
  setFlag: (p, _doc, key, value) => act(p.name, key === "signed_off_dev" ? { signedOffDev: value } : { signedOffMarketing: value }),
  setFields: async (p, _doc, values) => {
    refuseSecrets(Object.values(values));
    return act(p.name, { handles: { ...p.handles, ...values } });
  },
  openDoc: (p, doc, heading) => app.toast(`Would open ${p.name}/${doc}${heading ? ` # ${heading}` : ""}`),
  openPath: (path) => app.toast(`Would open ${path}`),
  startDay1: (p) => act(p.name, { status: "building", cycleStart: today, gateDate: addDays(today, 27) }),
  postedToday: (p) => act(p.name, { lastSocialPostDate: today }),
  setField: async (p, _doc, key, value) => {
    refuseSecrets([value]);
    return act(p.name, key === "repo_url" ? { repoUrl: value } : { handles: { ...p.handles, [key]: value } });
  },
  createSprint: async (input, startNow) => {
    refuseSecrets(sprintInputTexts(input));
    await wait(500);
    const name = input.name.trim().replace(/\s+/g, "_");
    if (data.products.some((p) => p.name === name)) throw new Error(`02_Active_Sprints/${name} already exists.`);
    // The new notes, filled in from the wizard the way the plugin fills the templates.
    for (const doc of NOTE_DOCS) vault.set(pathOf(name, doc), fillTemplate(doc, renamed(TEMPLATES[doc], name), input, today, startNow));
    data = { ...data, products: [...data.products, mk(name, { status: startNow ? "building" : "queued", cycleStart: startNow ? today : null, category: input.category })] };
    app.setData(data);
    return name;
  },
  copy: async (text) => {
    await navigator.clipboard?.writeText(text).catch(() => undefined);
  },
  editTable: async (p, doc, op) => {
    await wait(350);
    if (failNext) {
      failNext = false;
      renderSim();
      throw new Error(`Can't write ${DOC_FILES[doc]}: the note was renamed. Open the product folder and check the file name.`);
    }
    const path = p.paths[doc] ?? pathOf(p.name, doc);
    const gen = generation;
    const done = await writeNote(p.name, doc, path, op, true);
    if (relayNext) {
      relayNext = false;
      renderSim();
      window.setTimeout(() => {
        const note = vault.get(path);
        const next = gen === generation && note !== undefined ? relayOverwrite(note, op, done.inverse) : null;
        if (next === null || next === note) return;
        vault.set(path, next);
        reread(p.name, doc === "marketing");
      }, 1000);
    }
    return {
      inverse: done.inverse,
      settled: done.settled.then((warning) => (gen === generation ? warning : null)),
      undo: async () => {
        if (gen !== generation) throw new Error("The scenario changed since, so there's nothing to undo.");
        await writeNote(p.name, doc, path, done.inverse, false);
      },
    };
  },
};

applyMotionMode((new URLSearchParams(location.search).get("motion") as "on" | "off" | null) ?? "system");
const app = new DashboardApp(document.getElementById("app")!, host);
data = build();
app.setData(data);
app.focus();

function renderSim() {
  const sim = document.getElementById("sim")!;
  const btn = (label: string, fn: () => void) => {
    const b = h("button", { type: "button" }, label);
    b.addEventListener("click", fn);
    return b;
  };
  const toggleSim = btn(simOpen ? "Hide" : "Simulate ▴", () => {
    simOpen = !simOpen;
    renderSim();
  });
  toggleSim.classList.add("sim-toggle");
  toggleSim.setAttribute("aria-expanded", String(simOpen));
  if (!simOpen) {
    sim.replaceChildren(toggleSim);
    return;
  }
  const select = h("select", { "aria-label": "Scenario" }, Object.entries(SCENARIOS).map(([k, v]) => {
    const o = h("option", { value: k }, v.label);
    if (k === scenario) o.selected = true;
    return o;
  }));
  select.addEventListener("change", () => {
    scenario = select.value;
    history.replaceState(null, "", `?s=${scenario}`);
    relayNext = false;
    data = build();
    app.setData(data);
    renderSim();
  });
  const toggle = (label: string, cls: string, target: HTMLElement = document.body, onCls?: string) => {
    const box = h("input", { type: "checkbox" }) as HTMLInputElement;
    box.checked = target.classList.contains(onCls ?? cls);
    box.addEventListener("change", () => {
      if (cls === "theme-dark") {
        target.classList.toggle("theme-dark", box.checked);
        target.classList.toggle("theme-light", !box.checked);
      } else target.classList.toggle(cls, box.checked);
    });
    return h("label", null, box, label);
  };
  const failBox = h("input", { type: "checkbox" }) as HTMLInputElement;
  failBox.checked = failNext;
  failBox.addEventListener("change", () => (failNext = failBox.checked));
  const relay = btn(relayNext ? "Relay overwrites my next save (armed)" : "Relay overwrites my next save", () => {
    relayNext = !relayNext;
    renderSim();
  });
  relay.setAttribute("aria-pressed", String(relayNext));
  sim.replaceChildren(
    h("strong", null, "Simulate:"),
    select,
    btn("Partner: changelog today", () => update("Demo_Tool", { lastChangelogDate: today, currentVersion: "0.2.1" })),
    btn("Partner: posted 4 days ago", () => update("Demo_Tool", { lastSocialPostDate: addDays(today, -4) })),
    btn("Partner: +$24 revenue today", () => {
      const p = data.products.find((x) => x.name === "Demo_Tool")!;
      const day = p.cycleStart ? Math.round((Date.parse(today) - Date.parse(p.cycleStart)) / 86400000) + 1 : 15;
      const rows = p.ledger.filter((r) => r.day !== day);
      const cur = p.ledger.find((r) => r.day === day) ?? { day, date: today, spend: 0, impressions: 0, clicks: 0, signups: 0, sales: 0, revenue: 0, filled: true };
      update("Demo_Tool", { ledger: [...rows, { ...cur, date: today, filled: true, sales: cur.sales + 1, revenue: cur.revenue + 24 }] });
    }),
    btn("Partner: sign off launch", () => update("Demo_Tool", { signedOffMarketing: true })),
    btn("Partner edits hook 2 now", partnerEditsHook2),
    relay,
    h("label", null, failBox, "fail next action"),
    toggle("reduced motion", "nx-reduce-motion"),
    toggle("dark", "theme-dark"),
    toggleSim,
  );
}
renderSim();
