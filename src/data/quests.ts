// The quest log: jobs only a person can do (logins, filming, payments, signatures).
// Every quest checks itself off when the work shows up in the notes. Pure: no Obsidian, no clock.

import { addDays, daysBetween, longDate, relativeDay } from "./dates";
import { researchState } from "./marketingOps";
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
  | { kind: "openPath"; label: string; path: string }
  /** Copies `text` (e.g. a Claude Code command) to the clipboard. */
  | { kind: "copy"; label: string; text: string }
  /** Shows a section of the product view: switches to `tab` ("overview", "marketing", "dev") and scrolls to #nx-sec-<id>. */
  | { kind: "section"; label: string; tab: string; id: string };

export type QuestState = "now" | "overdue" | "upcoming" | "done";

export interface Quest {
  id: string;
  owner: QuestOwner;
  title: string;
  why: string;
  /** Why Claude can't do it. */
  humanOnly: string;
  /** Plain "where" text, e.g. "Marketing side → Brand kit". */
  where: string;
  state: QuestState;
  /** e.g. "Due day 10 · in 3 days", "Overdue by 2 days", "Today". Quests timed by a date: "Due Nov 21 · in 3 days", "Due tomorrow". */
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

/** A quest timed by a calendar date instead of sprint days, because it can come before Day 1 is set. */
interface DatedSpec extends Omit<Spec, "from" | "to" | "due" | "daily"> {
  /** YYYY-MM-DD, or null while no date is known yet. */
  dueDate: string | null;
  /** The due text while there's no date (default "Start any time"). */
  noDate?: string;
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** The 7 facts competitor research needs (see ProductProfile). */
const PROFILE_FIELDS = 7;

const WHO_ASKED: Record<string, string> = { marketing: "The Marketer", dev: "The Developer", both: "Both partners" };

/** "Who buys it" · "Who buys it and Price" · "Who buys it, Job it does and Price". */
function andList(items: string[]): string {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** The earliest of the known dates, or null. */
function earliest(dates: (string | null)[]): string | null {
  return dates.filter((d): d is string => !!d).sort()[0] ?? null;
}

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
      where: "Marketing side → Videos to make",
      from: 1, to: 14, due: 10, group: B,
      done: b.total > 0 && b.scripted === 0,
      progress: { done: b.recorded + b.edited + b.scheduled, total: b.total },
      action: { kind: "section", label: "Go to Videos", tab: "marketing", id: "videos" },
    },
    {
      id: "mkt-schedule",
      owner: "marketing",
      title: "Schedule every video to go live on day 14",
      why: "Launch day needs posts ready, not posts still being edited.",
      humanOnly: "Needs your login to each app (or the scheduler, once connected).",
      where: "Marketing side → Videos to make",
      from: 1, to: 14, due: 13, group: B,
      done: b.total > 0 && b.scheduled === b.total,
      progress: { done: b.scheduled, total: b.total },
      action: { kind: "section", label: "Go to Videos", tab: "marketing", id: "videos" },
    },
    {
      id: "mkt-stripe",
      owner: "marketing",
      title: "Create the Stripe payment link and paste it in the Brand kit",
      why: "Without a checkout, launch-day visitors can't pay.",
      humanOnly: "Needs the company Stripe login.",
      where: "Marketing side → Brand kit",
      from: 1, to: 14, due: 12, group: B,
      done: !!p.stripeLink,
      action: { kind: "section", label: "Go to Brand kit", tab: "marketing", id: "brandkit" },
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

  const out: Quest[] = researchQuests(p, today, B);
  for (const s of specs) {
    const q = toQuest(s, day);
    if (q) out.push(q);
  }
  return out;
}

/**
 * Competitor research, in order: the Dev Spec profile, the /competitors run a partner asked for, and the
 * Marketer's review. Each shows only while it applies and checks itself off when the note shows the work.
 * Due dates are calendar dates, since Day 1 may not be set yet.
 */
function researchQuests(p: ProductSnapshot, today: string, group: string): Quest[] {
  const profile = p.profile;
  const missing = profile.missing.map((f) => f.field);
  const mkt = p.marketing;
  const request = mkt?.request ?? null;
  const research = mkt?.research ?? null;
  // Asked for, and no research since. A /competitors run deletes the request marker when it writes its own
  // (note-apply), so a request still there on the research day came after that run: it's still waiting.
  const state = researchState(mkt);
  const pending = state.pending;
  const specs: DatedSpec[] = [];

  if (p.status.toLowerCase() === "building") {
    specs.push({
      id: "dev-profile",
      owner: "dev",
      title: "Fill in the product profile in the Dev Spec",
      why: profile.complete
        ? "Competitor research needs 7 facts about the product."
        : `Competitor research needs 7 facts about the product. Still missing: ${andList(missing)}.`,
      humanOnly: "Who buys it and the price are partner decisions. Claude can help word them.",
      where: profile.missing[0]?.where ?? "Dev Spec → 1. One-line pitch",
      // Day 2, or sooner when a partner is already waiting for research.
      dueDate: earliest([p.cycleStart ? addDays(p.cycleStart, 1) : null, pending && request ? addDays(request.date, 1) : null]),
      noDate: "Due day 2 · start any time",
      group,
      done: profile.complete,
      progress: { done: PROFILE_FIELDS - profile.missing.length, total: PROFILE_FIELDS },
      action: { kind: "openDoc", label: "Open Dev Spec", doc: "spec", heading: "pitch" },
    });
  }

  if (request) {
    const asked = `${Object.prototype.hasOwnProperty.call(WHO_ASKED, request.by) ? WHO_ASKED[request.by] : "A partner"} asked for it ${relativeDay(request.date, today)}`;
    specs.push({
      id: "dev-research",
      owner: "dev",
      title: "Run competitor research (/competitors in Claude Code)",
      why: profile.complete
        ? `${asked}: 3 real competitors and 10 rated video openings, written into the Marketing Engine.`
        : `Blocked by the product profile: /competitors won't start until ${andList(missing)} ${missing.length === 1 ? "is" : "are"} filled in. ${asked}.`,
      humanOnly: "Only a person can start /competitors in Claude Code, and you approve the write to the note.",
      where: "Claude Code on the Developer's Mac",
      dueDate: addDays(request.date, 1),
      group,
      done: !pending,
      action: { kind: "copy", label: "Copy command", text: `/competitors ${p.name}` },
      open: profile.complete ? undefined : { doc: "spec", heading: "pitch", label: "Open Dev Spec" },
    });
  }

  if (mkt && research) {
    // A part counts as reviewed when Looks good was pressed on or after the research date.
    const reviewed = [state.reviewed.competitors, state.reviewed.hooks].filter(Boolean).length;
    specs.push({
      id: "mkt-review",
      owner: "marketing",
      title: "Review the competitors and hooks, then press Looks good",
      why: "Research is a draft until you check it: are these real rivals, and would you say these openings on camera?",
      humanOnly: "Only you can judge whether a competitor is a real rival and a hook sounds like you.",
      where: "Marketing side → Competitors and Hooks",
      dueDate: addDays(research.date, 2),
      group,
      done: reviewed === 2,
      progress: { done: reviewed, total: 2 },
      action: { kind: "section", label: "Review competitors and hooks", tab: "marketing", id: "competitors" },
    });
  }

  return specs.map((s) => {
    const { state, when } = dueBy(s.done, s.dueDate, today, s.noDate ?? "Start any time");
    return build(s, state, when);
  });
}

/** "Due Nov 21 · in 3 days", "Due tomorrow", "Due today", "Overdue by 2 days (was due Nov 21)". */
function dueBy(done: boolean, dueDate: string | null, today: string, noDate: string): { state: QuestState; when: string } {
  if (done) return { state: "done", when: "Done" };
  if (!dueDate) return { state: "now", when: noDate };
  const left = daysBetween(today, dueDate);
  if (left < 0) return { state: "overdue", when: `Overdue by ${plural(-left, "day")} (was due ${shortDate(dueDate, today)})` };
  if (left === 0) return { state: "now", when: "Due today" };
  if (left === 1) return { state: "now", when: "Due tomorrow" };
  return { state: "now", when: `Due ${shortDate(dueDate, today)} · in ${plural(left, "day")}` };
}

/** "Nov 21", or "Jan 2, 2027" when it isn't this year. */
function shortDate(iso: string, today: string): string {
  const date = longDate(iso).replace(/^\S+ /, "");
  return iso.slice(0, 4) === today.slice(0, 4) ? date.replace(/, \d{4}$/, "") : date;
}

/** The quest a spec describes, with its state and due text. */
function build(s: Omit<Spec, "from" | "to" | "due">, state: QuestState, when: string): Quest {
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
  return build(s, state, when);
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
