// The quest log: jobs only a person can do (logins, filming, payments, signatures).
// Every quest checks itself off when the work shows up in the notes. Pure: no Obsidian, no clock.

import { computeTotals } from "./snapshot";
import { ChecklistItem, DocKey, ProductSnapshot, Role, StatusResult } from "./types";

export type QuestOwner = Role;

export type QuestAction =
  | { kind: "handles"; label: string }
  | { kind: "postedToday"; label: string }
  | { kind: "tickLaunch"; label: string; itemStart: string }
  | { kind: "flag"; label: string; doc: DocKey; key: string }
  | { kind: "openDoc"; label: string; doc: DocKey; heading?: string }
  | { kind: "tickChecklist"; label: string; item: ChecklistItem }
  | { kind: "openPath"; label: string; path: string };

export type QuestState = "now" | "overdue" | "upcoming" | "done";

export interface Quest {
  id: string;
  owner: QuestOwner;
  title: string;
  why: string;
  /** Why Claude can't do it. */
  humanOnly: string;
  /** Plain "where" text, e.g. "Marketing Engine → Brand kit". */
  where: string;
  state: QuestState;
  /** e.g. "Due day 10 · in 3 days", "Overdue by 2 days", "Today". */
  when: string;
  progress?: { done: number; total: number };
  action: QuestAction;
  /** Secondary "open the note" link when the main action isn't an open. */
  open?: { doc: DocKey; heading?: string; label: string };
  group: string;
  daily?: boolean;
}

