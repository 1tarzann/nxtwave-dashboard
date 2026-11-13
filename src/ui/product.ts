// Levels 2 and 3: one product's Overview, and its Marketing and Developer sides.

import { addDays, longDate } from "../data/dates";
import { FIELDS, Metric, sourceTag } from "../data/fields";
import { BACKLOG_STEPS, safeUrl } from "../data/marketingOps";
import { sprintQuests } from "../data/quests";
import { fmtMoney } from "../data/status";
import { BacklogCounts, DOC_FILES, DocKey, ProductSnapshot, SPEND_CAP } from "../data/types";
import { Ctx, Tab } from "./app";
import { count, drawer, emptyNote, infoSection, money, moneyExact, rel, sectionHead, sourceLine } from "./components";
import { Child, h, s } from "./dom";
import { brandKitSection, paidTestSection, videosSection } from "./editors";
import { competitorsSection, hooksSection } from "./marketing";
import { reducedMotion, replayClass } from "./motion";
import { profileLine } from "./profile";
import { questLog } from "./quests";
import { confirmRefreshSheet, connectSheet } from "./sheets";
import { PLATFORM_LABEL, SOCIAL_PLATFORMS } from "../data/social";

const NOTE_NAMES: Record<DocKey, string> = {
  spec: "Dev Spec",
  marketing: "Marketing Engine",
  analytics: "Analytics and Gate",
  launch: "Launch Checklist",
  changelog: "Changelog",
  audit: "Red-Team Audit",
};

export function renderProduct(ctx: Ctx, p: ProductSnapshot, tab: Tab): HTMLElement {
  const body = h("div", { class: "nx-product" });
  if (tab === "overview") body.append(...overview(ctx, p));
  if (tab === "marketing") body.append(...marketing(ctx, p));
  if (tab === "dev") body.append(...dev(ctx, p));
  return body;
}

function openLink(ctx: Ctx, p: ProductSnapshot, doc: DocKey, label: string, heading?: string): HTMLElement {
  const b = h("button", { class: "nx-link", type: "button" }, label);
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    ctx.openDoc(p, doc, heading);
  });
  return b;
}

function quests(ctx: Ctx, p: ProductSnapshot) {
  return sprintQuests(p, ctx.status(p), ctx.today);
}

// ── Overview ───────────────────────────────────────────────────────────────

