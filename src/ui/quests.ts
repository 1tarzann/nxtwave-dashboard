// The quest log: what's left for a person to do, with FOR DEV / FOR MARKETING tags,
// why it matters, why Claude can't do it, and one button that does it or opens the exact spot.

import { FieldId } from "../data/fields";
import { forRole, OWNER_LABEL, Quest } from "../data/quests";
import { ProductSnapshot } from "../data/types";
import { Ctx } from "./app";
import { drawer, emptyNote, sectionHead } from "./components";
import { h } from "./dom";
import { handlesSheet } from "./sheets";

export type QuestFilter = "all" | "dev" | "marketing";

const MAX_VISIBLE = 5;

export function questLog(
  ctx: Ctx,
  opts: { id: string; field: FieldId; title?: string; quests: Quest[]; product?: ProductSnapshot; lockedFilter?: QuestFilter; emptyText: string; grouped?: boolean; max?: number },
): HTMLElement {
  const filter = opts.lockedFilter ?? ctx.questFilter();
  const shown = forRole(opts.quests, filter);
  const open = shown.filter((q) => q.state === "now" || q.state === "overdue").sort((a, b) => (a.state === "overdue" ? 0 : 1) - (b.state === "overdue" ? 0 : 1));
  const upcoming = shown.filter((q) => q.state === "upcoming");
  const done = shown.filter((q) => q.state === "done");
  const counted = shown.filter((q) => !q.daily);
  const doneCount = counted.filter((q) => q.state === "done").length;

  announceFinished(ctx, opts.quests);

  const wrap = h("section", { class: "nx-section nx-quests" });
  const pct = counted.length ? doneCount / counted.length : 0;
  wrap.append(
    sectionHead(
      ctx,
      opts.field,
      opts.title,
      h(
        "span",
        { class: "nx-quest-progress" },
        h("span", { class: "nx-muted" }, `${doneCount} of ${counted.length} done`),
        h("span", { class: "nx-mini nx-quest-bar" }, h("span", { class: "nx-mini-fill", style: { transform: `scaleX(${pct})` } })),
      ),
    ),
  );

  if (!opts.lockedFilter) wrap.append(filterChips(ctx, filter));

  if (!shown.length) {
    wrap.append(emptyNote(opts.emptyText));
    return wrap;
  }

  const list = h("div", { class: "nx-quest-list" });
  const showAllKey = `quests-all:${opts.id}`;
  const showAll = ctx.mem.drawers.has(showAllKey);
  const max = opts.max ?? MAX_VISIBLE;
  const visible = showAll ? open : open.slice(0, max);
  let lastGroup = "";
  for (const q of visible) {
    if (opts.grouped && q.group !== lastGroup) {
      list.append(h("h4", { class: "nx-quest-group" }, q.group));
      lastGroup = q.group;
    }
    list.append(questCard(ctx, q, opts.product));
  }
  if (!open.length) {
    list.append(h("div", { class: "nx-empty" }, upcoming.length ? "Nothing due right now. The next quests are under “Coming up”." : "All done here. Nice."));
  }
  wrap.append(list);

  if (open.length > max) {
    const more = h("button", { class: "nx-link nx-show-all", type: "button" }, showAll ? "Show fewer" : `Show all ${open.length} open quests`);
    more.addEventListener("click", () => {
      if (showAll) ctx.mem.drawers.delete(showAllKey);
      else ctx.mem.drawers.add(showAllKey);
      ctx.app.render();
    });
    wrap.append(more);
  }

  if (upcoming.length) {
    const id = `quests-up:${opts.id}`;
    wrap.append(
      drawer({
        id,
        open: ctx.mem.drawers.has(id),
        onToggle: (o) => (o ? ctx.mem.drawers.add(id) : ctx.mem.drawers.delete(id)),
        label: h("span", null, `Coming up (${upcoming.length})`),
        body: () => h("div", { class: "nx-quest-list" }, upcoming.map((q) => questCard(ctx, q, opts.product))),
      }),
    );
  }
  if (done.length) {
    const id = `quests-done:${opts.id}`;
    wrap.append(
      drawer({
        id,
        open: ctx.mem.drawers.has(id),
        onToggle: (o) => (o ? ctx.mem.drawers.add(id) : ctx.mem.drawers.delete(id)),
        label: h("span", null, `Done (${done.length})`),
        body: () => h("div", { class: "nx-quest-list" }, done.map((q) => questCard(ctx, q, opts.product))),
      }),
    );
  }
  return wrap;
}

function filterChips(ctx: Ctx, current: QuestFilter): HTMLElement {
  const row = h("div", { class: "nx-filter", role: "group", "aria-label": "Show quests for" });
  const opts: [QuestFilter, string][] = [
    ["all", "All"],
    ["dev", "For Dev"],
    ["marketing", "For Marketing"],
  ];
  for (const [value, label] of opts) {
    const b = h("button", { class: ["nx-filter-chip", "nx-pressable", value === current && "is-on"], type: "button", "aria-pressed": String(value === current) }, label);
    b.addEventListener("click", () => {
      ctx.setQuestFilter(value);
      ctx.app.render();
    });
    row.append(b);
  }
  return row;
}

