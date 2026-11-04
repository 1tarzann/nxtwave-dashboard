// Level 1 (All Products): the "Do this next" banner, every product as a color-coded square,
// company quests, the archive and the Idea Vault.

import { uniqueBusinessItems } from "../data/company";
import { companyQuests, forRole, Quest, sprintQuests } from "../data/quests";
import { fmtMoney, nextActions } from "../data/status";
import { IdeaNote, ProductSnapshot, SPEND_CAP } from "../data/types";
import { Ctx } from "./app";
import { checkIcon, dayProgress, drawer, rel, sectionHead } from "./components";
import { h } from "./dom";
import { legendRow, openHelp } from "./help";
import { leave, reducedMotion, replayClass } from "./motion";
import { questLog } from "./quests";
import { newSprintWizard } from "./sheets";

const ORDER: Record<string, number> = { kill: 0, gate: 1, stale: 2, unstarted: 3, healthy: 4, queued: 5, closed: 6 };
const isActive = (p: ProductSnapshot) => !["queued", "scaled", "killed"].includes(p.status.toLowerCase());

export function renderHome(ctx: Ctx): HTMLElement {
  const { data, mem } = ctx;
  const root = h("div", { class: "nx-home" });

  if (!ctx.host.prefs.guideSeen) root.append(guideCard(ctx));
  root.append(doNextBanner(ctx));

  if (data.thresholds.missing) {
    const open = h("button", { class: "nx-link", type: "button" }, "Open Launch Framework →");
    open.addEventListener("click", () => ctx.host.openPath(`${data.hqRoot}/00_Global_System/Launch_Framework.md`));
    root.append(
      h(
        "div",
        { class: "nx-note" },
        h("span", { "aria-hidden": "true" }, "ℹ"),
        h("span", null, `The Kill rule uses “$${data.thresholds.killSpendNoSales} spent with 0 sales” until you both set your own numbers in the Launch Framework (Setup Checklist P2).`),
        open,
      ),
    );
  }

  const active = data.products.filter(isActive);
  const queued = data.products.filter((p) => p.status.toLowerCase() === "queued");
  const closed = data.products.filter((p) => ["scaled", "killed"].includes(p.status.toLowerCase()));
  const byUrgency = (a: ProductSnapshot, b: ProductSnapshot) => ORDER[ctx.status(a).key] - ORDER[ctx.status(b).key];
  const isNew = (p: ProductSnapshot) => mem.known !== null && !mem.known.has(p.name);

  const products = h("section", { class: "nx-section" }, sectionHead(ctx, "products"), legendRow());
  products.append(h("h2", { class: "nx-group-title" }, active.length > 1 ? "Running now" : "Running now (one sprint at a time)"));
  const activeGrid = h("div", { class: "nx-grid nx-grid-active" });
  if (active.length === 0) {
    activeGrid.append(h("div", { class: "nx-empty nx-empty-big" }, "No sprint running. Start one from “Waiting in line”, or launch a new one."));
  }
  active.sort(byUrgency).forEach((p) => activeGrid.append(square(ctx, p, true, isNew(p))));
  if (active.length > 1) {
    activeGrid.append(h("div", { class: "nx-note nx-note-warn" }, `⚠ ${active.length} sprints are running. The Launch Framework allows one at a time.`));
  }
  products.append(activeGrid);

  products.append(h("h2", { class: "nx-group-title" }, "Waiting in line"));
  const queuedGrid = h("div", { class: "nx-grid" });
  queued.forEach((p) => queuedGrid.append(square(ctx, p, false, isNew(p))));
  queuedGrid.append(newSprintCard(ctx));
  products.append(queuedGrid);

  if (closed.length) {
    const closedGrid = h("div", { class: "nx-grid" });
    closed.forEach((p) => closedGrid.append(square(ctx, p, false, isNew(p))));
    products.append(h("h2", { class: "nx-group-title" }, "Decided, not archived yet"), closedGrid);
  }
  root.append(products);

  const business = uniqueBusinessItems(data.businessModel, data.setup);
  root.append(
    questLog(ctx, {
      id: "company",
      field: "companyQuests",
      title: "Company quests",
      quests: companyQuests(data.setup, business),
      emptyText: data.setup.length ? "No company quests for this filter." : "Couldn't find SETUP_CHECKLIST.md in the HQ folder.",
      grouped: true,
    }),
  );

  root.append(archiveDrawer(ctx), ideaVault(ctx));

  mem.known = new Set(data.products.map((p) => p.name));
  return root;
}

// ── First-run guide ────────────────────────────────────────────────────────