function overview(ctx: Ctx, p: ProductSnapshot): HTMLElement[] {
  const st = ctx.status(p);
  const t = ctx.totals(p);
  const { today } = ctx;
  const out: HTMLElement[] = [];

  // 1. Status banner with the one fix button.
  out.push(
    h(
      "div",
      { class: ["nx-banner", `nx-st-${st.key}`] },
      h("span", { class: "nx-banner-icon", "aria-hidden": "true" }, st.icon),
      h("div", { class: "nx-banner-text" }, h("strong", null, st.label), h("span", null, st.reason)),
      st.action ? ctx.actionButton(p, st.action, "hub") : null,
    ),
  );
  const notes: HTMLElement[] = [];
  st.info.forEach((i) => notes.push(h("span", { class: "nx-info-chip" }, i)));
  if (p.outOfSync) notes.push(h("span", { class: "nx-warn-chip" }, "⚠ The hub note and the 6 notes disagree on the status or Day 1. The hub note is the official one."));
  p.warnings.forEach((w) => notes.push(h("span", { class: "nx-warn-chip" }, `⚠ ${w}`)));
  if (t.totalsMismatch) notes.push(h("span", { class: "nx-warn-chip", title: "The dashboard shows the larger number" }, "⚠ The totals at the top of Analytics don't match the Daily numbers table"));
  if (notes.length) out.push(h("div", { class: "nx-chips-row" }, notes));

  // 2. This product's quests.
  out.push(
    questLog(ctx, {
      id: `sprint:${p.name}`,
      field: "questLog",
      title: `${p.displayName} quests`,
      quests: quests(ctx, p),
      product: p,
      emptyText: p.status.toLowerCase() === "queued" ? "Quests appear when this product's sprint starts." : "No quests for this filter.",
      max: 3,
    }),
  );

  // 3. Latest activity.
  const latest = p.changelog[0];
  const devLine = latest ? latest.added[0] ?? latest.fixed[0] ?? latest.removed[0] ?? "" : "";
  const handles = [p.handles.tiktok, p.handles.instagram, p.handles.youtube, p.handles.x].filter(Boolean);
  const postTag = sourceTag("lastPost", p, st, {}, today);
  out.push(
    h(
      "section",
      { class: "nx-section" },
      sectionHead(ctx, "activity"),
      h(
        "div",
        { class: "nx-pulse-row" },
        h(
          "div",
          { class: ["nx-card", "nx-pulse-card", ctx.flashCls(`${p.name}:post`)] },
          h("span", { class: "nx-card-label" }, "📣 Last social post"),
          h("span", { class: "nx-pulse-big" }, postTag.kind === "notyet" ? "Not live yet" : rel(p.lastSocialPostDate, today, "None yet")),
          h("span", { class: "nx-muted" }, handles.length ? handles.join(" · ") : "No accounts linked yet"),
          sourceLine(postTag),
          ctx.button({ id: `pulse:${p.name}:posted`, label: "I posted today", doneLabel: "Logged", variant: "quiet", title: "Records today's date as the last post", onClick: async () => { const u = await ctx.host.postedToday(p); ctx.mem.flash.set(`${p.name}:post`, Date.now() + 1300); return u; } }),
        ),
        h(
          "div",
          { class: "nx-card nx-pulse-card" },
          h("span", { class: "nx-card-label" }, "🛠 Last progress log (Changelog)"),
          h("span", { class: "nx-pulse-big" }, rel(p.lastChangelogDate, today, "None yet")),
          h("span", { class: "nx-muted" }, p.lastChangelogDate ? `Version ${p.currentVersion}${devLine ? ` · ${devLine}` : ""}` : "The developer (or Claude as Developer) adds an entry after each work session."),
          openLink(ctx, p, "changelog", "Open Changelog →"),
        ),
      ),
    ),
  );

  // 4. Money and reach, each with where the number comes from.
  const todayRow = p.ledger.find((r) => r.date === today || r.day === st.day);
  const capPct = Math.min(1, t.spend / SPEND_CAP);
  const value = (m: Metric, key: string, v: number, fmt: (n: number) => string) => {
    const tag = sourceTag(m, p, st, {}, today);
    const shown = tag.kind === "notyet" || tag.kind === "youfill" ? h("span", { class: "nx-tile-value is-empty" }, "—") : ctx.num(`${p.name}:${key}`, v, fmt, "nx-tile-value");
    return { shown, tag: sourceLine(tag) };
  };
  const spend = value("spend", "spend", t.spend, money);
  const views = value("views", "views", t.views, count);
  const clicks = value("clicks", "clicks", t.clicks, count);
  const revenue = value("revenue", "revenue", t.revenue, money);
  out.push(
    h(
      "section",
      { class: "nx-section" },
      sectionHead(ctx, "money"),
      h(
        "div",
        { class: "nx-tiles" },
        tile(
          "Ad spend",
          spend.shown,
          h("div", { class: "nx-cap" }, h("div", { class: ["nx-cap-fill", capPct >= 1 && "is-full"], style: { transform: `scaleX(${capPct})` } })),
          h("span", { class: "nx-muted" }, capPct >= 1 ? `At the $${SPEND_CAP} limit: stop paid ads` : `of the $${SPEND_CAP} test budget`),
          todayRow?.spend ? h("span", { class: "nx-delta" }, `+${moneyExact(todayRow.spend)} today`) : null,
          spend.tag,
        ),
        tile("Views", views.shown, h("span", { class: "nx-muted" }, "free posts, all apps"), views.tag),
        tile("Clicks", clicks.shown, h("span", { class: "nx-muted" }, t.ctr === null ? "click rate shows once ads run" : `${t.ctr.toFixed(2)}% of people who saw the ad clicked`), clicks.tag),
        tile(
          "Revenue",
          revenue.shown,
          h("span", { class: "nx-muted" }, `${t.sales} sale${t.sales === 1 ? "" : "s"} · ${t.signups} sign-up${t.signups === 1 ? "" : "s"}`),
          todayRow?.revenue ? h("span", { class: "nx-delta is-good" }, `+${moneyExact(todayRow.revenue)} today`) : null,
          revenue.tag,
        ),
      ),
      socialRefresh(ctx, p),
    ),
  );

  // 5. Timeline.
  out.push(infoSection(ctx, "timeline", undefined, timeline(p, st.day, st.totalDays)));

  // 6. Linked accounts.
  out.push(infoSection(ctx, "linked", undefined, connections(ctx, p, st.day)));

  // 7. Free social stats.
  const drawerId = `social:${p.name}`;
  out.push(
    drawer({
      id: drawerId,
      open: ctx.mem.drawers.has(drawerId),
      onToggle: (o) => (o ? ctx.mem.drawers.add(drawerId) : ctx.mem.drawers.delete(drawerId)),
      label: h("span", null, "📊 Free social stats ", h("span", { class: "nx-muted" }, "followers, views and best video per app")),
      body: () => organicTable(ctx, p),
    }),
  );

  // 8. The two doors.
  const door = (tab: Tab, icon: string, title: string, sub: string) => {
    const b = h("button", { class: "nx-door nx-pressable", type: "button" }, h("span", { class: "nx-door-icon", "aria-hidden": "true" }, icon), h("span", { class: "nx-door-title" }, `${title} →`), h("span", { class: "nx-muted" }, sub));
    b.addEventListener("click", () => ctx.go({ level: "product", name: p.name, tab }));
    return b;
  };
  const hubLink = p.hubPath
    ? (() => {
        const b = h("button", { class: "nx-link", type: "button", title: "The table of contents for this product. It holds the official status and Day 1." }, `Open ${p.displayName}'s hub note →`);
        b.addEventListener("click", () => ctx.host.openPath(p.hubPath as string));
        return b;
      })()
    : null;
  out.push(
    h(
      "div",
      { class: "nx-doors" },
      door("marketing", "📈", "Marketing side", "Competitors, hooks, videos to make, brand kit, paid test, daily numbers"),
      door("dev", "💻", "Developer side", "Product profile, the 3 core features, progress log, ready-to-launch checks"),
    ),
    h("div", { class: "nx-footer-links" }, hubLink, p.category ? h("span", { class: "nx-muted" }, `Category: ${p.category.title}`) : null),
  );
  return out;
}

