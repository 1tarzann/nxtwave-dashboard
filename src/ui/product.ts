// Levels 2 and 3: the product hub (Overview) and the Marketing / Dev sides.

import { addDays, longDate } from "../data/dates";
import { fmtMoney } from "../data/status";
import { DocKey, ProductSnapshot, SPEND_CAP } from "../data/types";
import { Ctx, Tab } from "./app";
import { count, drawer, emptyNote, money, moneyExact, rel, section } from "./components";
import { h, s } from "./dom";
import { replayClass } from "./motion";
import { connectSheet } from "./sheets";

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

// ── Overview (the hub) ─────────────────────────────────────────────────────

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
  if (p.outOfSync) notes.push(h("span", { class: "nx-warn-chip" }, "⚠ The hub and the 6 files disagree on sprint_status or cycle_start"));
  p.warnings.forEach((w) => notes.push(h("span", { class: "nx-warn-chip" }, `⚠ ${w}`)));
  if (t.totalsMismatch) notes.push(h("span", { class: "nx-warn-chip", title: "Using the larger number" }, "⚠ total_spend / total_revenue don't match the ledger sum"));
  if (notes.length) out.push(h("div", { class: "nx-chips-row" }, notes));

  // 2. Activity pulse.
  const latest = p.changelog[0];
  const devLine = latest ? latest.added[0] ?? latest.fixed[0] ?? latest.removed[0] ?? "" : "";
  const handles = [p.handles.tiktok, p.handles.instagram, p.handles.youtube].filter(Boolean);
  out.push(
    h(
      "div",
      { class: "nx-pulse-row" },
      h(
        "div",
        { class: ["nx-card", "nx-pulse-card", ctx.flashCls(`${p.name}:post`)] },
        h("span", { class: "nx-card-label" }, "📣 Last social post"),
        h("span", { class: "nx-pulse-big" }, (st.day ?? 0) < 15 && !p.lastSocialPostDate ? "Not live yet" : rel(p.lastSocialPostDate, today)),
        h("span", { class: "nx-muted" }, handles.length ? handles.join(" · ") : (st.day ?? 0) < 15 ? "Content goes live on day 14" : "No handles connected"),
        ctx.button({ id: `pulse:${p.name}:posted`, label: "Posted today", doneLabel: "Logged", variant: "quiet", onClick: async () => { const u = await ctx.host.postedToday(p); ctx.mem.flash.set(`${p.name}:post`, Date.now() + 1300); return u; } }),
      ),
      h(
        "div",
        { class: "nx-card nx-pulse-card" },
        h("span", { class: "nx-card-label" }, "🛠 Last dev update"),
        h("span", { class: "nx-pulse-big" }, rel(p.lastChangelogDate, today)),
        h("span", { class: "nx-muted" }, p.lastChangelogDate ? `v${p.currentVersion}${devLine ? ` · ${devLine}` : ""}` : "No changelog entry yet"),
        openLink(ctx, p, "changelog", "Open changelog →"),
      ),
    ),
  );

  // 3. Money + funnel boxes.
  const todayRow = p.ledger.find((r) => r.date === today || r.day === st.day);
  const capPct = Math.min(1, t.spend / SPEND_CAP);
  out.push(
    h(
      "div",
      { class: "nx-tiles" },
      tile(
        "Ad spend",
        ctx.num(`${p.name}:spend`, t.spend, money, "nx-tile-value"),
        h("div", { class: "nx-cap" }, h("div", { class: ["nx-cap-fill", capPct >= 1 && "is-full"], style: { transform: `scaleX(${capPct})` } })),
        h("span", { class: "nx-muted" }, capPct >= 1 ? `At the $${SPEND_CAP} cap: stop paid` : `of $${SPEND_CAP} cap`),
        todayRow?.spend ? h("span", { class: "nx-delta" }, `+${moneyExact(todayRow.spend)} today`) : null,
      ),
      tile("Views", ctx.num(`${p.name}:views`, t.views, count, "nx-tile-value"), h("span", { class: "nx-muted" }, "organic, all platforms")),
      tile(
        "Clicks",
        ctx.num(`${p.name}:clicks`, t.clicks, count, "nx-tile-value"),
        h("span", { class: "nx-muted" }, t.ctr === null ? "click rate: no impressions yet" : `click rate ${t.ctr.toFixed(2)}%`),
      ),
      tile(
        "Revenue",
        ctx.num(`${p.name}:revenue`, t.revenue, money, "nx-tile-value"),
        h("span", { class: "nx-muted" }, `${t.sales} sale${t.sales === 1 ? "" : "s"} · ${t.signups} sign-up${t.signups === 1 ? "" : "s"}`),
        todayRow?.revenue ? h("span", { class: "nx-delta is-good" }, `+${moneyExact(todayRow.revenue)} today`) : null,
      ),
    ),
  );

  // 4. Gate timeline.
  out.push(section("Timeline", timeline(p, st.day, st.totalDays)));

  // 5. Connection pills.
  out.push(section("Connections", connections(ctx, p, st.day)));

  // 6. Social stats drawer.
  const drawerId = `social:${p.name}`;
  out.push(
    drawer({
      id: drawerId,
      open: ctx.mem.drawers.has(drawerId),
      onToggle: (o) => (o ? ctx.mem.drawers.add(drawerId) : ctx.mem.drawers.delete(drawerId)),
      label: h("span", null, "Expand social stats"),
      body: () => organicTable(ctx, p),
    }),
  );

  // 7. The two doors.
  const door = (tab: Tab, icon: string, title: string, sub: string) => {
    const b = h("button", { class: "nx-door nx-pressable", type: "button" }, h("span", { class: "nx-door-icon", "aria-hidden": "true" }, icon), h("span", { class: "nx-door-title" }, `${title} →`), h("span", { class: "nx-muted" }, sub));
    b.addEventListener("click", () => ctx.go({ level: "product", name: p.name, tab }));
    return b;
  };
  const hubLink = p.hubPath
    ? (() => {
        const b = h("button", { class: "nx-link", type: "button" }, `Open ${p.displayName} hub note →`);
        b.addEventListener("click", () => ctx.host.openPath(p.hubPath as string));
        return b;
      })()
    : null;
  out.push(
    h(
      "div",
      { class: "nx-doors" },
      door("marketing", "📈", "Open Marketing Side", "Swipe, hooks, backlog, ledger"),
      door("dev", "💻", "Open Developer Side", "Spec, changelog, launch readiness"),
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
    { d: 14, label: "Launch gate" },
    { d: 21, label: "Kill check" },
    { d: 28, label: "Verdict" },
    ...(total > 28 ? [{ d: 35, label: "Extension ends" }] : []),
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
  return track;
}

function connections(ctx: Ctx, p: ProductSnapshot, day: number | null): HTMLElement {
  const row = h("div", { class: "nx-pills" });
  const handle = (label: string, key: "tiktok" | "instagram" | "youtube") => {
    const v = p.handles[key];
    if (v) {
      const pill = h("button", { class: "nx-pill is-on nx-pressable", type: "button", title: "Click to copy" }, h("span", { class: "nx-dot is-on" }), `${label} ${v}`);
      pill.addEventListener("click", async () => {
        await ctx.host.copy(v);
        pill.setAttribute("data-tip", "Copied");
        replayClass(pill, "show-tip", 1200);
      });
      return pill;
    }
    const pill = h("button", { class: "nx-pill nx-pressable", type: "button" }, h("span", { class: "nx-dot" }), `+ Connect ${label}`);
    pill.addEventListener("click", () => connectSheet(ctx, p, "marketing", key, `${label} handle`, "@handle"));
    return pill;
  };
  row.append(handle("TikTok", "tiktok"), handle("Instagram", "instagram"), handle("YouTube", "youtube"));

  if (p.stripeLink) {
    const pill = h("button", { class: "nx-pill is-on nx-pressable", type: "button", title: p.stripeLink }, h("span", { class: "nx-dot is-on" }), "Stripe link");
    pill.addEventListener("click", () => ctx.openDoc(p, "marketing", "Brand kit"));
    row.append(pill);
  } else {
    const pill = h("button", { class: "nx-pill nx-pressable", type: "button", title: "Add it in the Brand kit table" }, h("span", { class: "nx-dot" }), "+ Link checkout");
    pill.addEventListener("click", () => ctx.openDoc(p, "marketing", "Brand kit"));
    row.append(pill);
  }

  if (p.repoUrl) {
    const pill = h("button", { class: "nx-pill is-on nx-pressable", type: "button", title: "Click to copy" }, h("span", { class: "nx-dot is-on" }), `Repo · v${p.currentVersion}`);
    pill.addEventListener("click", async () => {
      await ctx.host.copy(p.repoUrl);
      pill.setAttribute("data-tip", "Copied");
      replayClass(pill, "show-tip", 1200);
    });
    row.append(pill);
  } else {
    const pill = h("button", { class: "nx-pill nx-pressable", type: "button" }, h("span", { class: "nx-dot" }), "+ Link GitHub repo");
    pill.addEventListener("click", () => connectSheet(ctx, p, "spec", "repo_url", "GitHub repo URL", "https://github.com/…"));
    row.append(pill);
  }

  const t = ctx.totals(p);
  const adsLive = (day ?? 0) >= 15;
  const ads = h(
    "button",
    { class: ["nx-pill", "nx-pressable", adsLive && t.spend > 0 && "is-on", !adsLive && "is-off"], type: "button", title: adsLive ? "Open the ledger" : "Ads start on day 15" },
    h("span", { class: ["nx-dot", adsLive && t.spend > 0 && "is-on"] }),
    !adsLive ? "Ads · day 15" : t.spend > 0 ? `Ads · $${fmtMoney(t.spend)} spent` : "+ Log ad spend",
  );
  ads.addEventListener("click", () => ctx.openDoc(p, "analytics", "ledger"));
  row.append(ads);
  return row;
}

function organicTable(ctx: Ctx, p: ProductSnapshot): HTMLElement {
  if (!p.organic.length) return emptyNote("No organic table found in 3_Analytics_And_Gate §2.");
  return h(
    "div",
    { class: "nx-table-wrap" },
    h(
      "table",
      { class: "nx-table" },
      h("thead", null, h("tr", null, h("th", null, "Platform"), h("th", { class: "is-num" }, "Followers"), h("th", { class: "is-num" }, "Total views"), h("th", null, "Best video"))),
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
            h("td", null, r.bestVideoLink ? h("a", { href: r.bestVideoLink, class: "nx-link", target: "_blank", rel: "noopener" }, r.bestVideoViews !== null ? `${count(r.bestVideoViews)} views ↗` : "Open ↗") : "—"),
          ),
        ),
      ),
    ),
    h("div", { class: "nx-footer-links" }, openLink(ctx, p, "analytics", "Update these numbers →", "Organic snapshot")),
  );
}

