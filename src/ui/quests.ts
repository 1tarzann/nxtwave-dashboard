// The quest log: a tracker docked to the right edge of the whole dashboard, like a game's quest log. Closed, it's a
// tab with the open-quest count; open, it lists every quest by product, then by who does it (For Dev / For Marketing /
// For Both). Each quest says why it matters, why Claude can't do it, and has one button that does it or opens the spot.
// The open/closed state lives in DashboardApp (it saves it per device); this file only fills the tab and the panel.

import { uniqueBusinessItems } from "../data/company";
import { companyQuests, forRole, OWNER_LABEL, Quest, QuestOwner, sprintQuests } from "../data/quests";
import { ProductSnapshot } from "../data/types";
import { Ctx, Tab } from "./app";
import { drawer } from "./components";
import { clear, h } from "./dom";
import { reducedMotion, replayClass } from "./motion";
import { handlesSheet } from "./sheets";

export type QuestFilter = "all" | "dev" | "marketing";

export interface QuestGroup {
  /** "product:<name>" or "company". */
  key: string;
  title: string;
  product?: ProductSnapshot;
  /** Every quest the filter shows. */
  quests: Quest[];
  /** Now and overdue, overdue first. */
  open: Quest[];
  upcoming: Quest[];
  done: Quest[];
  late: number;
  /** "x of y done" counts these (daily quests left out). */
  counted: number;
  doneCount: number;
  /** Shown when the filter leaves nothing in this group. */
  empty: string;
  /** Collapsed until someone opens it (Company, and products with nothing open). */
  startsOpen: boolean;
}

export interface QuestBoard {
  filter: QuestFilter;
  groups: QuestGroup[];
  open: number;
  late: number;
}

const OWNER_WORDS: Record<QuestOwner, string> = { dev: "For Dev", marketing: "For Marketing", both: "For Both" };

/** The product being looked at comes first, then the others in their usual order, then Company. */
export function questBoard(ctx: Ctx): QuestBoard {
  const filter = ctx.questFilter();
  const route = ctx.app.route;
  const current = route.level === "product" ? route.name : null;
  const products = [...ctx.data.products.filter((p) => p.name === current), ...ctx.data.products.filter((p) => p.name !== current)];
  const groups: QuestGroup[] = [];
  for (const p of products) {
    const all = sprintQuests(p, ctx.status(p), ctx.today);
    announceFinished(ctx, `product:${p.name}`, all);
    if (!all.length && p.name !== current) continue;
    const queued = p.status.toLowerCase() === "queued";
    groups.push(group(`product:${p.name}`, p.displayName, all, filter, p, queued ? "Quests appear when this product's sprint starts." : "No quests for this product right now."));
  }
  const company = companyQuests(ctx.data.setup, uniqueBusinessItems(ctx.data.businessModel, ctx.data.setup));
  announceFinished(ctx, "company", company);
  const g = group("company", "Company", company, filter, undefined, ctx.data.setup.length ? "Nothing here for this filter." : "Couldn't find SETUP_CHECKLIST.md in the HQ folder.");
  g.startsOpen = false;
  groups.push(g);
  return { filter, groups, open: groups.reduce((n, x) => n + x.open.length, 0), late: groups.reduce((n, x) => n + x.late, 0) };
}

function group(key: string, title: string, all: Quest[], filter: QuestFilter, product: ProductSnapshot | undefined, empty: string): QuestGroup {
  const quests = forRole(all, filter);
  const open = quests.filter((q) => q.state === "now" || q.state === "overdue").sort((a, b) => (a.state === "overdue" ? 0 : 1) - (b.state === "overdue" ? 0 : 1));
  const counted = quests.filter((q) => !q.daily);
  return {
    key,
    title,
    product,
    quests,
    open,
    upcoming: quests.filter((q) => q.state === "upcoming"),
    done: quests.filter((q) => q.state === "done"),
    late: open.filter((q) => q.state === "overdue").length,
    counted: counted.length,
    doneCount: counted.filter((q) => q.state === "done").length,
    empty: quests.length || !all.length ? empty : "Nothing here for this filter.",
    startsOpen: open.length > 0,
  };
}

/** A short, selector-safe key for one quest (company quest ids hold whole checklist lines). */
export function questKey(groupKey: string, questId: string): string {
  let n = 5381;
  const s = `${groupKey}\n${questId}`;
  for (let i = 0; i < s.length; i++) n = ((n * 33) ^ s.charCodeAt(i)) >>> 0;
  return `q${n.toString(36)}`;
}