/** A small celebration when a quest flips to done between renders (not on first load). */
function announceFinished(ctx: Ctx, quests: Quest[]): void {
  for (const q of quests) {
    if (q.daily) continue;
    const prev = ctx.mem.questDone.get(q.id);
    const now = q.state === "done";
    if (prev === false && now) ctx.app.toast(`Quest done: ${q.title}`);
    ctx.mem.questDone.set(q.id, now);
  }
}

export function questCard(ctx: Ctx, q: Quest, p?: ProductSnapshot): HTMLElement {
  const card = h("article", { class: ["nx-quest", `is-${q.state}`, `own-${q.owner}`] });
  card.append(
    h(
      "div",
      { class: "nx-quest-top" },
      h("span", { class: ["nx-owner", `own-${q.owner}`] }, OWNER_LABEL[q.owner]),
      q.daily ? h("span", { class: "nx-daily" }, "DAILY") : null,
      q.when ? h("span", { class: ["nx-quest-when", q.state === "overdue" && "is-late"] }, q.state === "done" ? "✓ Done" : q.when) : null,
    ),
    h("h4", { class: "nx-quest-title" }, q.state === "done" ? h("span", { class: "nx-quest-check", "aria-hidden": "true" }, "✓ ") : null, q.title),
  );
  if (q.state !== "done") {
    card.append(
      ...(q.why ? [h("p", { class: "nx-quest-why" }, q.why)] : []),
      h(
        "p",
        { class: "nx-quest-meta" },
        h("span", null, h("span", { "aria-hidden": "true" }, "🙋 "), h("strong", null, "Only a person: "), q.humanOnly),
        h("span", null, h("span", { "aria-hidden": "true" }, "📍 "), q.where),
      ),
    );
    if (q.progress) {
      const pct = q.progress.total ? q.progress.done / q.progress.total : 0;
      card.append(
        h(
          "div",
          { class: "nx-quest-prog" },
          h("span", { class: "nx-mini" }, h("span", { class: "nx-mini-fill", style: { transform: `scaleX(${pct})` } })),
          h("span", { class: "nx-muted" }, `${q.progress.done} of ${q.progress.total}`),
        ),
      );
    }
    if (q.state !== "upcoming") card.append(h("div", { class: "nx-quest-actions" }, ...questButtons(ctx, q, p)));
  }
  return card;
}

function questButtons(ctx: Ctx, q: Quest, p?: ProductSnapshot): HTMLElement[] {
  const a = q.action;
  const id = `quest:${p?.name ?? "company"}:${q.id}`;
  const out: HTMLElement[] = [];
  switch (a.kind) {
    case "handles":
      if (p) out.push(ctx.button({ id, label: a.label, onClick: () => handlesSheet(ctx, p) }));
      break;
    case "postedToday":
      if (p)
        out.push(
          ctx.button({
            id,
            label: a.label,
            doneLabel: "Logged",
            onClick: async () => {
              const u = await ctx.host.postedToday(p);
              ctx.mem.flash.set(`${p.name}:post`, Date.now() + 1300);
              return u;
            },
          }),
        );
      break;
    case "tickLaunch":
      if (p && p.paths.launch) {
        const path = p.paths.launch;
        out.push(ctx.button({ id, label: a.label, doneLabel: "Ticked", onClick: () => ctx.host.tickLine(path, { textStart: a.itemStart }, true) }));
      }
      break;
    case "flag":
      if (p) out.push(ctx.button({ id, label: a.label, doneLabel: "Signed", onClick: () => ctx.host.setFlag(p, a.doc, a.key, true) }));
      break;
    case "openDoc":
      if (p) {
        const doc = a.doc;
        out.push(ctx.button({ id, label: `${a.label} →`, variant: "ghost", onClick: () => ctx.openDoc(p, doc, a.heading) }));
      }
      break;
    case "tickChecklist":
      out.push(ctx.button({ id, label: a.label, doneLabel: "Ticked", onClick: () => ctx.host.tickLine(a.item.path, { line: a.item.raw }, true) }));
      out.push(
        ctx.button({ id: `${id}:open`, label: a.item.path.includes("Business_Model") ? "Open Business Model →" : "Open Setup Checklist →", variant: "ghost", onClick: () => ctx.host.openPath(a.item.path) }),
      );
      break;
    case "openPath":
      out.push(ctx.button({ id, label: `${a.label} →`, variant: "ghost", onClick: () => ctx.host.openPath(a.path) }));
      break;
  }
  if (q.open && p) {
    const o = q.open;
    out.push(ctx.button({ id: `${id}:open`, label: `${o.label} →`, variant: "ghost", onClick: () => ctx.openDoc(p, o.doc, o.heading) }));
  }
  return out;
}