function guideCard(ctx: Ctx): HTMLElement {
  const card = h(
    "div",
    { class: "nx-guide" },
    h("h3", null, "How to read this page"),
    h(
      "ol",
      null,
      h("li", null, h("strong", null, "Squares are products. "), "The color says how it's doing; the line under it says why."),
      h("li", null, h("strong", null, "“Do this next” "), "is the single most urgent thing. Start there."),
      h("li", null, h("strong", null, "Quests "), "are jobs only a person can do. Each one says who (Dev or Marketing), why, and where."),
      h("li", null, h("strong", null, "ⓘ "), "next to any section explains it. ", h("strong", null, "? Help"), " (top right) has the color key and every word."),
    ),
  );
  const got = h("button", { class: "nx-btn nx-btn-primary nx-pressable", type: "button" }, "Got it");
  got.addEventListener("click", async () => {
    await ctx.host.savePrefs({ guideSeen: true });
    await leave(card);
  });
  const help = h("button", { class: "nx-btn nx-btn-ghost nx-pressable", type: "button" }, "Open Help");
  help.addEventListener("click", () => openHelp(ctx));
  card.append(h("div", { class: "nx-sheet-actions" }, got, help));
  return card;
}

// ── Do this next ───────────────────────────────────────────────────────────

/** The most urgent status fix; if every square is fine, the most urgent quest for whoever is looking. */
function doNextBanner(ctx: Ctx): HTMLElement {
  const { mem } = ctx;
  const list = nextActions(ctx.data);
  const topStatus = list[0];
  let topQuest: { q: Quest; p: ProductSnapshot } | null = null;
  if (!topStatus) {
    const filter = ctx.questFilter();
    for (const p of ctx.data.products.filter(isActive)) {
      const qs = forRole(sprintQuests(p, ctx.status(p), ctx.today), filter);
      const pick = qs.find((q) => q.state === "overdue") ?? qs.find((q) => q.state === "now" && (q.daily || q.when.startsWith("Due today")));
      if (pick) {
        topQuest = { q: pick, p };
        break;
      }
    }
  }
  const id = topStatus ? topStatus.id : topQuest ? `quest:${topQuest.p.name}:${topQuest.q.id}` : null;
  const text = topStatus ? `${topStatus.product.displayName} · ${topStatus.status.reason}` : topQuest ? `${topQuest.p.displayName} · ${topQuest.q.title}` : "";
  const tone = topStatus ? `nx-st-${topStatus.status.key}-soft` : topQuest ? (topQuest.q.state === "overdue" ? "nx-st-stale-soft" : "nx-st-unstarted-soft") : "is-clear";
  const banner = h("div", { class: ["nx-next", tone] });
  const head = sectionHead(ctx, "doNext", "▶ Do this next");

  const item = (): HTMLElement => {
    if (topStatus) {
      const more = list.length > 1 ? h("span", { class: "nx-next-more" }, `+${list.length - 1} more`) : null;
      return h(
        "div",
        { class: "nx-next-item" },
        h("span", { class: "nx-next-text" }, h("strong", null, topStatus.product.displayName), ` · ${topStatus.status.reason}`),
        topStatus.status.action ? ctx.actionButton(topStatus.product, topStatus.status.action, "next") : null,
        more,
      );
    }
    if (topQuest) {
      const { q, p } = topQuest;
      const go = h("button", { class: "nx-btn nx-btn-primary nx-pressable", type: "button" }, "Open quest →");
      go.addEventListener("click", () => ctx.go({ level: "product", name: p.name, tab: "overview" }));
      return h(
        "div",
        { class: "nx-next-item" },
        h("span", { class: ["nx-owner", `own-${q.owner}`] }, q.owner === "dev" ? "FOR DEV" : q.owner === "marketing" ? "FOR MARKETING" : "FOR BOTH"),
        h("span", { class: "nx-next-text" }, h("strong", null, p.displayName), ` · ${q.title} · `, h("span", { class: "nx-muted" }, q.when)),
        go,
      );
    }
    const hasActive = ctx.data.products.some(isActive);
    return h(
      "div",
      { class: "nx-next-item is-clear" },
      checkIcon("nx-check nx-check-draw"),
      h("span", { class: "nx-next-text" }, hasActive ? "All clear · nothing needs you right now" : "Nothing running · start a sprint when you're ready"),
    );
  };

  const previous = mem.lastNext;
  const stillThere = id !== null && previous?.id === id;
  const resolved = previous && !stillThere && previous.id !== id;
  mem.lastNext = id ? { id, text } : null;

  if (resolved && previous) {
    // Visible progress: the finished item checks off, slides out, and the next one slides in.
    const done = h("div", { class: "nx-next-item is-done" }, checkIcon("nx-check nx-check-draw"), h("span", { class: "nx-next-text" }, previous.text));
    banner.classList.add("is-clear");
    banner.append(done);
    window.setTimeout(async () => {
      await leave(done);
      banner.className = ["nx-next", tone].join(" ");
      const next = item();
      banner.append(next);
      if (!reducedMotion()) next.animate([{ opacity: 0, transform: "translateX(-16px)" }, { opacity: 1, transform: "none" }], { duration: 220, easing: "cubic-bezier(.2,.8,.2,1)" });
    }, reducedMotion() ? 600 : 900);
  } else {
    banner.append(item());
  }
  return h("div", { class: "nx-next-wrap" }, head, banner);
}

