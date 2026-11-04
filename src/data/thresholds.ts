// Kill/stale thresholds live in the frontmatter of 00_Global_System/Launch_Framework.md (partners set them).

import { num } from "./markdown";
import { DEFAULT_THRESHOLDS, Thresholds } from "./types";

const KEYS = ["kill_spend_no_sales", "kill_min_ctr", "stale_days", "stale_dev_after_launch_days"] as const;

function read(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") return num(v);
  return null;
}

export function parseThresholds(fm: Record<string, unknown> | null | undefined): Thresholds {
  const f = fm ?? {};
  const missing = !KEYS.some((k) => k in f);
  return {
    killSpendNoSales: read(f.kill_spend_no_sales) ?? DEFAULT_THRESHOLDS.killSpendNoSales,
    killMinCtr: read(f.kill_min_ctr),
    staleDays: Math.max(1, read(f.stale_days) ?? DEFAULT_THRESHOLDS.staleDays),
    staleDevAfterLaunchDays: read(f.stale_dev_after_launch_days),
    missing,
  };
}