// ── Marketing side ─────────────────────────────────────────────────────────

function counter(ctx: Ctx, p: ProductSnapshot, label: string, done: number, total: number, doc: DocKey, heading: string, sub?: string): HTMLElement {
  const full = total > 0 && done >= total;
  const b = h(
    "button",
    { class: ["nx-card", "nx-counter", "nx-pressable", full && "is-full"], type: "button", title: `Open ${heading}` },
    h("span", { class: "nx-card-label" }, label),
    h("span", { class: "nx-counter-value" }, `${done}`, h("span", { class: "nx-muted" }, ` / ${total}`), full ? h("span", { class: "nx-counter-check", "aria-label": "complete" }, " ✓") : null),
    h("div", { class: "nx-mini" }, h("div", { class: "nx-mini-fill", style: { transform: `scaleX(${total ? Math.min(1, done / total) : 0})` } })),
    sub ? h("span", { class: "nx-muted" }, sub) : null,
  );
  b.addEventListener("click", () => ctx.openDoc(p, doc, heading));
  return b;
}

function marketing(ctx: Ctx, p: ProductSnapshot): HTMLElement[] {
  const st = ctx.status(p);
  const b = p.backlog;
  const header = h(
    "div",
    { class: "nx-side-head" },
    h("div", null, h("h2", null, "Marketing side"), h("span", { class: "nx-muted" }, "Owned by the Marketer · 2_Marketing_Engine + 3_Analytics_And_Gate")),
    h(
      "div",
      { class: "nx-side-actions" },
      ctx.button({ id: `mkt:${p.name}:posted`, label: "Posted today", doneLabel: "Logged", onClick: async () => { const u = await ctx.host.postedToday(p); ctx.mem.flash.set(`${p.name}:post`, Date.now() + 1300); return u; } }),
      ctx.button({ id: `mkt:${p.name}:log`, label: "Log today's numbers →", variant: "ghost", onClick: () => ctx.openDoc(p, "analytics", "ledger") }),
    ),
  );
  const counters = h(
    "div",
    { class: "nx-counters" },
    counter(ctx, p, "Competitor swipe", p.competitorsFilled, 3, "marketing", "Competitor swipe"),
    counter(ctx, p, "Hook scripts", p.hooksFilled, 3, "marketing", "Hook scripts"),
    counter(ctx, p, "Brand kit", p.brandKit.filled, p.brandKit.total || 6, "marketing", "Brand kit"),
    counter(ctx, p, "Content scheduled", b.scheduled, Math.max(b.total, 1), "marketing", "Content backlog", b.total ? `${b.scripted} scripted · ${b.recorded} recorded · ${b.edited} edited` : "Backlog is empty"),
  );
  return [
    header,
    counters,
    section(
      `Ad spend vs revenue · days 15–${st.totalDays}`,
      spendChart(ctx, p, st.totalDays),
    ),
    section("Organic snapshot", organicTable(ctx, p)),
    h("div", { class: "nx-footer-links" }, openLink(ctx, p, "marketing", "Open 2 · Marketing Engine →"), openLink(ctx, p, "analytics", "Open 3 · Analytics and Gate →")),
  ];
}