// ── Squares ────────────────────────────────────────────────────────────────

function square(ctx: Ctx, p: ProductSnapshot, big: boolean, isNew: boolean): HTMLElement {
  const { mem, today } = ctx;
  const st = ctx.status(p);
  const t = ctx.totals(p);

  // Live status change: crossfade from the old color, pulse once, show "changed just now".
  const prev = mem.prevStatus.get(p.name);
  const changed = prev !== undefined && prev !== st.key;
  mem.prevStatus.set(p.name, st.key);
  if (changed) mem.changedAt.set(p.name, Date.now());
  const recentlyChanged = Date.now() - (mem.changedAt.get(p.name) ?? 0) < 10_000;

  const el = h("article", {
    class: ["nx-square", "nx-pressable", `nx-st-${changed ? prev : st.key}`, big && "is-big", isNew && "nx-drop-in"],
    "data-product": p.name,
    tabindex: "0",
    role: "button",
    title: "Open this product",
    "aria-label": `${p.displayName}: ${st.label}. ${st.reason}. Open product.`,
  });
  if (changed) {
    ctx.after(() =>
      requestAnimationFrame(() => {
        el.classList.remove(`nx-st-${prev}`);
        el.classList.add(`nx-st-${st.key}`);
        replayClass(el, "nx-pulse", 1000);
      }),
    );
  }

  const open = () => ctx.go({ level: "product", name: p.name, tab: "overview" }, el);
  el.addEventListener("click", open);
  el.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target === el) {
      e.preventDefault();
      open();
    }
  });

  el.append(
    h(
      "div",
      { class: "nx-sq-top" },
      h("span", { class: "nx-sq-name" }, p.displayName),
      p.category ? h("span", { class: "nx-sq-cat" }, p.category.title) : null,
    ),
    h(
      "div",
      { class: "nx-sq-status" },
      h("span", { class: "nx-sq-icon", "aria-hidden": "true" }, st.icon),
      h("span", { class: "nx-sq-label" }, st.label),
      recentlyChanged ? h("span", { class: "nx-changed" }, h("span", { class: "nx-changed-dot", "aria-hidden": "true" }), "changed just now") : null,
    ),
    h("p", { class: "nx-sq-reason" }, st.reason),
  );

  if (st.day !== null && st.day >= 1) {
    const key = `sq:${p.name}`;
    const animate = !mem.filled.has(key);
    mem.filled.add(key);
    el.append(dayProgress(st.day, st.totalDays, animate), h("div", { class: "nx-sq-meta" }, `Day ${st.day} of ${st.totalDays} · ${st.phase}`));
  }

  if (big) {
    const beforeLaunch = (st.day ?? 0) < 14;
    el.append(
      h(
        "dl",
        { class: "nx-sq-facts" },
        h("div", null, h("dt", null, "Last social post"), h("dd", { class: ctx.flashCls(`${p.name}:post`) }, beforeLaunch && !p.lastSocialPostDate ? h("span", { class: "nx-rel is-never" }, "goes live day 14") : rel(p.lastSocialPostDate, today))),
        h("div", null, h("dt", null, "Last progress log"), h("dd", null, rel(p.lastChangelogDate, today, "not yet"), p.lastChangelogDate ? ` · v${p.currentVersion}` : "")),
        h("div", null, h("dt", null, "Ad budget used"), h("dd", null, `$${fmtMoney(t.spend)} of $${SPEND_CAP}`)),
        h("div", null, h("dt", null, "Revenue"), h("dd", null, beforeLaunch && t.revenue === 0 ? h("span", { class: "nx-rel is-never" }, "starts at launch") : `$${fmtMoney(t.revenue)}`)),
      ),
    );
    const qs = forRole(sprintQuests(p, st, today), ctx.questFilter());
    const openQ = qs.filter((q) => q.state === "now" || q.state === "overdue");
    const late = openQ.filter((q) => q.state === "overdue").length;
    if (openQ.length) {
      el.append(h("div", { class: "nx-sq-quests" }, `🗒 ${openQ.length} quest${openQ.length > 1 ? "s" : ""} open`, late ? h("strong", null, ` · ${late} overdue`) : null));
    }
  }

  const chips: HTMLElement[] = [];
  if (p.outOfSync) chips.push(h("span", { class: "nx-warn-chip", title: "Open the hub note: it holds the official status and Day 1" }, "⚠ Hub note and the 6 notes disagree on status or Day 1"));
  if (st.info.length) chips.push(...st.info.map((i) => h("span", { class: "nx-info-chip" }, i)));
  if (p.warnings.length) chips.push(h("span", { class: "nx-warn-chip", title: p.warnings.join("\n") }, `⚠ ${p.warnings.length} note${p.warnings.length > 1 ? "s" : ""} couldn't be read`));
  if (chips.length) el.append(h("div", { class: "nx-sq-chips" }, chips));

  if (st.action && big) {
    el.append(h("div", { class: "nx-sq-action" }, ctx.actionButton(p, st.action, "sq")));
  }
  return el;
}

