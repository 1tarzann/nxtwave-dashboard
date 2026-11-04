// Shared data shapes. Nothing in src/data imports Obsidian, so it all runs in tests and the browser preview.

export type DocKey = "spec" | "marketing" | "analytics" | "launch" | "changelog" | "audit";

export const DOC_FILES: Record<DocKey, string> = {
  spec: "1_Dev_Spec",
  marketing: "2_Marketing_Engine",
  analytics: "3_Analytics_And_Gate",
  launch: "4_Launch_Checklist",
  changelog: "5_Changelog",
  audit: "6_RedTeam_Audit",
};

export const DOC_ORDER: DocKey[] = ["spec", "marketing", "analytics", "launch", "changelog", "audit"];

/** Raw input for one sprint doc: what Obsidian (or a fixture) gives us. */
export interface RawDoc {
  path: string;
  frontmatter: Record<string, unknown>;
  body: string;
  /** File modified time, ms since epoch. */
  mtime: number;
}

export interface LedgerRow {
  day: number;
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  signups: number;
  sales: number;
  revenue: number;
}

export interface OrganicRow {
  platform: string;
  followers: number | null;
  totalViews: number | null;
  bestVideoLink: string;
  bestVideoViews: number | null;
}

export interface ChangelogEntry {
  version: string;
  date: string;
  added: string[];
  fixed: string[];
  removed: string[];
}

export interface BacklogCounts {
  total: number;
  scripted: number;
  recorded: number;
  edited: number;
  scheduled: number;
}

export interface LinkRef {
  /** Vault-relative link path without .md, as written in the note (e.g. 04_Company_Ops/Categories/Audio_Plugins). */
  path: string;
  title: string;
}

export interface ProductSnapshot {
  name: string;
  /** "Demo Game" for folder Demo_Game. */
  displayName: string;
  folder: string;
  paths: Partial<Record<DocKey, string>>;
  /** <Product>_Hub.md path, if it exists. */
  hubPath: string | null;
  category: LinkRef | null;
  originIdea: LinkRef | null;
  status: string;
  /** True when the 6 files disagree on sprint_status / cycle_start. */
  outOfSync: boolean;
  cycleStart: string | null;
  gateDate: string | null;
  productType: string;
  repoUrl: string;
  handles: { tiktok: string; instagram: string; youtube: string };
  lastSocialPostDate: string | null;
  /** YYYY-MM-DD of the last edit to 2_Marketing_Engine (file mtime or last_updated, whichever is later). */
  marketingTouched: string | null;
  lastChangelogDate: string | null;
  currentVersion: string;
  changelog: ChangelogEntry[];
  totalSpendFm: number;
  totalRevenueFm: number;
  verdict: string;
  ledger: LedgerRow[];
  organic: OrganicRow[];
  stripeLink: string;
  pitch: string;
  mechanics: string[];
  milestones: { done: number; total: number };
  competitorsFilled: number;
  hooksFilled: number;
  backlog: BacklogCounts;
  brandKit: { filled: number; total: number };
  launchChecks: { done: number; total: number };
  signedOffDev: boolean;
  signedOffMarketing: boolean;
  blockingIssuesOpen: number;
  auditDate: string | null;
  warnings: string[];
}

export interface Totals {
  spend: number;
  revenue: number;
  impressions: number;
  clicks: number;
  ctr: number | null;
  signups: number;
  sales: number;
  views: number;
  /** Frontmatter totals disagree with the ledger sum. */
  totalsMismatch: boolean;
}

export interface Thresholds {
  killSpendNoSales: number;
  killMinCtr: number | null;
  staleDays: number;
  staleDevAfterLaunchDays: number | null;
  /** True when Launch_Framework has none of the dashboard fields yet. */
  missing: boolean;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  killSpendNoSales: 100,
  killMinCtr: null,
  staleDays: 3,
  staleDevAfterLaunchDays: null,
  missing: true,
};

export const SPEND_CAP = 300;

export type StatusKey = "kill" | "gate" | "stale" | "healthy" | "unstarted" | "queued" | "closed";

export type ActionKind =
  | "startDay1"
  | "postedToday"
  | "openDoc"
  | "none";

export interface ActionRef {
  kind: ActionKind;
  label: string;
  doc?: DocKey;
  heading?: string;
}

export interface StatusResult {
  key: StatusKey;
  label: string;
  icon: string;
  reason: string;
  action: ActionRef | null;
  day: number | null;
  totalDays: number;
  phase: string;
  /** Quiet notes that don't change the color (e.g. "Dev quiet 5d"). */
  info: string[];
}

export interface IdeaNote {
  path: string;
  title: string;
  stage: "brainstorm" | "drafts" | "accepted";
  mtime: number;
}

export interface DashboardData {
  hqRoot: string;
  categories: LinkRef[];
  today: string;
  products: ProductSnapshot[];
  thresholds: Thresholds;
  archive: { scaled: string[]; killed: string[] };
  ideas: IdeaNote[];
}
