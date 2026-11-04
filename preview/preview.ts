// Browser harness: renders the real UI with fake products, plus a Simulate panel that triggers
// every microinteraction (live partner edits, new revenue, failed actions, reduced motion, dark mode).

import { parseChecklistNote } from "../src/data/company";
import { addDays, toIsoDate } from "../src/data/dates";
import { buildSnapshot } from "../src/data/snapshot";
import { DEFAULT_THRESHOLDS, DashboardData, LedgerRow, ProductSnapshot } from "../src/data/types";
import { DashboardApp } from "../src/ui/app";
import { applyMotionMode } from "../src/ui/motion";
import { h } from "../src/ui/dom";
import { Host, Prefs, Undo } from "../src/ui/host";
import { setChecklistLine } from "../src/data/templates";

const today = toIsoDate(Date.now());
const startFor = (day: number) => addDays(today, -(day - 1));

function mk(name: string, over: Partial<ProductSnapshot>): ProductSnapshot {
  const base = buildSnapshot(name, `HQ/02_Active_Sprints/${name}`, {}, { path: `HQ/02_Active_Sprints/${name}/${name}_Hub.md`, frontmatter: {}, body: "", mtime: 0 });
  const paths = { spec: "1_Dev_Spec.md", marketing: "2_Marketing_Engine.md", analytics: "3_Analytics_And_Gate.md", launch: "4_Launch_Checklist.md", changelog: "5_Changelog.md", audit: "6_RedTeam_Audit.md" };
  return {
    ...base,
    warnings: [],
    paths: Object.fromEntries(Object.entries(paths).map(([k, v]) => [k, `${base.folder}/${v}`])),
    organic: [
      { platform: "TikTok", followers: null, totalViews: null, bestVideoLink: "", bestVideoViews: null },
      { platform: "Instagram Reels", followers: null, totalViews: null, bestVideoLink: "", bestVideoViews: null },
      { platform: "YouTube Shorts", followers: null, totalViews: null, bestVideoLink: "", bestVideoViews: null },
    ],
    brandKit: { filled: 2, total: 6 },
    launchChecks: { done: 4, total: 13 },
    launchItems: [
      { text: "Core mechanics 1–3 work end-to-end", checked: true },
      { text: "Version tagged in 5_Changelog", checked: false },
      { text: "Build or store listing is live", checked: false },
      { text: "Checkout works with a real test purchase (Stripe or platform)", checked: false },
    ],
    milestones: { done: 1, total: 4 },
    ...over,
  };
}

const ledger = (rows: [number, number, number, number, number, number][]): LedgerRow[] =>
  rows.map(([day, spend, impressions, clicks, sales, revenue]) => ({ day, date: "", spend, impressions, clicks, signups: sales, sales, revenue, filled: true }));