function newSprintCard(ctx: Ctx): HTMLElement {
  const el = h(
    "button",
    { class: ["nx-square", "nx-new", "nx-pressable"], type: "button", "aria-label": "Launch new sprint" },
    h("span", { class: "nx-new-plus", "aria-hidden": "true" }, "+"),
    h("span", { class: "nx-new-label" }, "Launch New Sprint"),
    h("span", { class: "nx-new-sub" }, "Creates a product folder with a hub note and the 6 standard notes"),
  );
  el.addEventListener("click", () => newSprintWizard(ctx));
  return el;
}

// ── Archive + Idea Vault ───────────────────────────────────────────────────

function archiveDrawer(ctx: Ctx): HTMLElement {
  const { archive } = ctx.data;
  const id = "archive";
  return drawer({
    id,
    open: ctx.mem.drawers.has(id),
    onToggle: (o) => (o ? ctx.mem.drawers.add(id) : ctx.mem.drawers.delete(id)),
    label: h("span", null, "🗄 Archive ", h("span", { class: "nx-muted" }, `Finished sprints · scaled ${archive.scaled.length} · killed ${archive.killed.length}`)),
    body: () =>
      h(
        "div",
        { class: "nx-archive" },
        h("div", null, h("h4", null, "Scaled (kept going)"), archive.scaled.length ? h("ul", null, archive.scaled.map((n) => h("li", null, n.replace(/_/g, " ")))) : h("p", { class: "nx-muted" }, "None yet")),
        h("div", null, h("h4", null, "Killed (stopped)"), archive.killed.length ? h("ul", null, archive.killed.map((n) => h("li", null, n.replace(/_/g, " ")))) : h("p", { class: "nx-muted" }, "None yet")),
      ),
  });
}

const STAGES: { key: IdeaNote["stage"]; label: string }[] = [
  { key: "brainstorm", label: "1 · Brainstorm (raw ideas)" },
  { key: "drafts", label: "2 · Rough drafts (pitch + target user)" },
  { key: "accepted", label: "3 · Accepted (both agreed, next in line)" },
];

function ideaVault(ctx: Ctx): HTMLElement {
  const ideas = ctx.data.ideas;
  const n = (k: IdeaNote["stage"]) => ideas.filter((i) => i.stage === k).length;
  const id = "ideas";
  return drawer({
    id,
    open: ctx.mem.drawers.has(id),
    onToggle: (o) => (o ? ctx.mem.drawers.add(id) : ctx.mem.drawers.delete(id)),
    label: h("span", null, "💡 Idea Vault ", h("span", { class: "nx-muted" }, `Ideas waiting their turn, no clock running · ${n("brainstorm")} raw · ${n("drafts")} drafts · ${n("accepted")} accepted`)),
    body: () =>
      h(
        "div",
        { class: "nx-ideas" },
        STAGES.map((stage) =>
          h(
            "div",
            { class: "nx-idea-col" },
            h("h4", null, stage.label),
            ideas.filter((i) => i.stage === stage.key).length === 0
              ? h("p", { class: "nx-muted" }, "Empty")
              : h(
                  "ul",
                  null,
                  ideas
                    .filter((i) => i.stage === stage.key)
                    .map((idea) => {
                      const link = h("button", { class: "nx-link", type: "button", title: "Open the idea note" }, idea.title);
                      link.addEventListener("click", () => ctx.host.openPath(idea.path));
                      const promote =
                        stage.key === "accepted"
                          ? (() => {
                              const b = h("button", { class: "nx-btn nx-btn-quiet nx-pressable", type: "button", title: "Opens the New Sprint form with this idea filled in" }, "Turn into a sprint →");
                              b.addEventListener("click", () => newSprintWizard(ctx, { name: idea.title, originIdea: { path: idea.path.replace(/^.*?05_Idea_Pipeline/, "05_Idea_Pipeline").replace(/\.md$/, ""), title: idea.title } }));
                              return b;
                            })()
                          : null;
                      return h("li", null, link, promote);
                    }),
                ),
          ),
        ),
        h("p", { class: "nx-muted nx-ideas-rule" }, "Only Accepted ideas can become a sprint. The idea note is never moved or deleted."),
      ),
  });
}
