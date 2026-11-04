import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildSnapshot } from "../src/data/snapshot";
import { DocKey, ProductSnapshot, RawDoc } from "../src/data/types";

/** Real TPL_ templates copied from the vault (git-ignored; tests that need them skip in CI). */
export const FIXTURES = join(__dirname, "fixtures");
export const hasFixtures = existsSync(join(FIXTURES, "TPL_1_Dev_Spec.md"));

export function fixture(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf8");
}

/** A product snapshot with sensible defaults; override any field. */
export function product(over: Partial<ProductSnapshot> = {}): ProductSnapshot {
  const base = buildSnapshot("Demo", "HQ/02_Active_Sprints/Demo", {});
  return {
    ...base,
    warnings: [],
    status: "building",
    cycleStart: "2026-11-01",
    lastChangelogDate: null,
    marketingTouched: null,
    lastSocialPostDate: null,
    ...over,
  };
}

export function doc(path: string, frontmatter: Record<string, unknown>, body = "", mtime = 0): RawDoc {
  return { path, frontmatter, body, mtime };
}

export type Docs = Partial<Record<DocKey, RawDoc>>;