type Scenario = { label: string; active: Partial<ProductSnapshot> };
const SCENARIOS: Record<string, Scenario> = {
  unstarted: { label: "Clock not started (today's real state)", active: { status: "building", cycleStart: null } },
  prelaunch: { label: "Day 3 · nothing filled yet (pre-launch)", active: { status: "building", cycleStart: startFor(3), lastChangelogDate: addDays(today, -1), marketingTouched: today } },
  day16empty: { label: "Day 16 · launched, nothing logged", active: { status: "watching", cycleStart: startFor(16), lastSocialPostDate: addDays(today, -1), lastChangelogDate: addDays(today, -2), handles: { tiktok: "@demo_tool", instagram: "@demo.tool", youtube: "@demotool", x: "" }, stripeLink: "https://buy.stripe.com/test", backlog: { total: 4, scripted: 0, recorded: 0, edited: 0, scheduled: 4 } } },
  build: {
    label: "Day 9 · building, healthy",
    active: { status: "building", cycleStart: startFor(9), lastChangelogDate: addDays(today, -1), marketingTouched: today, currentVersion: "0.2.0", changelog: [{ version: "0.2.0", date: addDays(today, -1), added: ["Wet/dry mix knob"], fixed: ["Audio buffer crash"], removed: [] }], mechanics: ["Input dry vocal", "Real-time EQ + compression chain", "Wet/dry knob + license check"], pitch: "Auto-mixes rap vocals in one knob", competitorsFilled: 3, hooksFilled: 2, backlog: { total: 6, scripted: 2, recorded: 1, edited: 1, scheduled: 2 } },
  },
  staleBuild: { label: "Day 8 · stale (no changelog 4 days)", active: { status: "building", cycleStart: startFor(8), lastChangelogDate: addDays(today, -4), marketingTouched: addDays(today, -1) } },
  gate14: { label: "Day 14 · launch gate", active: { status: "building", cycleStart: startFor(14), lastChangelogDate: today, signedOffDev: true, launchChecks: { done: 13, total: 13 }, blockingIssuesOpen: 0, auditDate: addDays(today, -1) } },
  watch: {
    label: "Day 20 · watching, healthy, revenue",
    active: {
      status: "watching",
      cycleStart: startFor(20),
      lastSocialPostDate: today,
      lastChangelogDate: addDays(today, -6),
      handles: { tiktok: "@demo_tool", instagram: "@demo.tool", youtube: "", x: "" },
      repoUrl: "https://github.com/example/demo-tool",
      stripeLink: "https://buy.stripe.com/test",
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
let scenario = new URLSearchParams(location.search).get("s") ?? "watch";
let data: DashboardData;

function build(): DashboardData {
  const sc = SCENARIOS[scenario] ?? SCENARIOS.watch;
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
      mk("Demo_Tool", { productType: "VST audio plugin", category: { path: "04_Company_Ops/Categories/Audio_Plugins", title: "Audio Plugins" }, ...sc.active }),
      mk("Sample_Game", { status: "queued", productType: "Roblox game", category: { path: "04_Company_Ops/Categories/Roblox_Games", title: "Roblox Games" } }),
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
  setFields: (p, _doc, values) => act(p.name, { handles: { ...p.handles, ...values } }),
  openDoc: (p, doc, heading) => app.toast(`Would open ${p.name}/${doc}${heading ? ` # ${heading}` : ""}`),
  openPath: (path) => app.toast(`Would open ${path}`),
  startDay1: (p) => act(p.name, { status: "building", cycleStart: today, gateDate: addDays(today, 27) }),
  postedToday: (p) => act(p.name, { lastSocialPostDate: today }),
  setField: (p, _doc, key, value) =>
    act(p.name, key === "repo_url" ? { repoUrl: value } : { handles: { ...p.handles, [key]: value } }),
  createSprint: async (input, startNow) => {
    await wait(500);
    const name = input.name.trim().replace(/\s+/g, "_");
    if (data.products.some((p) => p.name === name)) throw new Error(`02_Active_Sprints/${name} already exists.`);
    data = { ...data, products: [...data.products, mk(name, { status: startNow ? "building" : "queued", cycleStart: startNow ? today : null, productType: input.productType, category: input.category })] };
    app.setData(data);
    return name;
  },
  copy: async (text) => {
    await navigator.clipboard?.writeText(text).catch(() => undefined);
  },
};

applyMotionMode((new URLSearchParams(location.search).get("motion") as "on" | "off" | null) ?? "system");
const app = new DashboardApp(document.getElementById("app")!, host);
data = build();
app.setData(data);
app.focus();

function renderSim() {
  const sim = document.getElementById("sim")!;
  const select = h("select", null, Object.entries(SCENARIOS).map(([k, v]) => {
    const o = h("option", { value: k }, v.label);
    if (k === scenario) o.selected = true;
    return o;
  }));
  select.addEventListener("change", () => {
    scenario = select.value;
    history.replaceState(null, "", `?s=${scenario}`);
    data = build();
    app.setData(data);
  });
  const btn = (label: string, fn: () => void) => {
    const b = h("button", { type: "button" }, label);
    b.addEventListener("click", fn);
    return b;
  };
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
    h("label", null, failBox, "fail next action"),
    toggle("reduced motion", "nx-reduce-motion"),
    toggle("dark", "theme-dark"),
  );
}
renderSim();
