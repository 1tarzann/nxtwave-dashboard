// Turns the 6 raw sprint docs into one ProductSnapshot. Pure: no Obsidian, no clock.

import { laterDate, normalizeDate, toIsoDate } from "./dates";
import { readSocialMarker } from "./social";
import { cell, checklistLines, col, countCheckboxes, isChecked, isPlaceholder, num, parseLink, plainText, str, tableIn } from "./markdown";
import { Cell, HookRow, MarketingNote, parseMarketing, videoRule } from "./marketing";
import { stripeSecret } from "./marketingOps";
import { parseProfile } from "./profile";
import {
  BacklogCounts,
  ChangelogEntry,
  DOC_FILES,
  DOC_ORDER,
  DocKey,
  LedgerRow,
  OrganicRow,
  ProductSnapshot,
  RawDoc,
  Totals,
} from "./types";

function numFm(v: unknown): number {
  const n = typeof v === "number" ? v : num(str(v));
  return n ?? 0;
}

function bool(v: unknown): boolean {
  return v === true || str(v).toLowerCase() === "true";
}

export function parseChangelog(body: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  let cur: ChangelogEntry | null = null;
  let bucket: "added" | "fixed" | "removed" | null = null;
  for (const line of body.split(/\r?\n/)) {
    const head = /^##\s*\[([^\]]+)\]\s*[-–]\s*(\S+)/.exec(line);
    if (head) {
      cur = { version: head[1].trim(), date: head[2].trim(), added: [], fixed: [], removed: [] };
      entries.push(cur);
      bucket = null;
      continue;
    }
    if (!cur) continue;
    const sub = /^###\s*(added|fixed|removed)/i.exec(line);
    if (sub) {
      bucket = sub[1].toLowerCase() as "added" | "fixed" | "removed";
      continue;
    }
    const item = /^\s*[-*]\s+(.*\S)\s*$/.exec(line);
    if (item && bucket) cur[bucket].push(plainText(item[1]));
  }
  // Template placeholders ("YYYY-MM-DD", empty bullets) are not real entries.
  return entries.filter((e) => normalizeDate(e.date) !== null);
}

function parseLedger(body: string): LedgerRow[] | null {
  const t = tableIn(body, "ledger");
  if (!t) return null;
  const c = {
    day: col(t, "day"),
    date: col(t, "date"),
    spend: col(t, "spend"),
    impressions: col(t, "impression"),
    clicks: col(t, "clicks"),
    signups: col(t, "sign-up", "signup", "install"),
    sales: col(t, "sales"),
    revenue: col(t, "revenue"),
  };
  const rows: LedgerRow[] = [];
  const numCols = [c.spend, c.impressions, c.clicks, c.signups, c.sales, c.revenue];
  for (const r of t.rows) {
    const day = num(cell(r, c.day));
    if (day === null) continue; // skips the Total row
    rows.push({
      filled: numCols.some((i) => cell(r, i) !== ""),
      day,
      date: cell(r, c.date),
      spend: num(cell(r, c.spend)) ?? 0,
      impressions: num(cell(r, c.impressions)) ?? 0,
      clicks: num(cell(r, c.clicks)) ?? 0,
      signups: num(cell(r, c.signups)) ?? 0,
      sales: num(cell(r, c.sales)) ?? 0,
      revenue: num(cell(r, c.revenue)) ?? 0,
    });
  }
  return rows;
}

function parseOrganic(body: string): OrganicRow[] {
  const t = tableIn(body, "organic");
  if (!t) return [];
  const c = {
    platform: col(t, "platform"),
    followers: col(t, "followers"),
    views: col(t, "total views"),
    link: col(t, "best video link", "link"),
    bestViews: col(t, "best video views"),
  };
  return t.rows
    .filter((r) => cell(r, c.platform))
    .map((r) => ({
      platform: cell(r, c.platform),
      followers: num(cell(r, c.followers)),
      totalViews: num(cell(r, c.views)),
      bestVideoLink: cell(r, c.link),
      bestVideoViews: num(cell(r, c.bestViews)),
    }));
}

/** Parses a frontmatter link like "[[04_Company_Ops/Categories/Audio_Plugins|Audio Plugins]]" (it lives in markdown.ts). */
export { parseLink };

export const displayName = (folderName: string) => folderName.replace(/_/g, " ");

/** What's filled in the Marketing Engine: the numbers on the Marketing side and in the quests. */
export interface MarketingCounts {
  competitorsFilled: number;
  hooksFilled: number;
  hooksTotal: number;
  backlog: BacklogCounts;
  brandKit: { filled: number; total: number };
  stripeLink: string;
}

