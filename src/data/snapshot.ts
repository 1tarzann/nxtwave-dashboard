// Turns the 6 raw sprint docs into one ProductSnapshot. Pure: no Obsidian, no clock.

import { laterDate, normalizeDate, toIsoDate } from "./dates";
import { cell, checklistLines, col, countCheckboxes, isChecked, num, plainText, section, tableIn } from "./markdown";
import {
  ChangelogEntry,
  LinkRef,
  DOC_FILES,
  DOC_ORDER,
  DocKey,
  LedgerRow,
  OrganicRow,
  ProductSnapshot,
  RawDoc,
  Totals,
} from "./types";

function str(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.map(str).join(", ");
  return String(v).trim();
}

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

/** Parses a frontmatter link like "[[04_Company_Ops/Categories/Audio_Plugins|Audio Plugins]]". */
export function parseLink(v: unknown): LinkRef | null {
  const m = /\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]/.exec(str(v));
  if (!m) return null;
  const path = m[1].replace(/\.md$/, "").trim();
  return { path, title: (m[2] ?? path.split("/").pop() ?? path).trim() };
}

export const displayName = (folderName: string) => folderName.replace(/_/g, " ");

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

  // Marketing.
  const mkt = body("marketing");
  const marketingDoc = docs.marketing;
  const marketingTouched = marketingDoc
    ? laterDate(marketingDoc.mtime > 0 ? toIsoDate(marketingDoc.mtime) : null, normalizeDate(fm("marketing").last_updated))
    : null;

  const swipe = tableIn(mkt, "competitor swipe");
  const competitorsFilled = swipe ? swipe.rows.filter((r) => cell(r, col(swipe, "competitor"))).length : 0;

  const hooks = tableIn(mkt, "hook scripts");
  const hookCol = hooks ? col(hooks, "hook") : -1;
  const demoCol = hooks ? col(hooks, "demo") : -1;
  const hooksFilled = hooks
    ? hooks.rows.filter((r) => {
        const h = cell(r, hookCol);
        return h && !h.includes("___") && cell(r, demoCol);
      }).length
    : 0;

  const backlogT = tableIn(mkt, "content backlog");
  const backlog = { total: 0, scripted: 0, recorded: 0, edited: 0, scheduled: 0 };
  if (backlogT) {
    const fmt = col(backlogT, "format");
    const st = col(backlogT, "status");
    for (const r of backlogT.rows) {
      const s = cell(r, st).toLowerCase();
      if (!cell(r, fmt) && !s) continue;
      backlog.total++;
      if (s.includes("scheduled")) backlog.scheduled++;
      else if (s.includes("edited")) backlog.edited++;
      else if (s.includes("recorded")) backlog.recorded++;
      else if (s.includes("scripted")) backlog.scripted++;
    }
  }

  const brand = tableIn(mkt, "brand kit");
  let stripeLink = "";
  const brandKit = { filled: 0, total: 0 };
  if (brand) {
    const a = col(brand, "asset");
    const v = col(brand, "link", "status", "value");
    for (const r of brand.rows) {
      if (!cell(r, a)) continue;
      brandKit.total++;
      if (cell(r, v)) brandKit.filled++;
      if (cell(r, a).toLowerCase().includes("stripe")) stripeLink = cell(r, v);
    }
  }

  // Analytics.
  const ana = body("analytics");
  const ledger = parseLedger(ana);
  if (docs.analytics && ledger === null) warnings.push("Couldn't read the ledger table (3_Analytics_And_Gate §1)");

  // Dev spec.
  const spec = body("spec");
  const pitchSec = section(spec, "pitch") ?? "";
  const pitch = plainText((/^\s*>\s?(.*)$/m.exec(pitchSec)?.[1] ?? "").trim());
  const mechanics = (section(spec, "core mechanics") ?? "")
    .split(/\r?\n/)
    .map((l) => /^\s*\d+\.\s*(.*)$/.exec(l)?.[1]?.trim() ?? "")
    .filter(Boolean)
    .map(plainText);
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
    stripeLink,
    pitch,
    mechanics,
    milestones,
    competitorsFilled,
    hooksFilled,
    backlog,
    brandKit,
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