function tile(label: string, value: HTMLElement, ...rest: (HTMLElement | null)[]): HTMLElement {
  return h("div", { class: "nx-card nx-tile" }, h("span", { class: "nx-card-label" }, label), value, ...rest);
}

function timeline(p: ProductSnapshot, day: number | null, total: number): HTMLElement {
  const marks = [
    { d: 1, label: "Day 1" },
    { d: 14, label: "Launch day" },
    { d: 21, label: "Kill check" },
    { d: 28, label: "Decision day" },
    ...(total > 28 ? [{ d: 35, label: "Extra week ends" }] : []),
  ];
  const pos = (d: number) => `${((d - 1) / (total - 1)) * 100}%`;
  const track = h("div", { class: "nx-timeline" }, h("div", { class: "nx-tl-line" }));
  if (day !== null && day >= 1) {
    track.append(h("div", { class: "nx-tl-done", style: { width: pos(Math.min(day, total)) } }));
  }
  marks.forEach((m) =>
    track.append(
      h(
        "div",
        { class: ["nx-tl-mark", day !== null && day >= m.d && "is-past", day === m.d && "is-today"], style: { left: pos(m.d) } },
        h("span", { class: "nx-tl-dot" }),
        h("span", { class: "nx-tl-label" }, m.label, h("br"), h("span", { class: "nx-muted" }, p.cycleStart ? longDate(addDays(p.cycleStart, m.d - 1)).replace(/, \d{4}$/, "") : `Day ${m.d}`)),
      ),
    ),
  );
  if (day !== null && day >= 1 && day <= total) {
    track.append(h("div", { class: "nx-tl-today", style: { left: pos(day) } }, h("span", null, `Today · day ${day}`)));
  }
  const wrap = h("div", null, track);
  if (day === null) wrap.append(h("p", { class: "nx-muted" }, "The dates appear once Day 1 is set."));
  return wrap;
}

function connections(ctx: Ctx, p: ProductSnapshot, day: number | null): HTMLElement {
  const row = h("div", { class: "nx-pills" });
  const handle = (label: string, key: "tiktok" | "instagram" | "youtube" | "x") => {
    const v = p.handles[key];
    if (v) {
      const pill = h("button", { class: "nx-pill is-on nx-pressable", type: "button", title: "Click to copy the handle" }, h("span", { class: "nx-dot is-on" }), `${label} ${v}`);
      pill.addEventListener("click", async () => {
        await ctx.host.copy(v);
        pill.setAttribute("data-tip", "Copied");
        replayClass(pill, "show-tip", 1200);
      });
      return pill;
    }
    const pill = h("button", { class: "nx-pill nx-pressable", type: "button", title: `Paste the ${label} handle once the account exists` }, h("span", { class: "nx-dot" }), `+ Add ${label} handle`);
    pill.addEventListener("click", () => connectSheet(ctx, p, "marketing", key, `${label} handle`, "@handle"));
    return pill;
  };
  row.append(handle("TikTok", "tiktok"), handle("Instagram", "instagram"), handle("YouTube", "youtube"));
  if (p.hasXField) row.append(handle("X", "x"));

  const stripe = h(
    "button",
    { class: ["nx-pill", "nx-pressable", p.stripeLink && "is-on"], type: "button", title: p.stripeLink ? p.stripeLink : "Paste the Stripe payment link into the Brand kit table" },
    h("span", { class: ["nx-dot", p.stripeLink && "is-on"] }),
    p.stripeLink ? "Stripe checkout link" : "+ Add Stripe checkout link",
  );
  stripe.addEventListener("click", () => ctx.openDoc(p, "marketing", "Brand kit"));
  row.append(stripe);

  if (p.repoUrl) {
    const pill = h("button", { class: "nx-pill is-on nx-pressable", type: "button", title: "Click to copy the repo link" }, h("span", { class: "nx-dot is-on" }), `Code repo · version ${p.currentVersion}`);
    pill.addEventListener("click", async () => {
      await ctx.host.copy(p.repoUrl);
      pill.setAttribute("data-tip", "Copied");
      replayClass(pill, "show-tip", 1200);
    });
    row.append(pill);
  } else {
    const pill = h("button", { class: "nx-pill nx-pressable", type: "button", title: "Where the product's code lives (GitHub)" }, h("span", { class: "nx-dot" }), "+ Add code repo link");
    pill.addEventListener("click", () => connectSheet(ctx, p, "spec", "repo_url", "GitHub repo link", "https://github.com/…"));
    row.append(pill);
  }

  const t = ctx.totals(p);
  const adsLive = (day ?? 0) >= 15;
  const ads = h(
    "button",
    { class: ["nx-pill", "nx-pressable", adsLive && t.spend > 0 && "is-on", !adsLive && "is-off"], type: "button", title: adsLive ? "Open the Daily numbers table" : "Paid ads start on day 15" },
    h("span", { class: ["nx-dot", adsLive && t.spend > 0 && "is-on"] }),
    !adsLive ? "Paid ads start day 15" : t.spend > 0 ? `Paid ads · $${fmtMoney(t.spend)} spent` : "+ Log ad spend",
  );
  ads.addEventListener("click", () => ctx.openDoc(p, "analytics", "ledger"));
  row.append(ads);
  return row;
}

