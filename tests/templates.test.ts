import { describe, expect, it } from "vitest";
import { normalizeDate } from "../src/data/dates";
import { parseProfile } from "../src/data/profile";
import { buildSnapshot } from "../src/data/snapshot";
import { fillTemplate, NewSprintInput, readFrontmatterRaw, frontmatterBlocks, restoreFrontmatter, setFrontmatterRaw } from "../src/data/templates";
import { touchLastUpdated } from "../src/obsidian/writeQueue";
import { doc } from "./helpers";
import { frontmatterOf, MKT_V2_TEMPLATE, SPEC_EMPTY } from "./samples";

const INPUT: NewSprintInput = {
  name: "Demo Tool",
  productType: "Audio plugin",
  pitch: "A one-knob de-esser for home-studio vocals.",
  mechanics: ["One knob", "Finds the S sounds", "Before/after button"],
  tiktok: "",
  instagram: "",
  youtube: "",
  repoUrl: "",
  category: null,
  originIdea: null,
};

/** A raw template: frontmatter keys as the vault's templates write them (empty ones with no space), the plain H1, then `body`. */
const template = (keys: string[], h1: string, body: string) => ["---", ...keys, "---", "", h1, "", ""].join("\n") + body.slice(body.indexOf("## 1."));

/** The new TPL_2 (plan appendix a): its body is the v2 sample's from "## 1." down. */
const TPL_2 = template(
  ["project:", "hub:", "doc_type: marketing_engine", "owner: marketing", "sprint_status: queued", "cycle_start:", "gate_date:", "tiktok:", "instagram:", "youtube:", "x:", "last_social_post_date:", 'last_updated: "{{date:YYYY-MM-DD}}"'],
  "# Marketing Engine",
  MKT_V2_TEMPLATE,
);

/** TPL_1 after the appendix b paste: the quoted date and the 3 profile rows under the pitch. */
const TPL_1 = template(
  ["project:", "hub:", "doc_type: dev_spec", "owner: dev", "sprint_status: queued", "cycle_start:", "gate_date:", "product_type:", "repo_url:", 'last_updated: "{{date:YYYY-MM-DD}}"'],
  "# Dev Spec",
  SPEC_EMPTY,
);

const keys = (s: string) => Object.keys(readFrontmatterRaw(s));

describe("fillTemplate and the quoted date of the new templates", () => {
  it("Marketing Engine: last_updated keeps its quotes and gets today's date", () => {
    const out = fillTemplate("marketing", TPL_2, INPUT, "2026-11-13", false);
    expect(readFrontmatterRaw(out).last_updated).toBe('"2026-11-13"');
    expect(out).not.toContain("{{date");
    expect(keys(out)).toEqual(keys(TPL_2));
    expect(normalizeDate(frontmatterOf(out).last_updated)).toBe("2026-11-13");
    // From the H1 down, the new note is the v2 sample byte for byte (green examples included).
    expect(out.slice(out.indexOf("# Demo Tool"))).toBe(MKT_V2_TEMPLATE.slice(MKT_V2_TEMPLATE.indexOf("# Demo Tool")));
    const p = buildSnapshot("Demo_Tool", "x", { marketing: doc("2_Marketing_Engine.md", frontmatterOf(out), out) });
    expect(p.marketingTouched).toBe("2026-11-13");
    expect([p.marketing?.hooks?.layout, p.hooksTotal, p.hooksFilled, p.competitorsFilled]).toEqual(["v2", 10, 0, 0]);
  });

  it("Dev Spec: quoted date, pitch and mechanics filled, the 3 profile rows left for the Developer", () => {
    const out = fillTemplate("spec", TPL_1, INPUT, "2026-11-13", true);
    expect(readFrontmatterRaw(out)).toMatchObject({ last_updated: '"2026-11-13"', product_type: "Audio plugin", cycle_start: "2026-11-13", sprint_status: "building" });
    expect(keys(out)).toEqual(keys(TPL_1));
    const profile = parseProfile(out, frontmatterOf(out), {});
    expect(profile).toMatchObject({ productType: "Audio plugin", pitch: "A one-knob de-esser for home-studio vocals.", mechanics: INPUT.mechanics });
    expect(profile.missing).toEqual([
      { field: "Who buys it", where: "Dev Spec → 1. One-line pitch (the lines under the pitch)" },
      { field: "Job it does", where: "Dev Spec → 1. One-line pitch (the lines under the pitch)" },
      { field: "Price", where: "Dev Spec → 1. One-line pitch (the lines under the pitch)" },
      { field: "Target platforms", where: "Dev Spec → 4. Tech preset → Target platforms" },
    ]);
  });

  it("the old unquoted date still fills", () => {
    const old = TPL_2.replace('last_updated: "{{date:YYYY-MM-DD}}"', "last_updated: {{date:YYYY-MM-DD}}");
    expect(readFrontmatterRaw(fillTemplate("marketing", old, INPUT, "2026-11-13", false)).last_updated).toBe("2026-11-13");
  });

  it("a template whose date line Obsidian broke still gives a clean, dated note", () => {
    // TPL_2 had this shape on 2026-11-13: the property editor had turned the unquoted date into a nested property.
    const broken = TPL_2.replace('last_updated: "{{date:YYYY-MM-DD}}"', 'last_updated:\n  "{ date:YYYY-MM-DD }":');
    const out = fillTemplate("marketing", broken, INPUT, "2026-11-13", false);
    expect(readFrontmatterRaw(out).last_updated).toBe("2026-11-13");
    expect(out).not.toContain("{ date");
    expect(keys(out)).toEqual(keys(TPL_2));
    expect(normalizeDate(frontmatterOf(out).last_updated)).toBe("2026-11-13");
    // The date bump of a later dashboard edit leaves a single line too.
    expect(touchLastUpdated(broken, "2026-11-14")).not.toContain("{ date");
    expect(readFrontmatterRaw(touchLastUpdated(broken, "2026-11-14")).last_updated).toBe("2026-11-14");
  });
});

describe("frontmatterBlocks and restoreFrontmatter: an Undo puts a property back exactly", () => {
  const note = ['---', 'project: Demo_Tool', 'tiktok:', '  - "@demo_tool"', '  - "@demo_tool_clips"', 'instagram: "@demo"', 'last_updated: "2026-11-12"', '---', '', '# Body', ''].join("\n");
  it("a list property comes back with its nested lines after it was replaced", () => {
    const before = frontmatterBlocks(note);
    expect(before.tiktok).toBe('tiktok:\n  - "@demo_tool"\n  - "@demo_tool_clips"');
    const keys = ["tiktok", "last_updated"];
    const changed = setFrontmatterRaw(note, { tiktok: '"@new_handle"', last_updated: '"2026-11-13"' });
    expect(changed).not.toContain("@demo_tool_clips");
    const undone = restoreFrontmatter(changed, Object.fromEntries(keys.map((k) => [k, before[k]])));
    expect(undone).toBe(note);
  });
  it("a key that wasn't there comes back empty, as before", () => {
    const changed = setFrontmatterRaw(note, { youtube: '"@yt"' });
    expect(readFrontmatterRaw(restoreFrontmatter(changed, { youtube: "youtube: " })).youtube).toBe("");
  });
});