/** A small celebration when a quest flips to done between renders (not on first load). */
function announceFinished(ctx: Ctx, groupKey: string, quests: Quest[]): void {
  for (const q of quests) {
    if (q.daily) continue;
    const id = `${groupKey}:${q.id}`;
    const prev = ctx.mem.questDone.get(id);
    const now = q.state === "done";
    if (prev === false && now) ctx.app.toast(`Quest done: ${q.title}`);
    ctx.mem.questDone.set(id, now);
  }
}

// ── The tab (closed) ───────────────────────────────────────────────────────

export function fillQuestTab(ctx: Ctx, tab: HTMLElement, board: QuestBoard): void {
  clear(tab);
  const n = board.open;
  const count = h("span", { class: ["nx-qtab-count", n === 0 && "is-zero"] }, n ? String(n) : "✓");
  tab.append(h("span", { class: "nx-qtab-icon", "aria-hidden": "true" }, "🗒"), h("span", { class: "nx-qtab-label" }, "Quests"), count);
  if (board.late) tab.append(h("span", { class: "nx-qtab-late" }, `⚠ ${board.late}`));
  tab.setAttribute("aria-label", `Quest log: ${n ? `${n} open` : "nothing open"}${board.late ? `, ${board.late} overdue` : ""}`);
  tab.setAttribute("title", "Quest log (Q)");
  // Visible progress: the count pops when it changes.
  const prev = ctx.mem.questCount;
  ctx.mem.questCount = n;
  if (prev !== null && prev !== n) ctx.after(() => replayClass(count, "nx-bump", 500));
}

// ── The panel (open) ───────────────────────────────────────────────────────

export function fillQuestPanel(ctx: Ctx, panel: HTMLElement, board: QuestBoard, titleId: string): void {
  const before = panel.querySelector<HTMLElement>(".nx-qpanel-body");
  const scrollTop = before?.scrollTop ?? 0;
  clear(panel);

  const close = h("button", { class: "nx-qpanel-close nx-pressable", type: "button", "aria-label": "Close quest log", title: "Close (Q or Esc)", "data-fb": "quests:close" }, "✕");
  close.addEventListener("click", () => ctx.app.setQuestsOpen(false, { save: true }));
  const head = h(
    "header",
    { class: "nx-qpanel-head" },
    h("span", { class: "nx-qpanel-grab", "aria-hidden": "true" }),
    h(
      "div",
      { class: "nx-qpanel-row" },
      h("h2", { class: "nx-qpanel-title", id: titleId, tabindex: "-1" }, "🗒 Quests"),
      h(
        "span",
        { class: "nx-qpanel-sum" },
        board.open ? `${board.open} open` : "Nothing open",
        board.late ? h("strong", { class: "nx-qpanel-late" }, ` · ${board.late} overdue`) : null,
      ),
      close,
    ),
    filterChips(ctx, board.filter),
  );

  const body = h("div", { class: "nx-qpanel-body" });
  const order = ownerOrder(ctx);
  for (const g of board.groups) body.append(groupEl(ctx, g, order));
  body.append(h("p", { class: "nx-qpanel-foot" }, "Quests are jobs only a person can do. Each one checks itself off when the work shows up in your notes."));
  panel.append(head, body);
  body.scrollTop = scrollTop;
}

/** The person's own quests first: Settings → Who uses this device. */
function ownerOrder(ctx: Ctx): QuestOwner[] {
  return ctx.host.prefs.role === "marketing" ? ["marketing", "dev", "both"] : ["dev", "marketing", "both"];
}

function filterChips(ctx: Ctx, current: QuestFilter): HTMLElement {
  const row = h("div", { class: "nx-filter nx-qfilter", role: "group", "aria-label": "Show quests for" });
  const opts: [QuestFilter, string][] = [
    ["all", "All"],
    ["dev", "For Dev"],
    ["marketing", "For Marketing"],
  ];
  for (const [value, label] of opts) {
    const b = h("button", { class: ["nx-filter-chip", "nx-pressable", value === current && "is-on"], type: "button", "aria-pressed": String(value === current), "data-fb": `quests:filter:${value}` }, label);
    b.addEventListener("click", () => {
      ctx.setQuestFilter(value);
      ctx.app.render();
    });
    row.append(b);
  }
  return row;
}

