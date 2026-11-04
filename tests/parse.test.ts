import { describe, expect, it } from "vitest";
import { countCheckboxes, num, parseTable, plainText, section, splitRow } from "../src/data/markdown";
import { buildSnapshot, computeTotals, parseChangelog } from "../src/data/snapshot";
import { buildHubNote, fillTemplate, readFrontmatterRaw, sanitizeName, setFrontmatterRaw, yamlValue } from "../src/data/templates";
import { DOC_ORDER } from "../src/data/types";
import { doc, fixture, hasFixtures } from "./helpers";

describe("markdown helpers", () => {
  it("splitRow keeps escaped pipes inside wiki links", () => {
    expect(splitRow("| a | [[x/y\\|Y]] | c |")).toEqual(["a", "[[x/y\\|Y]]", "c"]);
  });
  it("section stops at the next same-level heading and ignores code fences", () => {
    const md = "## 1. A\nalpha\n```\n## not a heading\n```\n### sub\nbeta\n## 2. B\ngamma";
    expect(section(md, "1. a")).toBe("alpha\n```\n## not a heading\n```\n### sub\nbeta");
    expect(section(md, "missing")).toBeNull();
  });
  it("parseTable pads short rows", () => {
    expect(parseTable("| a | b |\n|---|---|\n| 1 |")).toEqual({ headers: ["a", "b"], rows: [["1", ""]] });
  });
  it("num handles money and percent", () => {
    expect(num("$1,240.50")).toBe(1240.5);
    expect(num("0.9%")).toBe(0.9);
    expect(num("")).toBeNull();
    expect(num("n/a")).toBeNull();
  });
  it("countCheckboxes ignores table cells", () => {
    expect(countCheckboxes("- [x] a\n- [ ] b\n| Dev | [ ] |")).toEqual({ done: 1, total: 2 });
  });
  it("plainText strips links", () => {
    expect(plainText("see [[02_Active_Sprints/X/1_Dev_Spec\\|Spec]] and `code`")).toBe("see Spec and code");
  });
});

describe("changelog", () => {
  it("skips the YYYY-MM-DD template entry and reads real ones", () => {
    const md = "## [0.2.0] - 2026-11-05\n### Added\n- Reverb knob\n### Fixed\n- Buffer crash\n\n## [0.1.0] - YYYY-MM-DD\n### Added\n- ";
    expect(parseChangelog(md)).toEqual([{ version: "0.2.0", date: "2026-11-05", added: ["Reverb knob"], fixed: ["Buffer crash"], removed: [] }]);
  });
});

describe.skipIf(!hasFixtures)("real templates", () => {
  const docs = () => {
    const names = ["TPL_1_Dev_Spec.md", "TPL_2_Marketing_Engine.md", "TPL_3_Analytics_And_Gate.md", "TPL_4_Launch_Checklist.md", "TPL_5_Changelog.md", "TPL_6_RedTeam_Audit.md"];
    return Object.fromEntries(DOC_ORDER.map((k, i) => [k, doc(names[i], {}, fixture(names[i]))]));
  };

  it("an empty template sprint parses with no warnings", () => {
    const p = buildSnapshot("T", "T", docs(), doc("T/T_Hub.md", { sprint_status: "queued" }));
    expect(p.warnings).toEqual([]);
    expect(p.ledger).toHaveLength(14);
    expect(p.organic.map((o) => o.platform)).toEqual(["TikTok", "Instagram Reels", "YouTube Shorts"]);
    expect(p.mechanics).toEqual([]);
    expect(p.milestones).toEqual({ done: 0, total: 4 });
    expect(p.brandKit).toEqual({ filled: 0, total: 6 });
    expect(p.hooksFilled).toBe(0);
    expect(p.launchChecks.total).toBeGreaterThan(5);
    expect(p.changelog).toEqual([]);
  });

  it("reads a filled ledger, organic table and brand kit", () => {
    const d = docs();
    d.analytics.body = d.analytics.body
      .replace("| 15 | | | | | | | | | | |", "| 15 | 2026-11-15 | $40 | 5000 | 50 | 1% | 3 | 1 | $19.99 | 13.33 | |")
      .replace("| TikTok | | | | |", "| TikTok | 120 | 8,400 | https://t.co/x | 5000 |");
    d.marketing.body = d.marketing.body.replace("| Stripe product / payment link | |", "| Stripe product / payment link | https://buy.stripe.com/test |");
    const p = buildSnapshot("T", "T", d);
    const t = computeTotals(p);
    expect(t).toMatchObject({ spend: 40, revenue: 19.99, impressions: 5000, clicks: 50, signups: 3, sales: 1, views: 8400 });
    expect(t.ctr).toBeCloseTo(1);
    expect(p.stripeLink).toBe("https://buy.stripe.com/test");
    expect(p.brandKit.filled).toBe(1);
  });

  it("fillTemplate keeps every frontmatter field in order and fills the spec", () => {
    const input = { name: "Vocal Chain AI", productType: "VST audio plugin", pitch: "Auto-mixes vocals in one knob", mechanics: ["Input", "DSP chain", "Mix knob"], tiktok: "@vocalchain", instagram: "", youtube: "", repoUrl: "https://github.com/x/y", category: null, originIdea: null };
    const raw = fixture("TPL_1_Dev_Spec.md");
    const out = fillTemplate("spec", raw, input, "2026-11-03", true);
    const keys = (s: string) => [...(/^---\n([\s\S]*?)\n---/.exec(s)?.[1] ?? "").matchAll(/^([a-z_]+):/gm)].map((m) => m[1]);
    expect(keys(out)).toEqual(keys(raw));
    expect(out).toContain("project: Vocal_Chain_AI\n");
    expect(out).toContain("sprint_status: building\n");
    expect(out).toContain("cycle_start: 2026-11-03\n");
    expect(out).toContain("gate_date: 2026-11-30\n");
    expect(out).toContain('repo_url: "https://github.com/x/y"\n');
    expect(out).toContain("last_updated: 2026-11-03\n");
    expect(out).toContain('hub: "[[02_Active_Sprints/Vocal_Chain_AI/Vocal_Chain_AI_Hub|Vocal Chain AI Hub]]"\n');
    expect(out).toContain("# Vocal Chain AI: Dev Spec\n\n[[02_Active_Sprints/Master_Kanban|🏠 All Products]] ▸ [[02_Active_Sprints/Vocal_Chain_AI/Vocal_Chain_AI_Hub|Vocal Chain AI]] ·");
    expect(out).toContain("> Auto-mixes vocals in one knob");
    expect(out).toContain("1. Input\n2. DSP chain\n3. Mix knob");
    expect(out).not.toContain("{{date");

    const mkt = fillTemplate("marketing", fixture("TPL_2_Marketing_Engine.md"), input, "2026-11-03", false);
    expect(mkt).toContain('tiktok: "@vocalchain"\n');
    expect(mkt).toContain("sprint_status: queued\n");
    expect(mkt).toContain("cycle_start: \n");
  });
});