/** "When was this last refreshed", in hours for the same day. Marker times are UTC minutes. */
function agoText(iso: string): string {
  const ms = Date.now() - Date.parse(`${iso}:00Z`);
  if (!Number.isFinite(ms)) return "at an unknown time";
  const min = Math.round(ms / 60_000);
  if (min < 2) return "just now";
  if (min < 60) return `${min} minutes ago`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/**
 * The manual "Refresh social stats" button (TikTok + Instagram through the scrape kit).
 * Never runs by itself. Asks first if the last refresh was recent, to keep ban risk low.
 */
export function socialRefresh(ctx: Ctx, p: ProductSnapshot): HTMLElement {
  const kit = ctx.host.socialKit();
  const handles = SOCIAL_PLATFORMS.filter((pl) => p.handles[pl]);
  const times = SOCIAL_PLATFORMS.map((pl) => p.socialRefreshed[pl]).filter((x): x is string => !!x).sort();
  const last = times.at(-1) ?? null;
  const lastText = SOCIAL_PLATFORMS.filter((pl) => p.socialRefreshed[pl])
    .map((pl) => `${PLATFORM_LABEL[pl]} ${agoText(p.socialRefreshed[pl] as string)}`)
    .join(" · ");
  const row = h("div", { class: "nx-refresh" });
  row.append(
    h(
      "div",
      { class: "nx-refresh-text" },
      h("strong", null, "TikTok + Instagram numbers"),
      h("span", { class: "nx-muted" }, last ? `Last refreshed: ${lastText}.` : "Never refreshed yet."),
      h("span", { class: "nx-muted" }, "Opens each app once in a hidden browser on this computer (about a minute). Only runs when you press the button."),
    ),
  );
  if (!kit.ok) {
    row.append(h("span", { class: "nx-source is-notyet" }, kit.reason));
    return row;
  }
  if (!handles.length) {
    row.append(h("span", { class: "nx-source is-youfill" }, "Add the TikTok or Instagram handle first (Linked accounts)."));
    return row;
  }
  const hoursSince = last ? (Date.now() - Date.parse(`${last}:00Z`)) / 3_600_000 : Infinity;
  const run = async () => {
    const res = await ctx.host.refreshSocial(p, (m) => ctx.app.toast(m));
    if (!res.updated.length) throw new Error(res.errors.join(" ") || "Nothing was updated.");
    ctx.app.toast(`Social stats updated: ${res.updated.map((x) => `${PLATFORM_LABEL[x]} ✓`).join(" · ")}${res.errors.length ? ` · ${res.errors.join(" ")}` : ""}`, { tone: res.errors.length ? "warn" : "ok" });
  };
  const id = `refresh:${p.name}`;
  row.append(
    hoursSince < kit.minGapHours
      ? ctx.button({ id, label: "🔄 Refresh social stats", variant: "ghost", title: "You refreshed recently; it will ask first", onClick: () => confirmRefreshSheet(ctx, p, agoText(last as string), run) })
      : ctx.button({ id, label: "🔄 Refresh social stats", doneLabel: "Updated", title: `Reads ${handles.map((x) => PLATFORM_LABEL[x]).join(" + ")} now`, onClick: run }),
  );
  return row;
}

function organicTable(ctx: Ctx, p: ProductSnapshot): HTMLElement {
  if (!p.organic.length) return emptyNote("Couldn't find the free social stats table in Analytics and Gate.");
  return h(
    "div",
    { class: "nx-table-wrap" },
    h(
      "table",
      { class: "nx-table" },
      h("thead", null, h("tr", null, h("th", null, "App"), h("th", { class: "is-num" }, "Followers"), h("th", { class: "is-num" }, "Total views"), h("th", null, "Best video"))),
      h(
        "tbody",
        null,
        p.organic.map((r) =>
          h(
            "tr",
            null,
            h("td", null, r.platform),
            h("td", { class: "is-num" }, r.followers === null ? "—" : count(r.followers)),
            h("td", { class: "is-num" }, r.totalViews === null ? "—" : count(r.totalViews)),
            h("td", null, bestVideo(r.bestVideoLink, r.bestVideoViews)),
          ),
        ),
      ),
    ),
    h("p", { class: "nx-muted" }, "“—” means it's empty. TikTok and Instagram fill in when someone presses Refresh social stats; YouTube is typed by Marketing."),
    h("div", { class: "nx-footer-links" }, openLink(ctx, p, "analytics", "Update these numbers in Analytics and Gate →", "Organic snapshot")),
  );
}

/**
 * The Best video cell: a link only to a web address (the same rule as every card's links), else its text without a
 * link, so an obsidian: or file: address typed into the note never opens from the dashboard.
 */
export function bestVideo(link: string, views: number | null): Child {
  if (!link) return "—";
  const href = safeUrl(link);
  const text = views !== null ? `${count(views)} views` : "Open";
  return href ? h("a", { href, class: "nx-link", target: "_blank", rel: "noopener" }, `${text} ↗`) : h("span", { class: "nx-muted", title: link }, views !== null ? text : link);
}

// ── Marketing side ─────────────────────────────────────────────────────────

/**
 * Scrolls to a section further down this page (#nx-sec-<id>, U7) and moves keyboard focus to it, so Tab carries on
 * from there. No smooth scroll under reduced motion.
 */
function showBelow(ctx: Ctx, id: string): void {
  const el = ctx.app.root.querySelector<HTMLElement>(`#${CSS.escape(`nx-sec-${id}`)}`);
  if (!el) return;
  el.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
  if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
  el.focus({ preventScroll: true });
}

/** A "Before launch" counter. Clicking it shows its section further down the Marketing side (the note opens from the footer). */
function counter(ctx: Ctx, field: keyof typeof FIELDS, done: number, total: number, section: string, sub?: string): HTMLElement {
  const full = total > 0 && done >= total;
  const f = FIELDS[field];
  const b = h(
    "button",
    { class: ["nx-card", "nx-counter", "nx-pressable", full && "is-full"], type: "button", title: `${f.what} Click to see it below.` },
    h("span", { class: "nx-card-label" }, f.label),
    h("span", { class: "nx-counter-value" }, `${done}`, h("span", { class: "nx-muted" }, ` of ${total}`), full ? h("span", { class: "nx-counter-check", "aria-label": "complete" }, " ✓") : null),
    h("div", { class: "nx-mini" }, h("div", { class: "nx-mini-fill", style: { transform: `scaleX(${total ? Math.min(1, done / total) : 0})` } })),
    h("span", { class: "nx-muted" }, sub ?? f.what),
    h("span", { class: "nx-counter-open" }, "See below ", h("span", { "aria-hidden": "true" }, "↓")),
  );
  b.addEventListener("click", () => showBelow(ctx, section));
  return b;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The Videos scheduled counter's line: "1 scripted · 2 recorded · 0 edited", in the status steps' own words. */
export function videosSub(v: BacklogCounts): string {
  if (!v.total) return "No videos planned yet";
  return BACKLOG_STEPS.filter((step) => step.value !== "scheduled")
    .map((step) => `${v[step.value]} ${step.label.toLowerCase()}`)
    .join(" · ");
}

/** The hooks counter's line: how many slots, and whether the note still has the old 3-hook layout (U9). */
export function hooksSub(p: ProductSnapshot): string {
  const layout = p.marketing?.hooks?.layout;
  if (layout === "v2") return plural(p.hooksTotal, "rated hook");
  if (layout === "v1") return "3 hooks (old layout)";
  return "No hook list in the note yet";
}

/**
 * After launch (sprint day 15 on, normally status watching or extended) the paid test, the spend chart and the social
 * stats come first. A sprint still marked building on day 15 is past launch too, as the status colors already treat it.
 */
export function afterLaunch(status: string, day: number | null): boolean {
  return day !== null && day >= 15 && ["building", "watching", "extended"].includes(status.trim().toLowerCase());
}

/** The parts of the Marketing side between the quest log and the footer, top to bottom. */
export type MarketingPart = "missingNote" | "counters" | "competitors" | "hooks" | "videos" | "brandkit" | "paidtest" | "spend" | "social";

/**
 * Before launch: the counters and the Marketing Engine sections, then the paid test plan, the spend chart and the
 * social stats. After launch those last three come first. Without the Marketing Engine, one line names the missing
 * note (U8) where its sections would be; the spend chart and social stats come from Analytics and Gate, so they stay.
 */
export function marketingParts(after: boolean, hasNote: boolean): MarketingPart[] {
  const engine: MarketingPart[] = hasNote ? ["counters", "competitors", "hooks", "videos", "brandkit"] : ["missingNote"];
  const launch: MarketingPart[] = hasNote ? ["paidtest", "spend", "social"] : ["spend", "social"];
  return after ? [...launch, ...engine] : [...engine, ...launch];
}

function marketing(ctx: Ctx, p: ProductSnapshot): HTMLElement[] {
  const st = ctx.status(p);
  const header = h(
    "div",
    { class: "nx-side-head" },
    h("div", null, h("h2", null, "Marketing side"), h("span", { class: "nx-muted" }, "Everything the Marketer owns for this product. Notes: Marketing Engine + Analytics and Gate.")),
    h(
      "div",
      { class: "nx-side-actions" },
      ctx.button({ id: `mkt:${p.name}:posted`, label: "I posted today", doneLabel: "Logged", title: "Records today's date as the last post", onClick: async () => { const u = await ctx.host.postedToday(p); ctx.mem.flash.set(`${p.name}:post`, Date.now() + 1300); return u; } }),
      ctx.button({ id: `mkt:${p.name}:log`, label: "Log today's numbers →", variant: "ghost", title: "Opens the Daily numbers table", onClick: () => ctx.openDoc(p, "analytics", "ledger") }),
    ),
  );
  const counters = () => {
    // The snapshot counts videos the way Videos to make shows them (marketingCounts), so the quests agree too.
    const v = p.backlog;
    return h(
      "section",
      { class: "nx-section" },
      h("h3", { class: "nx-section-title" }, "Before launch: get these to full"),
      h(
        "div",
        { class: "nx-counters" },
        counter(ctx, "competitors", p.competitorsFilled, 3, "competitors"),
        counter(ctx, "hooks", p.hooksFilled, p.hooksTotal, "hooks", hooksSub(p)),
        counter(ctx, "brandKit", p.brandKit.filled, p.brandKit.total || 6, "brandkit"),
        counter(ctx, "scheduled", v.scheduled, Math.max(v.total, 1), "videos", videosSub(v)),
      ),
    );
  };
  const parts: Record<MarketingPart, () => HTMLElement> = {
    missingNote: () => h("section", { class: "nx-section" }, emptyNote(`${p.displayName} has no Marketing Engine note (${DOC_FILES.marketing}).`)),
    counters,
    competitors: () => competitorsSection(ctx, p),
    hooks: () => hooksSection(ctx, p),
    videos: () => videosSection(ctx, p),
    brandkit: () => brandKitSection(ctx, p),
    paidtest: () => paidTestSection(ctx, p),
    spend: () => infoSection(ctx, "dailyNumbers", `Ad spend vs revenue, day by day (days 15–${st.totalDays})`, spendChart(ctx, p, st.totalDays)),
    social: () => infoSection(ctx, "socialStats", undefined, socialRefresh(ctx, p), organicTable(ctx, p)),
  };
  return [
    header,
    questLog(ctx, { id: `mkt:${p.name}`, field: "questLog", title: "Marketing quests", quests: quests(ctx, p), product: p, lockedFilter: "marketing", emptyText: "No marketing quests right now." }),
    ...marketingParts(afterLaunch(p.status, st.day), !!p.marketing).map((part) => parts[part]()),
    h("div", { class: "nx-footer-links" }, openLink(ctx, p, "marketing", "Open Marketing Engine →"), openLink(ctx, p, "analytics", "Open Analytics and Gate →")),
  ];
}

/** Grouped bars per day, one $ axis. Hover or focus a day for exact values; the Daily numbers table is the table view. */
function spendChart(ctx: Ctx, p: ProductSnapshot, totalDays: number): HTMLElement {
  const days = Array.from({ length: totalDays - 14 }, (_, i) => 15 + i);
  const rows = days.map((d) => p.ledger.find((r) => r.day === d) ?? { day: d, spend: 0, revenue: 0 });
  const max = Math.max(...rows.map((r) => Math.max(r.spend, r.revenue)));
  if (max <= 0) {
    const st = ctx.status(p);
    const text = (st.day ?? 0) < 15 ? "⏳ Not yet: paid ads and the Daily numbers table start on day 15." : "✍️ Needs you · Marketing: no numbers logged yet. Copy them from Ads Manager into the Daily numbers table.";
    return emptyNote(text, openLink(ctx, p, "analytics", "Open Daily numbers →", "ledger"));
  }
  const W = 640;
  const H = 200;
  const pad = { l: 44, r: 8, t: 10, b: 26 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const nice = niceMax(max);
  const y = (v: number) => pad.t + ih - (v / nice) * ih;
  const group = iw / days.length;
  const bw = Math.max(4, Math.min(16, (group - 10) / 2));

  const svg = s("svg", { class: "nx-chart", viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `Ad spend and revenue per day, days 15 to ${totalDays}` });
  [0, 0.5, 1].forEach((f) => {
    const v = nice * f;
    svg.append(
      s("line", { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), class: f === 0 ? "nx-axis" : "nx-grid-line" }),
      s("text", { x: pad.l - 6, y: y(v) + 4, class: "nx-tick", "text-anchor": "end" }, money(v)),
    );
  });

  const tip = h("div", { class: "nx-tip", hidden: true });
  const wrap = h("div", { class: "nx-chart-wrap" });
  const barPath = (x: number, v: number) => {
    const top = y(v);
    const hgt = pad.t + ih - top;
    if (hgt <= 0) return "";
    const r = Math.min(4, bw / 2, hgt);
    const b = pad.t + ih;
    return `M${x},${b} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${b} Z`;
  };

  rows.forEach((r, i) => {
    const gx = pad.l + i * group;
    const cx = gx + group / 2;
    const xs = cx - bw - 1;
    const xr = cx + 1;
    const g = s("g", { class: "nx-bar-group", tabindex: "0", "aria-label": `Day ${r.day}: ad spend ${moneyExact(r.spend)}, revenue ${moneyExact(r.revenue)}` });
    g.append(s("rect", { x: gx, y: pad.t, width: group, height: ih, class: "nx-hit" }));
    if (r.spend > 0) g.append(s("path", { d: barPath(xs, r.spend), class: "nx-bar nx-bar-spend" }));
    if (r.revenue > 0) g.append(s("path", { d: barPath(xr, r.revenue), class: "nx-bar nx-bar-revenue" }));
    if (i % 2 === 0) svg.append(s("text", { x: cx, y: H - 8, class: "nx-tick", "text-anchor": "middle" }, String(r.day)));
    const show = () => {
      tip.hidden = false;
      tip.replaceChildren(
        h("strong", null, `Day ${r.day}`),
        h("span", { class: "nx-tip-row" }, h("span", { class: "nx-key nx-key-spend" }), h("b", null, moneyExact(r.spend)), " ad spend"),
        h("span", { class: "nx-tip-row" }, h("span", { class: "nx-key nx-key-revenue" }), h("b", null, moneyExact(r.revenue)), " revenue"),
      );
      tip.style.left = `${(cx / W) * 100}%`;
      g.classList.add("is-hover");
    };
    const hide = () => {
      tip.hidden = true;
      g.classList.remove("is-hover");
    };
    g.addEventListener("pointerenter", show);
    g.addEventListener("pointerleave", hide);
    g.addEventListener("focus", show);
    g.addEventListener("blur", hide);
    svg.append(g);
  });

  const legend = h(
    "div",
    { class: "nx-legend" },
    h("span", null, h("span", { class: "nx-key nx-key-spend" }), "Ad spend"),
    h("span", null, h("span", { class: "nx-key nx-key-revenue" }), "Revenue"),
    openLink(ctx, p, "analytics", "See the full table →", "ledger"),
  );
  wrap.append(svg, tip);
  return h("div", null, legend, wrap);
}

function niceMax(v: number): number {
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  const n = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return n * exp;
}

// ── Developer side ─────────────────────────────────────────────────────────

function dev(ctx: Ctx, p: ProductSnapshot): HTMLElement[] {
  const { today, mem } = ctx;
  const header = h(
    "div",
    { class: "nx-side-head" },
    h("div", null, h("h2", null, "Developer side"), h("span", { class: "nx-muted" }, "Everything the Developer owns for this product. Notes: Dev Spec, Launch Checklist, Changelog, Red-Team Audit.")),
    h("div", { class: "nx-side-actions" }, ctx.button({ id: `dev:${p.name}:changelog`, label: "Open Changelog →", variant: "ghost", onClick: () => ctx.openDoc(p, "changelog") })),
  );

  // Day-14 readiness light: one segment per condition; glows once when all are done.
  const checklistDone = p.launchChecks.total > 0 && p.launchChecks.done === p.launchChecks.total;
  const segs = [
    { ok: checklistDone, label: `Launch Checklist ${p.launchChecks.done} of ${p.launchChecks.total}`, doc: "launch" as DocKey, heading: "Product" },
    { ok: p.blockingIssuesOpen === 0 && !!p.auditDate, label: p.auditDate ? `Break-it test: ${p.blockingIssuesOpen} blocking problem${p.blockingIssuesOpen === 1 ? "" : "s"}` : "Break-it test not done yet", doc: "audit" as DocKey, heading: "Result" },
    { ok: p.signedOffDev, label: "Developer signed off", doc: "launch" as DocKey, heading: "Sign-off" },
    { ok: p.signedOffMarketing, label: "Marketer signed off", doc: "launch" as DocKey, heading: "Sign-off" },
  ];
  const allOk = segs.every((x) => x.ok);
  const glowKey = `ready:${p.name}`;
  const glow = allOk && !mem.glowed.has(glowKey);
  if (allOk) mem.glowed.add(glowKey);
  else mem.glowed.delete(glowKey);
  const readiness = h(
    "section",
    { class: "nx-section" },
    sectionHead(ctx, "readiness", undefined, h("strong", null, allOk ? "✓ Ready to launch" : `${segs.filter((x) => x.ok).length} of 4 done`)),
    h(
      "div",
      { class: ["nx-card", "nx-ready", allOk && "is-ready", glow && "nx-glow"] },
      h(
        "div",
        { class: "nx-segs" },
        segs.map((sg) => {
          const b = h("button", { class: ["nx-seg", "nx-pressable", sg.ok && "is-ok"], type: "button", title: `Open ${NOTE_NAMES[sg.doc]}` }, h("span", { class: "nx-seg-bar" }), h("span", { class: "nx-seg-label" }, sg.ok ? `✓ ${sg.label}` : sg.label));
          b.addEventListener("click", () => ctx.openDoc(p, sg.doc, sg.heading));
          return b;
        }),
      ),
    ),
  );

  const mech = h(
    "div",
    { class: "nx-card" },
    h("span", { class: "nx-card-label" }, FIELDS.mechanics.label),
    p.pitch ? h("p", { class: "nx-pitch" }, `“${p.pitch}”`) : null,
    p.mechanics.length
      ? h("ol", { class: "nx-mech" }, p.mechanics.map((m) => h("li", null, m)))
      : emptyNote("Not written yet. Claude can help draft them.", openLink(ctx, p, "spec", "Open Dev Spec →", "Core mechanics")),
    h(
      "div",
      { class: "nx-milestones" },
      h("span", { class: "nx-muted" }, `Build plan: ${p.milestones.done} of ${p.milestones.total} milestones done`),
      h("div", { class: "nx-mini" }, h("div", { class: "nx-mini-fill", style: { transform: `scaleX(${p.milestones.total ? p.milestones.done / p.milestones.total : 0})` } })),
    ),
  );

  const changes = h(
    "div",
    { class: "nx-card" },
    h("span", { class: "nx-card-label" }, `${FIELDS.changelog.label} · version ${p.currentVersion}`, p.lastChangelogDate ? rel(p.lastChangelogDate, today) : null),
    p.changelog.length
      ? h(
          "ul",
          { class: "nx-changes" },
          p.changelog.slice(0, 3).map((e) =>
            h(
              "li",
              null,
              h("span", { class: "nx-version" }, `v${e.version}`),
              h("span", { class: "nx-muted" }, ` ${e.date} `),
              [...e.added.map((x) => `+ ${x}`), ...e.fixed.map((x) => `✓ ${x}`), ...e.removed.map((x) => `− ${x}`)].slice(0, 3).map((x) => h("div", { class: "nx-change" }, x)),
            ),
          ),
        )
      : emptyNote("No entries yet. Each entry resets the Gone Quiet timer during the build."),
  );

  // Only a web address becomes a link; anything else in repo_url (obsidian:, file:, …) shows as plain text.
  const repoHref = p.repoUrl ? safeUrl(p.repoUrl) : undefined;
  const repo = p.repoUrl
    ? repoHref
      ? h("a", { class: "nx-link", href: repoHref, target: "_blank", rel: "noopener" }, `${p.repoUrl.replace(/^https?:\/\//, "")} ↗`)
      : h("span", { class: "nx-muted" }, p.repoUrl)
    : (() => {
        const b = h("button", { class: "nx-link", type: "button" }, "+ Add code repo link");
        b.addEventListener("click", () => connectSheet(ctx, p, "spec", "repo_url", "GitHub repo link", "https://github.com/…"));
        return b;
      })();

  return [
    header,
    questLog(ctx, { id: `dev:${p.name}`, field: "questLog", title: "Developer quests", quests: quests(ctx, p), product: p, lockedFilter: "dev", emptyText: "No developer quests right now." }),
    readiness,
    profileLine(ctx, p),
    h("div", { class: "nx-two" }, mech, changes),
    h(
      "div",
      { class: "nx-footer-links" },
      h("span", null, "Code repo: ", repo),
      openLink(ctx, p, "spec", "Dev Spec →"),
      openLink(ctx, p, "launch", "Launch Checklist →"),
      openLink(ctx, p, "changelog", "Changelog →"),
      openLink(ctx, p, "audit", "Red-Team Audit →"),
    ),
  ];
}