function groupEl(ctx: Ctx, g: QuestGroup, order: QuestOwner[]): HTMLElement {
  const expanded = ctx.mem.questGroups.get(g.key) ?? g.startsOpen;
  const wrap = h("section", { class: ["nx-qgroup", expanded && "is-open"], "data-qgroup": g.key });
  const meta = g.open.length ? `${g.open.length} open` : g.counted && g.doneCount === g.counted ? "✓ All done" : "Nothing open";
  const toggle = h(
    "button",
    { class: "nx-qgroup-toggle", type: "button", "aria-expanded": String(expanded), "data-fb": `quests:group:${g.key}` },
    h("span", { class: "nx-chevron", "aria-hidden": "true" }, "›"),
    h("span", { class: "nx-qgroup-name" }, g.product ? "📦 " : "🏢 ", g.title),
    h("span", { class: "nx-qgroup-meta" }, meta, g.late ? h("strong", { class: "nx-qgroup-late" }, ` · ⚠ ${g.late} overdue`) : null),
  );
  const inner = h("div", { class: "nx-qgroup-inner" });
  const body = h("div", { class: "nx-qgroup-body", inert: !expanded }, inner);
  toggle.addEventListener("click", () => {
    const open = !wrap.classList.contains("is-open");
    wrap.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    if (open) body.removeAttribute("inert");
    else body.setAttribute("inert", "");
    ctx.mem.questGroups.set(g.key, open);
  });

  if (g.counted) {
    const pct = g.doneCount / g.counted;
    inner.append(
      h(
        "div",
        { class: "nx-qgroup-prog" },
        h("span", { class: "nx-mini" }, h("span", { class: "nx-mini-fill", style: { transform: `scaleX(${pct})` } })),
        h("span", { class: "nx-muted" }, `${g.doneCount} of ${g.counted} done`),
      ),
    );
  }

  if (!g.quests.length) {
    inner.append(h("p", { class: "nx-qempty" }, g.empty));
  } else {
    if (!g.open.length) inner.append(h("p", { class: "nx-qempty" }, g.upcoming.length ? "Nothing due right now. The next ones are under “Coming up”." : "All done here. Nice."));
    for (const owner of order) {
      const qs = g.open.filter((q) => q.owner === owner);
      if (!qs.length) continue;
      inner.append(
        h("h3", { class: ["nx-qowner", `own-${owner}`] }, OWNER_WORDS[owner], h("span", { class: "nx-qowner-n" }, String(qs.length))),
        h("div", { class: "nx-qlist" }, qs.map((q) => questCard(ctx, q, g))),
      );
    }
    for (const [kind, label, list] of [
      ["up", "Coming up", g.upcoming],
      ["done", "Done", g.done],
    ] as const) {
      if (!list.length) continue;
      const id = `quests-${kind}:${g.key}`;
      inner.append(
        drawer({
          id,
          open: ctx.mem.drawers.has(id),
          onToggle: (o) => (o ? ctx.mem.drawers.add(id) : ctx.mem.drawers.delete(id)),
          label: h("span", null, `${label} (${list.length})`),
          body: () => h("div", { class: "nx-qlist" }, list.map((q) => questCard(ctx, q, g, true))),
        }),
      );
    }
  }
  wrap.append(toggle, body);
  return wrap;
}