describe("hub note", () => {
  const input = { name: "Demo Game", productType: "", pitch: "", mechanics: [], tiktok: "", instagram: "", youtube: "", repoUrl: "", category: { path: "04_Company_Ops/Categories/Games", title: "Games" }, originIdea: null };
  it("matches the existing hub layout and links back", () => {
    const hub = buildHubNote(input, "2026-11-03", false, "Demo Tool");
    expect(hub).toContain('category: "[[04_Company_Ops/Categories/Games|Games]]"\n');
    expect(hub).toContain("origin_idea: \n");
    expect(hub).toContain("sprint_status: queued\n");
    expect(hub).toContain("# Demo Game: Product Hub");
    expect(hub).toContain("No building or ad spend until Demo Tool has its day-28 verdict.");
    expect(hub).toContain("- [[02_Active_Sprints/Demo_Game/5_Changelog|5 · Changelog]]");
    const snap = buildSnapshot("Demo_Game", "x", {}, doc("x/Demo_Game_Hub.md", { sprint_status: "queued", category: "[[04_Company_Ops/Categories/Games|Games]]" }));
    expect(snap.category).toEqual({ path: "04_Company_Ops/Categories/Games", title: "Games" });
    expect(snap.displayName).toBe("Demo Game");
  });
  it("hub status wins and disagreement flags out-of-sync", () => {
    const snap = buildSnapshot("P", "x", { spec: doc("a", { sprint_status: "queued" }) }, doc("h", { sprint_status: "building" }));
    expect(snap.status).toBe("building");
    expect(snap.outOfSync).toBe(true);
  });
});

describe("line-level frontmatter edits", () => {
  const raw = "---\nproject: X\ncycle_start: \nrepo_url: \nlast_updated: 2026-11-01\n---\n\n# Body: cycle_start: stays\n";
  it("changes only the target lines and keeps empty values as they were", () => {
    const out = setFrontmatterRaw(raw, { cycle_start: "2026-11-03", last_updated: "2026-11-03" });
    expect(out).toBe("---\nproject: X\ncycle_start: 2026-11-03\nrepo_url: \nlast_updated: 2026-11-03\n---\n\n# Body: cycle_start: stays\n");
  });
  it("round-trips for undo", () => {
    const before = readFrontmatterRaw(raw);
    const changed = setFrontmatterRaw(raw, { cycle_start: "2026-11-03" });
    expect(setFrontmatterRaw(changed, { cycle_start: before.cycle_start })).toBe(raw);
  });
  it("appends a missing key", () => {
    expect(setFrontmatterRaw("---\na: 1\n---\n", { b: "2" })).toBe("---\na: 1\nb: 2\n---\n");
  });
});

describe("names and YAML", () => {
  it("sanitizeName", () => {
    expect(sanitizeName("  VocalChain AI! ")).toBe("VocalChain_AI");
    expect(sanitizeName("Demo Game")).toBe("Demo_Game");
  });
  it("yamlValue quotes what YAML would misread", () => {
    expect(yamlValue("Roblox game")).toBe("Roblox game");
    expect(yamlValue("@handle")).toBe('"@handle"');
    expect(yamlValue("https://x.y")).toBe('"https://x.y"');
    expect(yamlValue("true")).toBe('"true"');
    expect(yamlValue("")).toBe("");
  });
});