/** Grouped bars per day, one $ axis. Hover or focus a day for exact values; the ledger is the table view. */
function spendChart(ctx: Ctx, p: ProductSnapshot, totalDays: number): HTMLElement {
  const days = Array.from({ length: totalDays - 14 }, (_, i) => 15 + i);
  const rows = days.map((d) => p.ledger.find((r) => r.day === d) ?? { day: d, spend: 0, revenue: 0 });
  const max = Math.max(...rows.map((r) => Math.max(r.spend, r.revenue)));
  if (max <= 0) {
    return emptyNote("No ad spend or revenue logged yet. The ledger starts on day 15.", openLink(ctx, p, "analytics", "Open ledger →", "ledger"));
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
    const g = s("g", { class: "nx-bar-group", tabindex: "0", "aria-label": `Day ${r.day}: spend ${moneyExact(r.spend)}, revenue ${moneyExact(r.revenue)}` });
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
    openLink(ctx, p, "analytics", "Open ledger (table) →", "ledger"),
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

// ── Dev side ───────────────────────────────────────────────────────────────

function dev(ctx: Ctx, p: ProductSnapshot): HTMLElement[] {
  const { today, mem } = ctx;
  const header = h(
    "div",
    { class: "nx-side-head" },
    h("div", null, h("h2", null, "Developer side"), h("span", { class: "nx-muted" }, "Owned by the Developer · 1_Dev_Spec, 4_Launch_Checklist, 5_Changelog, 6_RedTeam_Audit")),
    h("div", { class: "nx-side-actions" }, ctx.button({ id: `dev:${p.name}:changelog`, label: "Open changelog →", variant: "ghost", onClick: () => ctx.openDoc(p, "changelog") })),
  );

  // Day-14 readiness light: one segment per condition; glows once when all are done.
  const checklistDone = p.launchChecks.total > 0 && p.launchChecks.done === p.launchChecks.total;
  const segs = [
    { ok: checklistDone, label: `Checklist ${p.launchChecks.done}/${p.launchChecks.total}`, doc: "launch" as DocKey, heading: "Product" },
    { ok: p.blockingIssuesOpen === 0 && !!p.auditDate, label: p.auditDate ? `${p.blockingIssuesOpen} blocking issue${p.blockingIssuesOpen === 1 ? "" : "s"}` : "Red-team audit not run", doc: "audit" as DocKey, heading: "Result" },
    { ok: p.signedOffDev, label: "Dev signed", doc: "launch" as DocKey, heading: "Sign-off" },
    { ok: p.signedOffMarketing, label: "Marketing signed", doc: "launch" as DocKey, heading: "Sign-off" },
  ];
  const allOk = segs.every((x) => x.ok);
  const glowKey = `ready:${p.name}`;
  const glow = allOk && !mem.glowed.has(glowKey);
  if (allOk) mem.glowed.add(glowKey);
  else mem.glowed.delete(glowKey);
  const readiness = h(
    "div",
    { class: ["nx-card", "nx-ready", allOk && "is-ready", glow && "nx-glow"] },
    h("div", { class: "nx-ready-head" }, h("span", { class: "nx-card-label" }, "Day-14 launch readiness"), h("strong", null, allOk ? "✓ Ready to launch" : `${segs.filter((x) => x.ok).length} of 4 done`)),
    h(
      "div",
      { class: "nx-segs" },
      segs.map((sg) => {
        const b = h("button", { class: ["nx-seg", "nx-pressable", sg.ok && "is-ok"], type: "button" }, h("span", { class: "nx-seg-bar" }), h("span", { class: "nx-seg-label" }, sg.ok ? `✓ ${sg.label}` : sg.label));
        b.addEventListener("click", () => ctx.openDoc(p, sg.doc, sg.heading));
        return b;
      }),
    ),
  );

  const mech = h(
    "div",
    { class: "nx-card" },
    h("span", { class: "nx-card-label" }, "Core mechanics (max 3)"),
    p.pitch ? h("p", { class: "nx-pitch" }, `“${p.pitch}”`) : null,
    p.mechanics.length
      ? h("ol", { class: "nx-mech" }, p.mechanics.map((m) => h("li", null, m)))
      : emptyNote("Not filled in yet.", openLink(ctx, p, "spec", "Open spec →", "Core mechanics")),
    h(
      "div",
      { class: "nx-milestones" },
      h("span", { class: "nx-muted" }, `Build plan ${p.milestones.done}/${p.milestones.total}`),
      h("div", { class: "nx-mini" }, h("div", { class: "nx-mini-fill", style: { transform: `scaleX(${p.milestones.total ? p.milestones.done / p.milestones.total : 0})` } })),
    ),
  );

  const changes = h(
    "div",
    { class: "nx-card" },
    h("span", { class: "nx-card-label" }, `Changelog · v${p.currentVersion} · ${p.lastChangelogDate ? "" : "no entries yet"}`, p.lastChangelogDate ? rel(p.lastChangelogDate, today) : null),
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
      : emptyNote("Every entry updates the Last dev timer and keeps the square out of Stale."),
  );

  const repo = p.repoUrl
    ? h("a", { class: "nx-link", href: p.repoUrl, target: "_blank", rel: "noopener" }, `${p.repoUrl.replace(/^https?:\/\//, "")} ↗`)
    : (() => {
        const b = h("button", { class: "nx-link", type: "button" }, "+ Link GitHub repo");
        b.addEventListener("click", () => connectSheet(ctx, p, "spec", "repo_url", "GitHub repo URL", "https://github.com/…"));
        return b;
      })();

  return [
    header,
    readiness,
    h("div", { class: "nx-two" }, mech, changes),
    h(
      "div",
      { class: "nx-footer-links" },
      h("span", null, "Repo: ", repo),
      openLink(ctx, p, "spec", "1 · Dev Spec →"),
      openLink(ctx, p, "launch", "4 · Launch Checklist →"),
      openLink(ctx, p, "changelog", "5 · Changelog →"),
      openLink(ctx, p, "audit", "6 · Red-Team Audit →"),
    ),
  ];
}

