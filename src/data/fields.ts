// One registry for every section and number on the dashboard: plain label, what it is, why it's there,
// where it lives and who fills it. The ⓘ cards, the Help sheet and the source tags all read from here.

import { relativeDay } from "./dates";
import { ProductSnapshot, StatusResult } from "./types";

export interface FieldInfo {
  label: string;
  what: string;
  why: string;
  where: string;
  who: string;
}

export const FIELDS = {
  doNext: {
    label: "Do this next",
    what: "The single most urgent thing across all products.",
    why: "So you never have to scan the whole page to know where to start.",
    where: "Worked out from the status of every product and your quests.",
    who: "Automatic.",
  },
  questLog: {
    label: "Quest log",
    what: "Jobs only a person can do: logins, filming, payments, signatures and decisions.",
    why: "Claude can write, plan and code, but it can't log into your accounts, spend money or sign for you.",
    where: "Each quest checks itself off when the work shows up in your notes.",
    who: "Tagged FOR DEV, FOR MARKETING or FOR BOTH.",
  },
  companyQuests: {
    label: "Company quests",
    what: "Open items from the Setup Checklist and the Business Model.",
    why: "The company setup (bank, EIN, accounts) has to happen before money can flow.",
    where: "SETUP_CHECKLIST and Business Model → Current status.",
    who: "Tag a line with #dev or #marketing in the Setup Checklist to assign it.",
  },
  products: {
    label: "Products",
    what: "One square per product. The big one is the sprint that's running now.",
    why: "One glance tells you which product needs attention and why.",
    where: "Each product folder in 02_Active_Sprints.",
    who: "Automatic. Click a square to open that product.",
  },
  timeline: {
    label: "Where you are in the 28 days",
    what: "Day 1, launch day (14), the first Kill check (21) and decision day (28), with today marked.",
    why: "Shows how much time is left before each decision.",
    where: "Counted from Day 1 in the product's hub note.",
    who: "Automatic once Day 1 is set.",
  },
  activity: {
    label: "Latest activity",
    what: "When the last social post went out and when the developer last logged progress.",
    why: "After 3 quiet days the square turns Gone Quiet, so you see it before it slips.",
    where: "Marketing Engine (last post date) and Changelog (last entry).",
    who: "Marketing taps “Posted today”; Dev adds Changelog entries.",
  },
  money: {
    label: "Money and reach",
    what: "Ad spend, views, clicks and revenue for this product so far.",
    why: "These four numbers decide Scale or Kill on day 28.",
    where: "Analytics and Gate: the Daily numbers table and the Free social stats.",
    who: "Marketing types them in today. They can be filled automatically once Stripe and the scheduler are connected.",
  },
  linked: {
    label: "Linked accounts",
    what: "The social accounts, checkout link, code repo and ads for this product.",
    why: "A grey pill means something still needs to be created or pasted.",
    where: "Marketing Engine (handles, Brand kit) and Dev Spec (repo).",
    who: "Marketing for socials, checkout and ads; Dev for the repo.",
  },
  socialStats: {
    label: "Free social stats",
    what: "Followers, total views and the best video for each app. “Free” means not paid ads.",
    why: "Shows which app is working, and which video to put the first $100 behind.",
    where: "Analytics and Gate → Organic snapshot table.",
    who: "Marketing, until the scheduler is connected.",
  },
  dailyNumbers: {
    label: "Daily numbers table",
    what: "One row per day from day 15 to 28: ad spend, people who saw the ad, clicks, sales and revenue.",
    why: "The Kill/Scale decision is made from this table.",
    where: "Analytics and Gate → 14-day ledger.",
    who: "Marketing, from Ads Manager, until the ads accounts are connected.",
  },
  competitors: {
    label: "Competitor examples",
    what: "3 competitors whose ads or videos already work, with their opening line.",
    why: "Copy what's proven instead of guessing (Business Model §5).",
    where: "Marketing Engine → Competitor swipe.",
    who: "Marketing. Claude can help research public pages.",
  },
  hooks: {
    label: "Video opening lines",
    what: "The first 3 seconds of each video, spoken in your own voice.",
    why: "The opening line decides whether people keep watching.",
    where: "Marketing Engine → Hook scripts.",
    who: "Marketing. Claude can draft them.",
  },
  brandKit: {
    label: "Brand kit",
    what: "Name, logo, thumbnail, landing page, email signup and the Stripe payment link.",
    why: "Everything a visitor sees or clicks on launch day.",
    where: "Marketing Engine → Brand kit.",
    who: "Marketing.",
  },
  scheduled: {
    label: "Videos scheduled",
    what: "How many videos in the content backlog are scheduled to go live.",
    why: "All of them should be scheduled before launch day (14).",
    where: "Marketing Engine → Content backlog (Status column).",
    who: "Marketing.",
  },
  readiness: {
    label: "Ready to launch on day 14?",
    what: "4 checks: launch checklist done, break-it test done with 0 blocking problems, and both sign-offs.",
    why: "Launch only when the product works and both partners agree.",
    where: "Launch Checklist and Red-Team Audit.",
    who: "Dev runs the checks; both partners sign off.",
  },
  mechanics: {
    label: "The 3 core features",
    what: "The only 3 things this version of the product does.",
    why: "Keeps the build to 14 days. Everything else waits.",
    where: "Dev Spec → Core mechanics.",
    who: "Dev. Claude can help write them.",
  },
  changelog: {
    label: "Changelog (progress log)",
    what: "A dated list of what the developer added, fixed or removed.",
    why: "Each entry resets the Gone Quiet timer during the build.",
    where: "Changelog note.",
    who: "Dev (or Claude acting as Developer).",
  },
  ideas: {
    label: "Idea Vault",
    what: "Ideas waiting for their turn. No clock runs on them.",
    why: "Capture ideas without starting a second sprint.",
    where: "05_Idea_Pipeline: Brainstorm → Rough drafts → Accepted.",
    who: "Anyone adds ideas; both partners accept them.",
  },
} satisfies Record<string, FieldInfo>;