/**
 * Counts the Marketing Engine. Green examples never count, since cell() strips them.
 * Old notes (v1: 3 hooks, no Rating column) keep the rules they always had, so their numbers stay the same;
 * only a research "MISSING:" row is never a competitor. In new notes (v2: 10 rated hooks) every box must hold
 * more than a placeholder (TBD, ___, MISSING:, left-over "e.g." text from a half-deleted example), a
 * Don't use hook needs no demo shot, and a video is any row Videos to make shows (isVideoRow): one made by
 * "Use in a video" counts at once, as not recorded yet. A Stripe secret key is never a filled row or the payment link.
 */
export function marketingCounts(m: MarketingNote | null): MarketingCounts {
  const v2 = m?.hooks?.layout === "v2";
  const filled = (v: string) => !isPlaceholder(v);
  /** Old notes: any text. New notes: not a placeholder. */
  const typed = (c: Cell) => (v2 ? filled(c.value) : c.value !== "");

  const competitorsFilled = (m?.competitors ?? []).filter((r) => (v2 ? filled(r.name.value) : r.name.value !== "" && r.missing === null)).length;

  const hooks = m?.hooks?.rows ?? [];
  const v1Hook = (r: HookRow) => r.hook.value !== "" && !r.hook.value.includes("___") && r.demo.value !== "";
  const v2Hook = (r: HookRow) => filled(r.hook.value) && (r.rating === "avoid" || filled(r.demo.value));

  // The rule Videos to make uses (videoRule): v1, a video counts once its Format or Status has text; v2, any row
  // that isn't only examples, and one without a status is not recorded yet. Its stage is the first of scheduled / edited / recorded / scripted.
  const backlog: BacklogCounts = { total: 0, scripted: 0, recorded: 0, edited: 0, scheduled: 0 };
  const isVideo = videoRule(m);
  for (const r of m?.backlog ?? []) {
    if (!isVideo(r)) continue;
    backlog.total++;
    if (r.status) backlog[r.status]++;
    else if (v2) backlog.scripted++;
  }

  // Rows without an Asset label don't count. The last Stripe row holds the payment link. A secret key is neither.
  const brand = (m?.brandKit ?? []).filter((r) => r.label !== "");
  const stripe = brand.filter((r) => r.label.toLowerCase().includes("stripe")).pop()?.value.value ?? "";
  const asset = (c: Cell) => typed(c) && !stripeSecret(c.value);

  return {
    competitorsFilled,
    hooksFilled: hooks.filter(v2 ? v2Hook : v1Hook).length,
    hooksTotal: v2 ? hooks.length : 3,
    backlog,
    brandKit: { filled: brand.filter((r) => asset(r.value)).length, total: brand.length },
    stripeLink: (v2 && !filled(stripe)) || stripeSecret(stripe) ? "" : stripe,
  };
}

/** Day-28 vote table: the row whose label mentions "vote", one column per partner. */
function parseVotes(body: string): { dev: string; marketing: string } {
  const t = tableIn(body, "verdict");
  if (!t) return { dev: "", marketing: "" };
  const row = t.rows.find((r) => (r[0] ?? "").toLowerCase().includes("vote"));
  if (!row) return { dev: "", marketing: "" };
  return { dev: cell(row, col(t, "developer", "dev")), marketing: cell(row, col(t, "marketer", "marketing")) };
}

