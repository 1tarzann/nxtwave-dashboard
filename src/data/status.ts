// The color engine. One pure function decides each product's square color, reason and fix button.
// Precedence (top wins): Kill signal → Gate today → Stale → Healthy. Grey = queued / clock not started / closed.

import { addDays, daysBetween, laterDate, relativeDay } from "./dates";
import { computeTotals } from "./snapshot";
import { DashboardData, ProductSnapshot, StatusResult, Thresholds, Totals } from "./types";

export const STATUS_STYLE = {
  kill: { label: "KILL SIGNAL", icon: "✕", meaning: "The numbers say stop: money spent, nobody bought. Open the vote." },
  gate: { label: "DECISION DAY", icon: "⚑", meaning: "Launch day (14) or decision day (28). Something needs signing or voting today." },
  stale: { label: "GONE QUIET", icon: "⏸", meaning: "Nothing happened for 3 days. The fix button shows what to do." },
  healthy: { label: "ON TRACK", icon: "✓", meaning: "Nothing urgent. Keep going." },
  unstarted: { label: "NOT STARTED", icon: "◷", meaning: "Day 1 isn't set, so the 28-day countdown hasn't begun." },
  queued: { label: "WAITING IN LINE", icon: "○", meaning: "Waits for the current sprint's decision. One sprint at a time." },
  closed: { label: "CLOSED", icon: "■", meaning: "Decided: scaled or killed." },
} as const;

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export function sprintDay(cycleStart: string | null, today: string): number | null {
  return cycleStart ? daysBetween(cycleStart, today) + 1 : null;
}

export function phaseName(day: number | null, status: string): string {
  if (day === null) return status === "queued" ? "Waiting in line" : "Not started";
  if (day < 1) return "Starts soon";
  if (day <= 14) return "Building (days 1–14)";
  if (day <= 28) return "Watching the numbers (days 15–28)";
  return status === "extended" ? "Extension" : "Past gate";
}