interface Spec {
  id: string;
  owner: QuestOwner;
  title: string;
  why: string;
  humanOnly: string;
  where: string;
  /** Sprint days the quest is open. `to` only limits daily quests; others stay until done. */
  from: number;
  to: number;
  due: number;
  daily?: boolean;
  group: string;
  done: boolean;
  progress?: { done: number; total: number };
  action: QuestAction;
  open?: Quest["open"];
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

function launchItem(p: ProductSnapshot, start: string): boolean {
  const s = start.toLowerCase();
  return p.launchItems.some((i) => i.checked && i.text.toLowerCase().startsWith(s));
}

/** Sprint quests for one product. `st` is its computed status (for the sprint day). */
export function sprintQuests(p: ProductSnapshot, st: StatusResult, today: string): Quest[] {
  const status = p.status.toLowerCase();
  if (["queued", "scaled", "killed"].includes(status)) return [];
  const day = st.day; // null = Day 1 not set yet
  const lastDay = st.totalDays;
  const t = computeTotals(p);
  const b = p.backlog;
  const handles = [p.handles.tiktok, p.handles.instagram, p.handles.youtube, ...(p.hasXField ? [p.handles.x] : [])];
  const todayRow = day !== null ? p.ledger.find((r) => r.day === day) : undefined;
  const organicDone = p.organic.length > 0 && p.organic.every((o) => o.followers !== null && o.totalViews !== null);
  const B = "Before launch (days 1–14)";
  const A = "After launch (days 15–28)";
  const D = "Decision (day 28)";

  const specs: Spec[] = [
    {
      id: "mkt-accounts",
      owner: "marketing",
      title: `Create the ${p.hasXField ? "TikTok, Instagram, YouTube and X" : "TikTok, Instagram and YouTube"} accounts, then paste the handles`,
      why: "The videos need a home before they go live on day 14.",
      humanOnly: "Each app needs a phone number and a login.",
      where: "Marketing Engine (handles at the top)",
      from: 1, to: 14, due: 7, group: B,
      done: handles.every(Boolean),
      progress: { done: handles.filter(Boolean).length, total: handles.length },
      action: { kind: "handles", label: "Paste handles" },
    },
    {
      id: "mkt-record",
      owner: "marketing",
      title: "Record the demo videos (your voice + your screen)",
      why: "Raw demos with a real voice beat polished ads (Business Model §5).",
      humanOnly: "Needs your voice and your phone or screen recorder.",
      where: "Marketing Engine → Content backlog",
      from: 1, to: 14, due: 10, group: B,
      done: b.total > 0 && b.scripted === 0,
      progress: { done: b.recorded + b.edited + b.scheduled, total: b.total },
      action: { kind: "openDoc", label: "Open Content backlog", doc: "marketing", heading: "Content backlog" },
    },
    {
      id: "mkt-schedule",
      owner: "marketing",
      title: "Schedule every video to go live on day 14",
      why: "Launch day needs posts ready, not posts still being edited.",
      humanOnly: "Needs your login to each app (or the scheduler, once connected).",
      where: "Marketing Engine → Content backlog",
      from: 1, to: 14, due: 13, group: B,
      done: b.total > 0 && b.scheduled === b.total,
      progress: { done: b.scheduled, total: b.total },
      action: { kind: "openDoc", label: "Open Content backlog", doc: "marketing", heading: "Content backlog" },
    },
    {
      id: "mkt-stripe",
      owner: "marketing",
      title: "Create the Stripe payment link and paste it in the Brand kit",
      why: "Without a checkout, launch-day visitors can't pay.",
      humanOnly: "Needs the company Stripe login.",
      where: "Marketing Engine → Brand kit",
      from: 1, to: 14, due: 12, group: B,
      done: !!p.stripeLink,
      action: { kind: "openDoc", label: "Open Brand kit", doc: "marketing", heading: "Brand kit" },
    },
    {
      id: "dev-breakit",
      owner: "dev",
      title: "Run the break-it test on a computer and a phone",
      why: "Find what breaks before customers do.",
      humanOnly: "Needs a real person on a real phone and computer.",
      where: "Red-Team Audit",
      from: 1, to: 14, due: 13, group: B,
      done: !!p.auditDate,
      action: { kind: "openDoc", label: "Open Red-Team Audit", doc: "audit" },
    },
    {
      id: "dev-test-purchase",
      owner: "dev",
      title: "Make a real test purchase",
      why: "Proves money actually reaches the business account.",
      humanOnly: "Needs a real card. Claude never pays for anything.",
      where: "Launch Checklist → Product",
      from: 1, to: 14, due: 13, group: B,
      done: launchItem(p, "checkout works"),
      action: { kind: "tickLaunch", label: "Mark done", itemStart: "Checkout works" },
      open: { doc: "launch", heading: "Product", label: "Open Launch Checklist" },
    },
    {
      id: "dev-publish",
      owner: "dev",
      title: "Publish the build or store listing",
      why: "Day 14 is launch day: the product has to be live for people to find it.",
      humanOnly: "Needs your store, Roblox or website account login.",
      where: "Launch Checklist → Product",
      from: 1, to: 14, due: 14, group: B,
      done: launchItem(p, "build or store listing is live"),
      action: { kind: "tickLaunch", label: "Mark done", itemStart: "Build or store listing is live" },
      open: { doc: "launch", heading: "Product", label: "Open Launch Checklist" },
    },
    {
      id: "dev-signoff",
      owner: "dev",
      title: "Sign off the launch checklist (Developer)",
      why: "Launch only happens when both partners agree it's ready.",
      humanOnly: "A sign-off is a partner decision.",
      where: "Launch Checklist → Sign-off",
      from: 12, to: 14, due: 14, group: B,
      done: p.signedOffDev,
      action: { kind: "flag", label: "Sign off", doc: "launch", key: "signed_off_dev" },
      open: { doc: "launch", heading: "Sign-off", label: "Open Launch Checklist" },
    },
    {
      id: "mkt-signoff",
      owner: "marketing",
      title: "Sign off the launch checklist (Marketer)",
      why: "Launch only happens when both partners agree it's ready.",
      humanOnly: "A sign-off is a partner decision.",
      where: "Launch Checklist → Sign-off",
      from: 12, to: 14, due: 14, group: B,
      done: p.signedOffMarketing,
      action: { kind: "flag", label: "Sign off", doc: "launch", key: "signed_off_marketing" },
      open: { doc: "launch", heading: "Sign-off", label: "Open Launch Checklist" },
    },
    {
      id: "mkt-first-100",
      owner: "marketing",
      title: "Put the first $100 behind your best video",
      why: "The Launch Framework's test: if $100 brings no users or sales, it's a Kill.",
      humanOnly: "Spends company money; a person must approve it in the ads account.",
      where: "Analytics and Gate → Daily numbers table",
      from: 15, to: lastDay, due: 16, group: A,
      done: t.spend > 0,
      action: { kind: "openDoc", label: "Log it in Daily numbers", doc: "analytics", heading: "ledger" },
    },
    {
      id: "mkt-post-today",
      owner: "marketing",
      title: "Post today, then tap “Posted today”",
      why: "After 3 days without a post the square turns Gone Quiet.",
      humanOnly: "Needs your login to each app (until the scheduler is connected).",
      where: "Your social apps",
      from: 15, to: lastDay, due: day ?? 15, daily: true, group: A,
      done: p.lastSocialPostDate === today,
      action: { kind: "postedToday", label: "Posted today" },
    },
    {
      id: "mkt-log-numbers",
      owner: "marketing",
      title: "Log today's ad numbers from Ads Manager",
      why: "The Kill/Scale decision on day 28 is only as good as these numbers.",
      humanOnly: "Needs your Meta/TikTok ads login (until ads are connected).",
      where: "Analytics and Gate → Daily numbers table",
      from: 15, to: 28, due: day ?? 15, daily: true, group: A,
      done: !!todayRow?.filled,
      action: { kind: "openDoc", label: "Open Daily numbers", doc: "analytics", heading: "ledger" },
    },
    {
      id: "mkt-social-stats",
      owner: "marketing",
      title: "Fill in followers and views for each app",
      why: "Shows which app is actually working, so you know where to post more.",
      humanOnly: "Needs your login to each app. TikTok and Instagram: press Refresh social stats on the computer with the scrape kit. YouTube: type it in.",
      where: "Analytics and Gate → Free social stats",
      from: 15, to: lastDay, due: 21, group: A,
      done: organicDone,
      progress: { done: p.organic.filter((o) => o.followers !== null && o.totalViews !== null).length, total: p.organic.length },
      action: { kind: "openDoc", label: "Open Free social stats", doc: "analytics", heading: "Organic snapshot" },
    },
    {
      id: "dev-vote",
      owner: "dev",
      title: "Vote Scale or Kill (Developer)",
      why: "Day 28: both partners decide with the numbers in front of them.",
      humanOnly: "Only partners decide Scale or Kill.",
      where: "Analytics and Gate → Day-28 verdict",
      from: 28, to: lastDay, due: 28, group: D,
      done: !!p.votes.dev,
      action: { kind: "openDoc", label: "Open the vote", doc: "analytics", heading: "Day-28 verdict" },
    },
    {
      id: "mkt-vote",
      owner: "marketing",
      title: "Vote Scale or Kill (Marketer)",
      why: "Day 28: both partners decide with the numbers in front of them.",
      humanOnly: "Only partners decide Scale or Kill.",
      where: "Analytics and Gate → Day-28 verdict",
      from: 28, to: lastDay, due: 28, group: D,
      done: !!p.votes.marketing,
      action: { kind: "openDoc", label: "Open the vote", doc: "analytics", heading: "Day-28 verdict" },
    },
  ];

  const out: Quest[] = [];
  for (const s of specs) {
    const q = toQuest(s, day);
    if (q) out.push(q);
  }
  return out;
}

function toQuest(s: Spec, day: number | null): Quest | null {
  // Before Day 1 is set, the build quests are open as prep; later ones are "coming up".
  const d = day ?? 0;
  let state: QuestState;
  let when: string;
  if (s.done) {
    if (s.daily && (day === null || d < s.from || d > s.to)) return null;
    state = "done";
    when = s.daily ? "Done for today" : "Done";
  } else if (d < s.from && !(day === null && s.from === 1)) {
    if (s.daily) {
      state = "upcoming";
      when = `Daily from day ${s.from}`;
    } else {
      state = "upcoming";
      when = day === null ? `Opens on day ${s.from}` : `Opens in ${plural(s.from - d, "day")} (day ${s.from})`;
    }
  } else if (s.daily && d > s.to) {
    return null;
  } else if (day === null) {
    state = "now";
    when = `Due day ${s.due} · start any time`;
  } else if (s.daily) {
    state = "now";
    when = "Today";
  } else if (d > s.due) {
    state = "overdue";
    when = `Overdue by ${plural(d - s.due, "day")} (was due day ${s.due})`;
  } else if (d === s.due) {
    state = "now";
    when = `Due today (day ${s.due})`;
  } else {
    state = "now";
    when = `Due day ${s.due} · in ${plural(s.due - d, "day")}`;
  }
  return {
    id: s.id,
    owner: s.owner,
    title: s.title,
    why: s.why,
    humanOnly: s.humanOnly,
    where: s.where,
    state,
    when,
    progress: s.progress && s.progress.total > 0 ? s.progress : undefined,
    action: s.action,
    open: s.open,
    group: s.group,
    daily: s.daily,
  };
}

/** Home quests from SETUP_CHECKLIST + the Business Model items it doesn't cover. */
export function companyQuests(setup: ChecklistItem[], business: ChecklistItem[]): Quest[] {
  const fromItem = (i: ChecklistItem, source: string): Quest => ({
    id: `company:${source}:${i.raw}`,
    owner: i.owner,
    title: i.text,
    why: i.details.join(" · "),
    humanOnly: "Needs a partner: accounts, signatures, payments or a decision.",
    where: source === "setup" ? `Setup Checklist → ${i.group}` : "Business Model → Current status",
    state: i.checked ? "done" : "now",
    when: i.checked ? "Done" : "",
    action: { kind: "tickChecklist", label: "Mark done", item: i },
    group: source === "setup" ? i.group : "Business Model",
  });
  return [...setup.map((i) => fromItem(i, "setup")), ...business.map((i) => fromItem(i, "business"))];
}

export function forRole(quests: Quest[], filter: "all" | "dev" | "marketing"): Quest[] {
  if (filter === "all") return quests;
  return quests.filter((q) => q.owner === filter || q.owner === "both");
}

export const OWNER_LABEL: Record<QuestOwner, string> = { dev: "FOR DEV", marketing: "FOR MARKETING", both: "FOR BOTH" };