/** One quest. The title opens the details (why, why only a person, where); the buttons do the work. */
function questCard(ctx: Ctx, q: Quest, g: QuestGroup, showOwner = false): HTMLElement {
  const key = questKey(g.key, q.id);
  const detailsKey = `qd:${key}`;
  const card = h("article", { class: ["nx-quest", "nx-qcard", `is-${q.state}`, `own-${q.owner}`], "data-quest": key });
  const finished = q.state === "done";
  const hasDetails = !finished && !!(q.why || q.humanOnly || q.where);
  const expanded = hasDetails && ctx.mem.drawers.has(detailsKey);
  const name = h("span", { class: "nx-qcard-name" }, finished ? h("span", { class: "nx-quest-check", "aria-hidden": "true" }, "✓ ") : null, q.title);
  const title = hasDetails
    ? h("button", { class: "nx-qcard-title", type: "button", "aria-expanded": String(expanded), "data-fb": `quests:card:${key}`, title: "Why it matters, and where it's done" }, h("span", { class: "nx-chevron", "aria-hidden": "true" }, "›"), name)
    : h("h4", { class: "nx-qcard-title is-static" }, name);
  card.append(title);

  const meta = h(
    "div",
    { class: "nx-qcard-meta" },
    showOwner ? h("span", { class: ["nx-owner", `own-${q.owner}`] }, OWNER_LABEL[q.owner]) : null,
    q.daily ? h("span", { class: "nx-daily" }, "DAILY") : null,
    q.when ? h("span", { class: ["nx-quest-when", q.state === "overdue" && "is-late"] }, finished ? "✓ Done" : q.when) : null,
  );
  if (meta.childNodes.length) card.append(meta);

  if (hasDetails) {
    const details = h(
      "div",
      { class: "nx-qcard-details", hidden: !expanded },
      q.why ? h("p", { class: "nx-quest-why" }, q.why) : null,
      h(
        "p",
        { class: "nx-quest-meta" },
        q.humanOnly ? h("span", null, h("span", { "aria-hidden": "true" }, "🙋 "), h("strong", null, "Only a person: "), q.humanOnly) : null,
        q.where ? h("span", null, h("span", { "aria-hidden": "true" }, "📍 "), q.where) : null,
      ),
    );
    title.addEventListener("click", () => {
      const open = details.hidden;
      details.hidden = !open;
      title.setAttribute("aria-expanded", String(open));
      card.classList.toggle("is-expanded", open);
      if (open) ctx.mem.drawers.add(detailsKey);
      else ctx.mem.drawers.delete(detailsKey);
    });
    card.classList.toggle("is-expanded", expanded);
    card.append(details);
  }

  if (!finished && q.progress) {
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
  if (q.state === "now" || q.state === "overdue") {
    const buttons = questButtons(ctx, q, g.product);
    if (buttons.length) card.append(h("div", { class: "nx-quest-actions" }, ...buttons));
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
    case "copy":
      out.push(
        ctx.button({
          id,
          label: a.label,
          doneLabel: "Copied",
          title: a.text,
          onClick: async () => {
            await ctx.host.copy(a.text);
            ctx.app.toast(`Copied “${a.text}”`);
          },
        }),
      );
      break;
    case "section":
      if (p) {
        const { tab, id: section } = a;
        out.push(ctx.button({ id, label: a.label, variant: "ghost", onClick: () => showSection(ctx, p, tab, section) }));
      }
      break;
  }
  if (q.open && p) {
    const o = q.open;
    out.push(ctx.button({ id: `${id}:open`, label: `${o.label} →`, variant: "ghost", onClick: () => ctx.openDoc(p, o.doc, o.heading) }));
  }
  return out;
}

const TAB_IDS: Tab[] = ["overview", "marketing", "dev"];

/**
 * Switches the product view to `tab` if it isn't showing, then scrolls #nx-sec-<id> into view when that section
 * exists and moves keyboard focus to it (like the counters), so the next Tab carries on from there. On a narrow
 * screen the quest log covers the page, so it closes first (and this device remembers it closed, as it was left).
 */
function showSection(ctx: Ctx, p: ProductSnapshot, tab: string, id: string): void {
  if (ctx.app.questsCoverPage()) ctx.app.setQuestsOpen(false, { save: true });
  const route = ctx.app.route;
  const showing = route.level === "product" && route.name === p.name && route.tab === tab;
  const target = TAB_IDS.find((t) => t === tab);
  if (!showing && target) ctx.go({ level: "product", name: p.name, tab: target });
  const el = ctx.app.root.querySelector<HTMLElement>(`#${CSS.escape(`nx-sec-${id}`)}`);
  if (!el) return;
  el.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
  if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
  el.focus({ preventScroll: true });
}

/**
 * Opens the quest log at one quest (from “Do this next”): its group and details open, it scrolls into view, takes
 * focus and flashes once. Like every open and close, this device remembers it open.
 */
export function revealQuest(ctx: Ctx, groupKey: string, questId: string): void {
  const key = questKey(groupKey, questId);
  ctx.mem.questGroups.set(groupKey, true);
  ctx.mem.drawers.add(`qd:${key}`);
  ctx.app.setQuestsOpen(true, { save: true });
  ctx.app.render();
  const card = ctx.app.root.querySelector<HTMLElement>(`[data-quest="${key}"]`);
  if (!card) return;
  card.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "nearest" });
  card.querySelector<HTMLElement>(".nx-qcard-title")?.focus({ preventScroll: true });
  replayClass(card, "nx-flash", 1300);
}