export function computeStatus(p: ProductSnapshot, th: Thresholds, today: string, totals: Totals = computeTotals(p)): StatusResult {
  const status = p.status.toLowerCase();
  const day = sprintDay(p.cycleStart, today);
  const extended = status === "extended";
  const totalDays = extended ? 35 : 28;
  const base = { day, totalDays, phase: phaseName(day, status), info: [] as string[] };
  const make = (key: StatusResult["key"], reason: string, action: StatusResult["action"], label?: string): StatusResult => ({
    ...base,
    key,
    label: label ?? STATUS_STYLE[key].label,
    icon: STATUS_STYLE[key].icon,
    reason,
    action,
  });

  if (status === "scaled" || status === "killed") {
    return make("closed", status === "scaled" ? "Scaled: kept and improving" : "Killed: archived", null, status.toUpperCase());
  }
  if (status === "queued") {
    return make("queued", "Waits until the current sprint's day-28 decision", null);
  }
  if (day === null) {
    return make("unstarted", "Day 1 isn't set, so the 28-day countdown hasn't started", { kind: "startDay1", label: "Start Day 1" });
  }
  if (day < 1) {
    return make("unstarted", `Day 1 is ${relativeDay(p.cycleStart, today)}`, null);
  }

  // 1. Kill signal
  if (p.verdict === "kill") {
    return make("kill", "You both voted Kill: stop all spending and archive it", { kind: "openDoc", doc: "analytics", heading: "Day-28 verdict", label: "Open the vote" });
  }
  if (day >= 21) {
    if (totals.spend >= th.killSpendNoSales && totals.sales === 0 && totals.signups === 0) {
      return make("kill", `$${fmtMoney(totals.spend)} spent, 0 sales or sign-ups`, { kind: "openDoc", doc: "analytics", heading: "Day-28 verdict", label: "Open the vote" });
    }
    if (th.killMinCtr !== null && totals.ctr !== null && totals.ctr < th.killMinCtr) {
      return make("kill", `Only ${totals.ctr.toFixed(2)}% of people who saw the ad clicked (your minimum is ${th.killMinCtr}%)`, { kind: "openDoc", doc: "analytics", heading: "Day-28 verdict", label: "Open the vote" });
    }
  }

  // 2. Gate today (or overdue)
  if (day === 14) {
    return make("gate", "Launch day: both sign off the Launch Checklist, then publish", { kind: "openDoc", doc: "launch", heading: "Sign-off", label: "Open Launch Checklist" });
  }
  if (day === 28) {
    return make("gate", "Decision day: both partners vote Scale or Kill", { kind: "openDoc", doc: "analytics", heading: "Day-28 verdict", label: "Open the vote" });
  }
  if (extended && day === 35) {
    return make("gate", "The extra week ends today: final vote", { kind: "openDoc", doc: "analytics", heading: "Day-28 verdict", label: "Open the vote" });
  }
  if (day > totalDays && p.verdict === "pending") {
    return make("gate", `The Scale-or-Kill vote is ${plural(day - totalDays, "day")} late`, { kind: "openDoc", doc: "analytics", heading: "Day-28 verdict", label: "Open the vote" }, "DECISION OVERDUE");
  }

  // 3. Stale (phase-aware)
  const devRef = laterDate(p.lastChangelogDate, p.cycleStart);
  const devQuiet = devRef ? daysBetween(devRef, today) : 0;
  if (day <= 14) {
    const mktRef = laterDate(p.marketingTouched, p.cycleStart);
    const mktQuiet = mktRef ? daysBetween(mktRef, today) : 0;
    const devStale = devQuiet >= th.staleDays;
    const mktStale = mktQuiet >= th.staleDays;
    if (devStale && (!mktStale || devQuiet >= mktQuiet)) {
      const r = make("stale", `No progress logged in the Changelog for ${plural(devQuiet, "day")}`, { kind: "openDoc", doc: "changelog", label: "Open Changelog" });
      if (mktStale) r.info.push(`Marketing notes untouched for ${plural(mktQuiet, "day")}`);
      return r;
    }
    if (mktStale) {
      const r = make("stale", `Marketing notes untouched for ${plural(mktQuiet, "day")}`, { kind: "openDoc", doc: "marketing", label: "Open Marketing Engine" });
      if (devStale) r.info.push(`No progress logged in the Changelog for ${plural(devQuiet, "day")}`);
      return r;
    }
    // Early warning: one day before it would turn Stale.
    if (devQuiet === th.staleDays - 1) base.info.push("Goes quiet tomorrow without a Changelog entry");
    else if (mktQuiet === th.staleDays - 1) base.info.push("Goes quiet tomorrow without a marketing edit");
    return make("healthy", `Progress logged ${relOr(p.lastChangelogDate, today, "not yet")} · marketing edited ${relOr(p.marketingTouched, today, "not yet")}`, null);
  } else {
    const launchDay = addDays(p.cycleStart as string, 13);
    const postRef = laterDate(p.lastSocialPostDate, launchDay) as string;
    const postQuiet = daysBetween(postRef, today);
    if (postQuiet >= th.staleDays) {
      const why = p.lastSocialPostDate ? `No social post in ${plural(postQuiet, "day")}` : `No social post since launch (${plural(postQuiet, "day")})`;
      return make("stale", why, { kind: "postedToday", label: "Posted today" });
    }
    if (th.staleDevAfterLaunchDays !== null && devQuiet >= th.staleDevAfterLaunchDays) {
      return make("stale", `No developer progress logged for ${plural(devQuiet, "day")}`, { kind: "openDoc", doc: "changelog", label: "Open Changelog" });
    }
    if (devQuiet >= th.staleDays) base.info.push(`Developer quiet ${devQuiet} days (normal after launch: bug fixes only)`);
    if (postQuiet === th.staleDays - 1) base.info.push("Goes quiet tomorrow without a post");
    // 4. Healthy
    return make("healthy", `Posted ${relOr(p.lastSocialPostDate, today, "not yet")} · progress logged ${relOr(p.lastChangelogDate, today, "not yet")}`, null);
  }
}

const relOr = (iso: string | null, today: string, none: string) => (iso ? relativeDay(iso, today) : none);

export function fmtMoney(n: number): string {
  return Number.isInteger(n) ? n.toLocaleString("en-US") : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const PRIORITY: Record<StatusResult["key"], number> = { kill: 0, gate: 1, stale: 2, unstarted: 3, healthy: 9, queued: 9, closed: 9 };

export interface NextAction {
  id: string;
  product: ProductSnapshot;
  status: StatusResult;
}

/** Everything that needs a partner, most urgent first. The first item is the "Do this next" banner. */
export function nextActions(data: DashboardData): NextAction[] {
  return data.products
    .map((product) => ({ product, status: computeStatus(product, data.thresholds, data.today) }))
    .filter((x) => PRIORITY[x.status.key] < 9 && x.status.action)
    .sort((a, b) => PRIORITY[a.status.key] - PRIORITY[b.status.key])
    .map((x) => ({ ...x, id: `${x.product.name}:${x.status.key}:${x.status.action?.kind}` }));
}

/** The one product whose clock is running (status other than queued/scaled/killed). */
export function activeProducts(products: ProductSnapshot[]): ProductSnapshot[] {
  return products.filter((p) => !["queued", "scaled", "killed"].includes(p.status.toLowerCase()));
}
