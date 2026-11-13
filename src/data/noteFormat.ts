// What the new (v2) templates hold, shared by the readers and the table editor: the section keys, the green
// examples of plan appendix a) and b), and the hook ratings (D3). A leaf module, so marketing.ts, profile.ts and
// tableEdit.ts use the same rules without importing each other.

import { stripExamples } from "./markdown";

/** Heading keys of the Marketing Engine's tables (part of the heading, any case), as tableIn() and edit ops take them. */
export const MARKETING_SECTIONS = {
  competitors: "competitor swipe",
  hooks: "hook scripts",
  backlog: "content backlog",
  brandKit: "brand kit",
  paidTest: "paid test",
} as const;

/** Heading keys of the Dev Spec sections the product profile reads. */
export const SPEC_SECTIONS = {
  pitch: "pitch",
  mechanics: "core mechanics",
  tech: "tech preset",
} as const;

/** How a message names each section by its key, the way the templates title it. */
const SECTION_NAMES: Record<string, string> = {
  [MARKETING_SECTIONS.competitors]: "Competitor swipe",
  [MARKETING_SECTIONS.hooks]: "Hook scripts",
  [MARKETING_SECTIONS.backlog]: "Content backlog",
  [MARKETING_SECTIONS.brandKit]: "Brand kit",
  [MARKETING_SECTIONS.paidTest]: "Paid test plan",
  [SPEC_SECTIONS.pitch]: "One-line pitch",
  [SPEC_SECTIONS.mechanics]: "Core mechanics",
  [SPEC_SECTIONS.tech]: "Tech preset",
};

/** A section's name for a message when the note can't show its own heading ("content backlog" → "Content backlog"). */
export function sectionName(key: string): string {
  const k = key.trim().toLowerCase();
  return SECTION_NAMES[k] ?? (k === "" ? key : k.charAt(0).toUpperCase() + k.slice(1));
}

/**
 * The template's own examples (plan appendix a). A cell with no example of its own shows the first example in its
 * column, else the one here: old v1 notes have no examples at all. Don't use hooks describe a pattern, never a script,
 * so they only borrow from other Don't use rows. Brand kit and paid test rows are each a different field, so they
 * skip the column step and are matched here by the start of their label.
 */
export const GENERIC_EXAMPLES = {
  competitors: {
    name: "e.g. product name, linked to where it's sold",
    link: "e.g. their best video: views and × their usual",
    hook: "e.g. their exact first words, in quotes",
    why: "e.g. shows the result by second 2",
  },
  hooks: {
    hook: `e.g. "I couldn't find a tool that does ___, so I built one."`,
    demo: "e.g. screen: one click, the result plays right away",
    cta: "e.g. Link in bio.",
    basedOn: "e.g. 2 competitor videos at 2× their usual views",
  },
  /** Don't use rows: Demo shot and CTA hold "—", so they have no example. */
  avoidHooks: {
    hook: "e.g. brand-first opening: logo and name before the demo",
    demo: "",
    cta: "",
    basedOn: "e.g. 4 competitor videos at 0.2× their usual views",
  },
  backlog: {
    format: "e.g. screen recording + your voice, 20s",
    platforms: "e.g. TikTok, Reels, Shorts, X",
    hookNum: "e.g. 1",
    status: "e.g. scripted",
    goLive: "e.g. launch day (day 14)",
  },
  /** Keyed by the start of the row label, lower case. */
  brandKit: {
    "product name": "e.g. the name exactly as the store shows it",
    logo: "e.g. link to the logo file",
    thumbnail: "e.g. link to a 1080×1920 image or a 15s video",
    "landing page": "e.g. link to the one-page site",
    "email capture": "e.g. link to the sign-up form",
    stripe: "e.g. the Stripe payment link, never a secret key",
  },
  /** Keyed by the start of the row label, lower case. */
  paidTest: {
    video: "e.g. backlog #2, the best free video after launch",
    platform: "e.g. Meta, TikTok or Google",
    "start date": "e.g. day 15",
    budget: "e.g. $100 first, $300 at most",
  },
};

/** The Dev Spec template's examples for the 3 profile rows (plan appendix b), for hints in a Fill in sheet. */
export const PROFILE_EXAMPLES = {
  buyer: "e.g. who pays, in their own words",
  job: "e.g. the one thing they buy it to do, in one sentence",
  price: "e.g. $29 one-time, $5/month, or free + in-game items",
};

/** The example whose key starts the label (any case), or "". */
export function labelExample(examples: Record<string, string>, label: string): string {
  const l = label.trim().toLowerCase();
  return Object.entries(examples).find(([k]) => l.startsWith(k))?.[1] ?? "";
}

/** Each key-value table's template examples, by the section it sits in. */
const ROW_EXAMPLES: Array<[string, Record<string, string>]> = [
  [MARKETING_SECTIONS.brandKit, GENERIC_EXAMPLES.brandKit],
  [MARKETING_SECTIONS.paidTest, GENERIC_EXAMPLES.paidTest],
  [SPEC_SECTIONS.pitch, { "who buys": PROFILE_EXAMPLES.buyer, job: PROFILE_EXAMPLES.job, price: PROFILE_EXAMPLES.price }],
];

/** The template's example for a row of a key-value table (brand kit, paid test plan, the profile rows), by its section heading and row label, or "". */
export function rowExample(heading: string, label: string): string {
  const h = heading.toLowerCase();
  const found = ROW_EXAMPLES.find(([key]) => h.includes(key));
  return found ? labelExample(found[1], label) : "";
}

export type HookRating = "recommended" | "medium" | "avoid" | "";

/** The exact Rating cell text code writes for each rating (the icon is never shown alone). */
export const RATING_LABEL: Record<Exclude<HookRating, "">, string> = {
  recommended: "🟢 Recommended",
  medium: "🟡 Medium",
  avoid: "🔴 Don't use",
};

const ICONS: Array<[string, HookRating]> = [
  ["🟢", "recommended"],
  ["🟡", "medium"],
  ["🔴", "avoid"],
];

const WORDS: Array<[RegExp, HookRating]> = [
  [/not\s+recommend|don.?t\s+use|do\s+not\s+use|avoid/i, "avoid"],
  [/recommend/i, "recommended"],
  [/medium/i, "medium"],
];

/** The rating found earliest in the text (positions -1 = not found), or "". */
function earliest(found: Array<[number, HookRating]>): HookRating {
  return found.filter(([at]) => at !== -1).sort((a, b) => a[0] - b[0])[0]?.[1] ?? "";
}

/**
 * D3: 🟢 / "Recommended" → recommended, 🟡 / "Medium" → medium, 🔴 / "Don't use" / "Avoid" / "Not recommended" → avoid,
 * else "". An icon decides over the words next to it; without one, the first rating word wins, so "Not recommended"
 * is avoid and "Medium (avoid hype words)" is medium. Examples never count.
 */
export function ratingOf(s: string): HookRating {
  const v = stripExamples(s);
  return earliest(ICONS.map(([icon, r]) => [v.indexOf(icon), r])) || earliest(WORDS.map(([re, r]) => [v.search(re), r]));
}

/** The Rating column: a header that is or starts with "rating" (any case), or -1. "Demo shot (demonstrating it)" isn't one. */
export function ratingColumn(headers: string[]): number {
  return headers.findIndex((h) => h.trim().toLowerCase().startsWith("rating"));
}