export function buildSnapshot(name: string, folder: string, docs: Partial<Record<DocKey, RawDoc>>, hub?: RawDoc | null): ProductSnapshot {
  const warnings: string[] = [];
  const hubFm = hub?.frontmatter ?? {};
  const fm = (k: DocKey) => docs[k]?.frontmatter ?? {};
  const body = (k: DocKey) => docs[k]?.body ?? "";

  for (const k of DOC_ORDER) if (!docs[k]) warnings.push(`Missing ${DOC_FILES[k]}`);

  // Status + clock, checked across all 6 files.
  // The hub note is the source of truth for status (Launch_Framework §5); the 6 docs must match it.
  const present = DOC_ORDER.filter((k) => docs[k]);
  const allFm = [...(hub ? [hubFm] : []), ...present.map((k) => fm(k))];
  const statuses = new Set(allFm.map((f) => str(f.sprint_status)).filter(Boolean));
  const starts = new Set(allFm.map((f) => normalizeDate(f.cycle_start) ?? ""));
  const status = str(hubFm.sprint_status) || (present[0] && str(fm(present[0]).sprint_status)) || "queued";
  const cycleStart = allFm.map((f) => normalizeDate(f.cycle_start)).find(Boolean) ?? null;
  const gateDate = allFm.map((f) => normalizeDate(f.gate_date)).find(Boolean) ?? null;
  const outOfSync = statuses.size > 1 || starts.size > 1;
  if (!hub && present.length) warnings.push(`Missing ${name}_Hub`);

  // Marketing. Any change to the note (typing, research, Ask for research, Looks good) counts as Marketer activity.
  const marketingDoc = docs.marketing;
  const marketingTouched = marketingDoc
    ? laterDate(marketingDoc.mtime > 0 ? toIsoDate(marketingDoc.mtime) : null, normalizeDate(fm("marketing").last_updated))
    : null;
  const marketing = marketingDoc ? parseMarketing(body("marketing")) : null;
  const counts = marketingCounts(marketing);

  // Analytics.
  const ana = body("analytics");
  const ledger = parseLedger(ana);
  if (docs.analytics && ledger === null) warnings.push("Couldn't read the ledger table (3_Analytics_And_Gate §1)");

  // Dev spec. The pitch and the core mechanics come from the profile, examples stripped.
  const spec = body("spec");
  const profile = parseProfile(spec, fm("spec"), hubFm);
  const plan = tableIn(spec, "build plan");
  const doneCol = plan ? col(plan, "done") : -1;
  const milestones = plan
    ? { done: plan.rows.filter((r) => isChecked(cell(r, doneCol))).length, total: plan.rows.length }
    : { done: 0, total: 0 };

  return {
    name,
    displayName: displayName(name),
    folder,
    paths: Object.fromEntries(present.map((k) => [k, docs[k]!.path])),
    hubPath: hub?.path ?? null,
    category: parseLink(hubFm.category),
    originIdea: parseLink(hubFm.origin_idea),
    status,
    outOfSync,
    cycleStart,
    gateDate,
    productType: str(fm("spec").product_type),
    repoUrl: str(fm("spec").repo_url),
    handles: {
      tiktok: str(fm("marketing").tiktok),
      instagram: str(fm("marketing").instagram),
      youtube: str(fm("marketing").youtube),
      x: str(fm("marketing").x ?? fm("marketing").twitter),
    },
    hasXField: "x" in fm("marketing") || "twitter" in fm("marketing"),
    lastSocialPostDate: normalizeDate(fm("marketing").last_social_post_date),
    marketingTouched,
    lastChangelogDate: normalizeDate(fm("changelog").last_changelog_date),
    currentVersion: str(fm("changelog").current_version) || "0.0.0",
    changelog: parseChangelog(body("changelog")),
    totalSpendFm: numFm(fm("analytics").total_spend),
    totalRevenueFm: numFm(fm("analytics").total_revenue),
    verdict: str(fm("analytics").verdict).toLowerCase() || "pending",
    ledger: ledger ?? [],
    organic: parseOrganic(ana),
    socialRefreshed: readSocialMarker(ana),
    stripeLink: counts.stripeLink,
    pitch: profile.pitch,
    mechanics: profile.mechanics,
    milestones,
    competitorsFilled: counts.competitorsFilled,
    hooksFilled: counts.hooksFilled,
    hooksTotal: counts.hooksTotal,
    backlog: counts.backlog,
    brandKit: counts.brandKit,
    marketing,
    profile,
    launchChecks: countCheckboxes(body("launch")),
    launchItems: checklistLines(body("launch")).filter((l) => l.indent === 0).map((l) => ({ text: l.text, checked: l.checked })),
    votes: parseVotes(body("analytics")),
    signedOffDev: bool(fm("launch").signed_off_dev),
    signedOffMarketing: bool(fm("launch").signed_off_marketing),
    blockingIssuesOpen: numFm(fm("audit").blocking_issues_open),
    auditDate: normalizeDate(fm("audit").audit_date),
    warnings,
  };
}

export function computeTotals(p: ProductSnapshot): Totals {
  const sum = (k: "spend" | "impressions" | "clicks" | "signups" | "sales" | "revenue") => p.ledger.reduce((a, r) => a + r[k], 0);
  const ledgerSpend = sum("spend");
  const ledgerRevenue = sum("revenue");
  const impressions = sum("impressions");
  const clicks = sum("clicks");
  const differs = (a: number, b: number) => a > 0 && b > 0 && Math.abs(a - b) > 0.009;
  return {
    spend: Math.max(ledgerSpend, p.totalSpendFm),
    revenue: Math.max(ledgerRevenue, p.totalRevenueFm),
    impressions,
    clicks,
    ctr: impressions > 0 ? (clicks / impressions) * 100 : null,
    signups: sum("signups"),
    sales: sum("sales"),
    views: p.organic.reduce((a, r) => a + (r.totalViews ?? 0), 0),
    totalsMismatch: differs(ledgerSpend, p.totalSpendFm) || differs(ledgerRevenue, p.totalRevenueFm),
  };
}
