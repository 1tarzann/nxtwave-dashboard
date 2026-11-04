// Level 1: every product as a color-coded square, the "Do this next" banner, archive and Idea Vault.

import { fmtMoney, nextActions } from "../data/status";
import { IdeaNote, ProductSnapshot, SPEND_CAP } from "../data/types";
import { Ctx } from "./app";
import { checkIcon, dayProgress, drawer, rel } from "./components";
import { h } from "./dom";
import { leave, reducedMotion, replayClass } from "./motion";
import { newSprintWizard } from "./sheets";

const ORDER: Record<string, number> = { kill: 0, gate: 1, stale: 2, unstarted: 3, healthy: 4, queued: 5, closed: 6 };

export function renderHome(ctx: Ctx): HTMLElement {
  const { data, mem } = ctx;
  const root = h("div", { class: "nx-home" });

  root.append(doNextBanner(ctx));

  if (data.thresholds.missing) {
    const open = h("button", { class: "nx-link", type: "button" }, "Open Launch Framework →");
    open.addEventListener("click", () => ctx.host.openPath(`${data.hqRoot}/00_Global_System/Launch_Framework.md`));
    root.append(
      h(
        "div",
        { class: "nx-note" },
        h("span", { "aria-hidden": "true" }, "ℹ"),
        h("span", null, `Kill numbers not set yet, so the dashboard uses $${data.thresholds.killSpendNoSales} with 0 sales and skips the click-rate check (Setup Checklist P2). `),
        open,
      ),
    );
  }

  const active = data.products.filter((p) => !["queued", "scaled", "killed"].includes(p.status.toLowerCase()));
  const queued = data.products.filter((p) => p.status.toLowerCase() === "queued");
  const closed = data.products.filter((p) => ["scaled", "killed"].includes(p.status.toLowerCase()));
  const byUrgency = (a: ProductSnapshot, b: ProductSnapshot) => ORDER[ctx.status(a).key] - ORDER[ctx.status(b).key];

  // New squares drop in (skipped on the very first render).
  const isNew = (p: ProductSnapshot) => mem.known !== null && !mem.known.has(p.name);

  root.append(h("h2", { class: "nx-group-title" }, active.length > 1 ? "Active sprints" : "Active sprint"));
  const activeGrid = h("div", { class: "nx-grid nx-grid-active" });
  if (active.length === 0) {
    activeGrid.append(h("div", { class: "nx-empty nx-empty-big" }, "No sprint running. Start a queued product or launch a new one below."));
  }
  active.sort(byUrgency).forEach((p) => activeGrid.append(square(ctx, p, true, isNew(p))));
  if (active.length > 1) {
    activeGrid.append(h("div", { class: "nx-note nx-note-warn" }, `⚠ ${active.length} sprints are active. The Launch Framework allows one at a time.`));
  }
  root.append(activeGrid);

  root.append(h("h2", { class: "nx-group-title" }, "Queued"));
  const queuedGrid = h("div", { class: "nx-grid" });
  queued.forEach((p) => queuedGrid.append(square(ctx, p, false, isNew(p))));
  queuedGrid.append(newSprintCard(ctx));
  root.append(queuedGrid);

  if (closed.length) {
    const closedGrid = h("div", { class: "nx-grid" });
    closed.forEach((p) => closedGrid.append(square(ctx, p, false, isNew(p))));
    root.append(h("h2", { class: "nx-group-title" }, "Decided, not archived yet"), closedGrid);
  }

  root.append(archiveDrawer(ctx), ideaVault(ctx));

  mem.known = new Set(data.products.map((p) => p.name));
  return root;
}

// ── Do this next ───────────────────────────────────────────────────────────