export type FieldId = keyof typeof FIELDS;

export const GLOSSARY: [string, string][] = [
  ["Sprint", "One product's 28-day run: 14 days to build, 14 days to watch the numbers."],
  ["Day 1", "The day the 28-day countdown starts. Set with the Start Day 1 button."],
  ["Launch day (day 14)", "The product goes live and the scheduled videos post."],
  ["Kill check (day 21)", "From here, $100 spent with 0 sales turns the square Kill Signal."],
  ["Decision day (day 28)", "Both partners vote Scale (keep going) or Kill (stop and archive)."],
  ["Scale / Kill", "Scale: it works, keep improving it. Kill: stop spending and move to the next idea."],
  ["Gone quiet", "Nothing happened for 3 days: no progress log entry or marketing edit before launch, no post after launch."],
  ["Hub note", "The table of contents for one product. It holds the official status and Day 1."],
  ["Ad budget", "$300 per sprint at most, used only to test whether people buy."],
  ["Click rate", "Out of 100 people who saw the ad, how many clicked."],
  ["Free (organic) posts", "Posts you don't pay for: daily TikToks, Reels and Shorts."],
  ["Break-it test", "Trying to break the product on purpose before launch (the Red-Team Audit)."],
  ["Quest", "A job only a person can do. Checks itself off when the work shows up in the notes."],
];

export type SourceKind = "notyet" | "youfill" | "typed" | "auto" | "fix";

export interface SourceTag {
  kind: SourceKind;
  text: string;
}

export type Metric = "spend" | "clicks" | "views" | "revenue" | "lastPost";

/** Day the number can first exist: ads start day 15; posts and sales can start on launch day. */
const FROM: Record<Metric, number> = { spend: 15, clicks: 15, views: 14, revenue: 14, lastPost: 14 };

/**
 * Why a number is what it is: not expected yet, needs a person, typed by a person, or filled automatically.
 * `auto` maps a metric to "Stripe · 2h ago" once a connector is set up (Phase 3).
 */
export function sourceTag(metric: Metric, p: ProductSnapshot, st: StatusResult, auto: Partial<Record<Metric, string>> = {}, today = ""): SourceTag {
  const day = st.day;
  if (["queued", "scaled", "killed"].includes(p.status.toLowerCase()) && metric !== "revenue") {
    return { kind: "notyet", text: "⏳ Not yet · sprint hasn't started" };
  }
  if (auto[metric]) return { kind: "auto", text: `🔌 Auto · ${auto[metric]}` };
  // Views and last post can come from the Refresh social stats button (Instagram + TikTok).
  const refreshed = Object.values(p.socialRefreshed).filter(Boolean).sort().at(-1);
  if (refreshed && (metric === "views" || metric === "lastPost") && (metric === "lastPost" ? !!p.lastSocialPostDate : p.organic.some((o) => o.totalViews !== null))) {
    return { kind: "auto", text: `🔌 Auto · from the apps, refreshed ${relativeDay(refreshed.slice(0, 10), today)}` };
  }
  const from = FROM[metric];
  const anyLedger = p.ledger.some((r) => r.filled);
  const has: Record<Metric, boolean> = {
    spend: anyLedger || p.totalSpendFm > 0,
    clicks: anyLedger,
    views: p.organic.some((o) => o.totalViews !== null),
    revenue: anyLedger || p.totalRevenueFm > 0,
    lastPost: !!p.lastSocialPostDate,
  };
  if (has[metric]) {
    const by = metric === "lastPost" ? "Marketing (Posted today)" : "Marketing";
    return { kind: "typed", text: `✍️ Typed by ${by}` };
  }
  if (day === null || day < from) {
    return { kind: "notyet", text: `⏳ Not yet · starts day ${from}${metric === "spend" || metric === "clicks" ? " (ads)" : " (launch)"}` };
  }
  const what: Record<Metric, string> = {
    spend: "log ad spend in Daily numbers",
    clicks: "log clicks in Daily numbers",
    views: "fill views in Free social stats",
    revenue: "log sales in Daily numbers",
    lastPost: "tap Posted today after posting",
  };
  return { kind: "youfill", text: `✍️ Needs you · Marketing: ${what[metric]}` };
}