function doNextBanner(ctx: Ctx): HTMLElement {
  const { mem } = ctx;
  const list = nextActions(ctx.data);
  const top = list[0];
  const banner = h("div", { class: ["nx-next", top ? `nx-st-${top.status.key}-soft` : "is-clear"] });

  const item = (): HTMLElement => {
    if (!top) {
      const hasActive = ctx.data.products.some((p) => !["queued", "scaled", "killed"].includes(p.status.toLowerCase()));
      return h(
        "div",
        { class: "nx-next-item is-clear" },
        checkIcon("nx-check nx-check-draw"),
        h("span", { class: "nx-next-text" }, hasActive ? "All clear · nothing needs you right now" : "Nothing running · start a sprint when you're ready"),
      );
    }
    const more = list.length > 1 ? h("span", { class: "nx-next-more" }, `+${list.length - 1} more`) : null;
    return h(
      "div",
      { class: "nx-next-item" },
      h("span", { class: "nx-next-label" }, "▶ DO THIS NEXT"),
      h("span", { class: "nx-next-text" }, h("strong", null, top.product.displayName), ` · ${top.status.reason}`),
      top.status.action ? ctx.actionButton(top.product, top.status.action, "next") : null,
      more,
    );
  };

  const previous = mem.lastNext;
  const resolved = previous && previous.id !== top?.id && !list.some((x) => x.id === previous.id);
  mem.lastNext = top ? { id: top.id, text: `${top.product.displayName} · ${top.status.reason}` } : null;

  if (resolved && previous) {
    // Visible progress: the finished item checks off, slides out, and the next one slides in.
    const done = h("div", { class: "nx-next-item is-done" }, checkIcon("nx-check nx-check-draw"), h("span", { class: "nx-next-text" }, previous.text));
    banner.classList.add("is-clear");
    banner.append(done);
    window.setTimeout(async () => {
      await leave(done);
      banner.className = ["nx-next", top ? `nx-st-${top.status.key}-soft` : "is-clear"].join(" ");
      const next = item();
      banner.append(next);
      if (!reducedMotion()) next.animate([{ opacity: 0, transform: "translateX(-16px)" }, { opacity: 1, transform: "none" }], { duration: 220, easing: "cubic-bezier(.2,.8,.2,1)" });
    }, reducedMotion() ? 600 : 900);
  } else {
    banner.append(item());
  }
  return banner;
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
    el.append(dayProgress(st.day, st.totalDays, animate), h("div", { class: "nx-sq-meta" }, `Day ${st.day} / ${st.totalDays} · ${st.phase}`));
  }

  if (big) {
    el.append(
      h(
        "dl",
        { class: "nx-sq-facts" },
        h("div", null, h("dt", null, "Last post"), h("dd", { class: ctx.flashCls(`${p.name}:post`) }, (st.day ?? 0) < 15 && !p.lastSocialPostDate ? h("span", { class: "nx-rel is-never" }, "not live yet") : rel(p.lastSocialPostDate, today))),
        h("div", null, h("dt", null, "Last dev"), h("dd", null, rel(p.lastChangelogDate, today), p.lastChangelogDate ? ` · v${p.currentVersion}` : "")),
        h("div", null, h("dt", null, "Spent"), h("dd", null, `$${fmtMoney(t.spend)} of $${SPEND_CAP}`)),
        h("div", null, h("dt", null, "Revenue"), h("dd", null, `$${fmtMoney(t.revenue)}`)),
      ),
    );
  }

  const chips: HTMLElement[] = [];
  if (p.outOfSync) chips.push(h("span", { class: "nx-warn-chip", title: "The hub and the 6 sprint files disagree on sprint_status or cycle_start" }, "⚠ files out of sync"));
  if (st.info.length) chips.push(...st.info.map((i) => h("span", { class: "nx-info-chip" }, i)));
  if (p.warnings.length) chips.push(h("span", { class: "nx-warn-chip", title: p.warnings.join("\n") }, `⚠ ${p.warnings.length} note${p.warnings.length > 1 ? "s" : ""} unreadable`));
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
    h("span", { class: "nx-new-sub" }, "Creates the hub + 6 files from the templates"),
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
    label: h("span", null, "🗄 Archive ", h("span", { class: "nx-muted" }, `Scaled ${archive.scaled.length} · Killed ${archive.killed.length}`)),
    body: () =>
      h(
        "div",
        { class: "nx-archive" },
        h("div", null, h("h4", null, "Scaled winners"), archive.scaled.length ? h("ul", null, archive.scaled.map((n) => h("li", null, n.replace(/_/g, " ")))) : h("p", { class: "nx-muted" }, "None yet")),
        h("div", null, h("h4", null, "Killed MVPs"), archive.killed.length ? h("ul", null, archive.killed.map((n) => h("li", null, n.replace(/_/g, " ")))) : h("p", { class: "nx-muted" }, "None yet")),
      ),
  });
}

const STAGES: { key: IdeaNote["stage"]; label: string }[] = [
  { key: "brainstorm", label: "1 · Brainstorm" },
  { key: "drafts", label: "2 · Rough drafts" },
  { key: "accepted", label: "3 · Accepted" },
];

function ideaVault(ctx: Ctx): HTMLElement {
  const ideas = ctx.data.ideas;
  const n = (k: IdeaNote["stage"]) => ideas.filter((i) => i.stage === k).length;
  const id = "ideas";
  return drawer({
    id,
    open: ctx.mem.drawers.has(id),
    onToggle: (o) => (o ? ctx.mem.drawers.add(id) : ctx.mem.drawers.delete(id)),
    label: h("span", null, "💡 Idea Vault ", h("span", { class: "nx-muted" }, `Brainstorm ${n("brainstorm")} · Drafts ${n("drafts")} · Accepted ${n("accepted")} · no clock running`)),
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
                      const link = h("button", { class: "nx-link", type: "button" }, idea.title);
                      link.addEventListener("click", () => ctx.host.openPath(idea.path));
                      const promote =
                        stage.key === "accepted"
                          ? (() => {
                              const b = h("button", { class: "nx-btn nx-btn-quiet nx-pressable", type: "button", title: "Opens the New Sprint wizard with this idea filled in" }, "Promote →");
                              b.addEventListener("click", () => newSprintWizard(ctx, { name: idea.title, originIdea: { path: idea.path.replace(/^.*?05_Idea_Pipeline/, "05_Idea_Pipeline").replace(/\.md$/, ""), title: idea.title } }));
                              return b;
                            })()
                          : null;
                      return h("li", null, link, promote);
                    }),
                ),
          ),
        ),
        h("p", { class: "nx-muted nx-ideas-rule" }, "Only Accepted ideas (both partners agreed) can be promoted. Promoting never moves or deletes the idea note."),
      ),
  });
}
