// The Marketing side's Competitors and Hooks sections (0.5.0). The Marketer reads and fixes what competitor research
// wrote without opening the note: a research status line with Ask for research and Looks good, the competitor cards
// with the "How these 3 were picked" drawer, and the hooks grouped by rating with Edit and Use in a video.
// Every write is an op from data/marketingOps.ts sent through runEdit (U1). Edit sheets expect what the card showed
// (U2) and watch for partner changes while they're open (U6).

import { daysBetween, longDate, relativeDay } from "../data/dates";
import { isPlaceholder, stripExamples } from "../data/markdown";
import type { Table } from "../data/markdown";
import { RATING_LABEL } from "../data/marketing";
import type { Cell, CompetitorRow, HookRating, HookRow, MarketingNote } from "../data/marketing";
import { competitorOp, formValue, hookOp, hookWordsCheck, linkParts, requestBy, requestResearchOp, researchState, reviewedOp, sameRow, splitLink, useHookOp } from "../data/marketingOps";
import type { Check, CompetitorValues, HookSeen, HookValues, Seen } from "../data/marketingOps";
import type { ProductProfile } from "../data/profile";
import type { TableOp } from "../data/tableEdit";
import { DOC_FILES } from "../data/types";
import type { ProductSnapshot } from "../data/types";
import type { Ctx, Tab } from "./app";
import { drawer, emptyNote, sectionHead } from "./components";
import { Child, h } from "./dom";
import { cellText, editSheet, plainError, runEdit, sheetWrite, writtenNumber } from "./inline";
import type { FieldSpec } from "./inline";
import type { Undo } from "./host";
import { reducedMotion } from "./motion";

// ---------------------------------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------------------------------

const WHO_ASKED: Record<string, string> = { marketing: "The Marketer", dev: "The Developer", both: "Both partners" };

/** The Rating select: each rating as its word with its icon (never the icon alone), plus Not rated. */
const RATING_OPTIONS: { value: string; label: string }[] = [
  { value: "recommended", label: RATING_LABEL.recommended },
  { value: "medium", label: RATING_LABEL.medium },
  { value: "avoid", label: RATING_LABEL.avoid },
  { value: "", label: "Not rated" },
];

/** Placeholder for a link box: the templates have no example for a bare link. */
const LINK_EXAMPLE = "https://…";
const LINK_WARN = "This doesn't look like a whole link. Copy it from the browser's address bar.";

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** "a" · "a and b" · "a, b and c". */
function andList(items: string[]): string {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** "Nov 20", or "Jan 2, 2027" when it isn't this year. */
function shortDate(iso: string, today: string): string {
  const date = longDate(iso).replace(/^\S+ /, "");
  return iso.slice(0, 4) === today.slice(0, 4) ? date.replace(/, \d{4}$/, "") : date;
}

/** "today", "yesterday", "3 days ago". A date after today (the other Mac's clock) reads as today. */
function ago(iso: string, today: string): string {
  return daysBetween(iso, today) <= 0 ? "today" : relativeDay(iso, today);
}

/** Research writes its reasons in lower case ("competitor 3 (checked 41, …)"); a card shows them as a sentence. */
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "Hook 3": its # in the note, else its place in the list. */
const hookNumber = (r: HookRow) => r.num || String(r.index + 1);

// ---------------------------------------------------------------------------------------------------
// Pure helpers (tested)
// ---------------------------------------------------------------------------------------------------

/**
 * Why these sections can't be changed (U8): a queued product isn't in a sprint yet, a scaled or killed one is
 * decided. Null when they can be changed.
 */
export function readOnlyLine(status: string): string | null {
  const s = status.trim().toLowerCase();
  if (s === "queued") return "Queued: not in a sprint yet, so nothing here can be changed.";
  if (s === "scaled" || s === "killed") return `Archived: this sprint was decided (${s === "scaled" ? "Scale" : "Kill"}), so nothing here can be changed.`;
  return null;
}

/** The one line above the competitor cards, and whether it offers Fill in (the Dev Spec profile is incomplete). */
export interface ResearchLine {
  text: string;
  fillIn: boolean;
}

/**
 * The research status (agreed marker rules, through researchState): a pending request says who asked and when, or
 * what blocks it; otherwise the last research run; otherwise what blocks research, or "Not researched yet.".
 * `blockers: false` leaves the Dev Spec out, for a product that isn't in a sprint (research won't run for it anyway).
 */
export function researchLine(m: MarketingNote | null, profile: ProductProfile, today: string, opts: { blockers?: boolean } = {}): ResearchLine {
  const blocked: ResearchLine | null =
    profile.complete || opts.blockers === false
      ? null
      : { text: `Research can't start yet: the Dev Spec is missing ${andList(profile.missing.map((f) => f.field))}.`, fillIn: true };
  const request = m?.request ?? null;
  if (researchState(m).pending && request) {
    return blocked ?? { text: `${Object.prototype.hasOwnProperty.call(WHO_ASKED, request.by) ? WHO_ASKED[request.by] : "A partner"} asked for research ${ago(request.date, today)}. Waiting for the Developer to run /competitors.`, fillIn: false };
  }
  const r = m?.research ?? null;
  if (r) {
    const facts = [r.checked !== null ? `checked ${plural(r.checked, "product")}` : "", r.kept !== null ? `kept ${r.kept}` : ""].filter(Boolean).join(", ");
    // The number of search rounds the finished run took, worded so it never reads as still running.
    const rounds = r.rounds === null || r.rounds < 1 ? "" : ` in ${plural(r.rounds, "search round")}`;
    return { text: `Researched ${shortDate(r.date, today)}${rounds}${facts ? `: ${facts}` : ""}.`, fillIn: false };
  }
  return blocked ?? { text: "Not researched yet.", fillIn: false };
}

/**
 * The number "Use in a video" will give the new video, found the way the insert op picks its row: the first row with
 * nothing typed in any column, those the dashboard doesn't show included (its own #, or the next number when it has
 * none), else a new row after the highest #.
 */
export function nextVideoNumber(m: MarketingNote): string {
  const rows = m.backlog ?? [];
  const next = String(Math.max(0, ...rows.map((r) => r.num).filter((n) => /^\d+$/.test(n)).map(Number)) + 1);
  const free = rows.find((r) => !r.extra && [r.format.value, r.platformsCell.value, r.hookNum, r.statusCell.value, r.goLive.value].every(isPlaceholder));
  return free && !isPlaceholder(free.num) ? free.num : next;
}

/** The videos (their #) whose Hook # names this hook. */
export function videosUsing(m: MarketingNote, hook: HookRow): string[] {
  if (!/^\d+$/.test(hook.num)) return [];
  const n = Number(hook.num);
  return (m.backlog ?? []).filter((r) => (r.hookNum.match(/\d+/g) ?? []).map(Number).includes(n)).map((r) => r.num || String(r.index + 1));
}

/** "In video 2", "In videos 1 and 3". */
export function usedText(videos: string[]): string {
  return videos.length === 1 ? `In video ${videos[0]}` : `In videos ${andList(videos)}`;
}

const hookKey = (r: HookRow): string => r.num;
const hookCells = (r: HookRow): string[] => [r.num, r.ratingCell.value, r.hook.value, r.demo.value, r.cta.value, r.basedOn.value];
const competitorKey = (r: CompetitorRow): string => r.name.value;
const competitorCells = (r: CompetitorRow): string[] => [r.name.value, r.link.value, r.hook.value, r.why.value];

/**
 * The same hook in newer data (sameRow): by its # as the edit op finds it, wherever it moved; with a # two hooks
 * share, the same one of them. `before` is the list the row came from (default: just the row). Null when it's gone.
 */
export function findHook(m: MarketingNote | null | undefined, row: HookRow, before: readonly HookRow[] = [row]): HookRow | null {
  return sameRow(before, row, m?.hooks?.rows, hookKey, hookCells);
}

const COMPETITOR_KEYS = ["name", "storeUrl", "video", "videoUrl", "hook", "why"] as const;
const HOOK_KEYS = ["hook", "demo", "cta", "basedOn"] as const;

export type CompetitorForm = Record<keyof CompetitorValues, string>;

/** A competitor row the way its edit sheet shows it. A MISSING row's Name and Store page link start empty; the reason shows above them. */
export function competitorForm(r: CompetitorRow): CompetitorForm {
  const name = splitLink(r.name);
  const video = splitLink(r.link);
  const missing = r.missing !== null;
  return { name: missing ? "" : name.label, storeUrl: missing ? "" : name.url, video: video.label, videoUrl: video.url, hook: formValue(r.hook), why: formValue(r.why) };
}

/**
 * The op a competitor sheet saves: the fields the user changed, expecting what the sheet showed (U2). `nameBehind`
 * is the MISSING line an empty Name box stands for (as the sheet last read it): it becomes the name's expect, and is
 * never kept as the label of a link typed into an empty Name's row.
 */
export function competitorSave(
  row: CompetitorRow,
  values: Record<string, string>,
  changed: string[],
  seen: Record<string, string>,
  nameBehind: string = row.missing !== null ? splitLink(row.name).label : "",
): TableOp {
  const v: CompetitorValues = {};
  for (const k of COMPETITOR_KEYS) if (changed.includes(k)) v[k] = values[k] ?? "";
  const s: Seen<CompetitorValues> = {};
  for (const k of COMPETITOR_KEYS) if (seen[k] !== undefined) s[k] = seen[k];
  if (s.name === "" && (s.storeUrl ?? "") === "" && nameBehind !== "") {
    s.name = nameBehind;
    if (v.name === undefined && v.storeUrl !== undefined) v.name = values.name ?? "";
  }
  return competitorOp(row, v, s);
}

export type HookForm = Partial<Record<keyof HookValues, string>>;

/** A hook row the way its edit sheet shows it: the rating as its key (v2 only), a MISSING hook as an empty box. */
export function hookForm(r: HookRow): HookForm {
  const form: HookForm = { hook: r.missing !== null ? "" : formValue(r.hook), demo: formValue(r.demo), cta: formValue(r.cta), basedOn: formValue(r.basedOn) };
  if (r.ratingCell.col !== "") form.rating = r.rating;
  return form;
}

/**
 * The op a hook sheet saves: the fields the user changed, expecting what the sheet showed (U2). The Rating select
 * holds keys, so `ratingText` gives the Rating cell's text the sheet last read for each key ("Medium" and
 * "🟡 Medium" are both medium), and `hookBehind` is the MISSING line an empty Hook box stands for.
 */
export function hookSave(
  row: HookRow,
  values: Record<string, string>,
  changed: string[],
  seen: Record<string, string>,
  opts: { ratingText?: Map<string, string>; hookBehind?: string } = {},
): TableOp {
  const v: HookValues = {};
  if (changed.includes("rating") && values.rating !== undefined) v.rating = values.rating as HookRating;
  for (const k of HOOK_KEYS) if (changed.includes(k)) v[k] = values[k] ?? "";
  const s: HookSeen = {};
  for (const k of HOOK_KEYS) if (seen[k] !== undefined) s[k] = seen[k];
  const texts = opts.ratingText ?? new Map([[row.rating as string, row.ratingCell.value]]);
  if (seen.rating !== undefined) {
    // The cell's own words go in as they are: "recommended" or "" typed in the note is text, never a rating key.
    const text = texts.get(seen.rating);
    if (text !== undefined) s.ratingText = text;
    else s.rating = seen.rating;
  }
  const behind = opts.hookBehind ?? (row.missing !== null ? formValue(row.hook) : "");
  if (s.hook === "" && behind !== "") s.hook = behind;
  return hookOp(row, v, s);
}

// ---------------------------------------------------------------------------------------------------
// Small UI pieces
// ---------------------------------------------------------------------------------------------------

/** The product as the latest data has it (fresh note paths for a write), else as rendered. */
function latest(ctx: Ctx, p: ProductSnapshot): ProductSnapshot {
  return ctx.app.data?.products.find((x) => x.name === p.name) ?? p;
}

/** The Marketing Engine in the latest data, or null when the product or its note is gone. */
function latestMarketing(ctx: Ctx, p: ProductSnapshot): MarketingNote | null {
  return ctx.app.data?.products.find((x) => x.name === p.name)?.marketing ?? null;
}

/** Text with its links as safe new-tab links (http and https only). */
function richText(s: string): Child[] {
  return linkParts(s).map((part) => (part.url ? h("a", { class: "nx-link nx-cell-link", href: part.url, target: "_blank", rel: "noopener" }, part.text) : part.text));
}

/** A cell's text or its green example (U4); "—" when it has neither. */
function valueOf(c: Cell): Child {
  return cellText(c) ?? h("span", { class: "nx-muted" }, "—");
}

/** "Shows: …" on a card. Null when the note has no such column. */
function labeled(label: string, c: Cell, cls?: string): HTMLElement | null {
  if (c.col === "") return null;
  return h("p", { class: ["nx-mk-line", cls] }, h("span", { class: "nx-mk-k" }, `${label}: `), valueOf(c));
}

/** A spoken line in quote marks, unless it already starts with one. An empty one shows its green example as written. */
function quoteLine(c: Cell): HTMLElement | null {
  if (c.col === "") return null;
  const quoted = c.value === "" || /^["“]/.test(c.value);
  return h("p", { class: "nx-mk-quote" }, quoted ? null : "“", valueOf(c), quoted ? null : "”");
}

/** A MISSING slot (U4): the reason in muted text under "Research couldn't fill this". */
function missingBlock(reason: string): HTMLElement[] {
  return [h("p", { class: "nx-mk-missing" }, "Research couldn't fill this"), h("p", { class: "nx-muted" }, reason ? sentence(reason) : "No reason was written.")];
}

function ratingChip(rating: Exclude<HookRating, "">): HTMLElement {
  return h("span", { class: ["nx-mk-rating", `is-${rating}`] }, RATING_LABEL[rating]);
}

/**
 * "Asked ✓", "Reviewed Nov 21 ✓". It takes the place of the button that was pressed, so it carries that button's
 * data-fb and can hold keyboard focus: the re-render after the write moves focus onto it instead of the page top.
 */
function doneText(text: string, fb: string): HTMLElement {
  return h("span", { class: "nx-mk-done", "data-fb": fb, tabindex: "-1" }, text);
}

/** A plain "Edit" button; data-fb keeps keyboard focus on it across re-renders. */
function editButton(id: string, name: string, open: () => void): HTMLElement {
  const b = h("button", { class: "nx-btn nx-btn-quiet nx-pressable", type: "button", "data-fb": id, "aria-label": `Edit ${name}` }, "Edit");
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    open();
  });
  return b;
}

function openNote(ctx: Ctx, p: ProductSnapshot, heading?: string): HTMLElement {
  const b = h("button", { class: "nx-link", type: "button" }, "Open Marketing Engine →");
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    ctx.openDoc(p, "marketing", heading);
  });
  return b;
}

/** A write from a section button, its error in plain words under the button; its Undo fails in plain words too (runEdit). */
async function write(ctx: Ctx, p: ProductSnapshot, op: () => TableOp, out?: { inverse?: TableOp }): Promise<Undo> {
  try {
    return await runEdit(ctx, latest(ctx, p), "marketing", op(), out);
  } catch (e) {
    throw new Error(plainError(e));
  }
}

/**
 * Switches to `tab` when it isn't showing, then scrolls #nx-sec-<id> into view and moves keyboard focus to it (like
 * the counters), so Tab carries on from there.
 */
export function showSection(ctx: Ctx, p: ProductSnapshot, tab: Tab, id: string): void {
  const route = ctx.app.route;
  const showing = route.level === "product" && route.name === p.name && route.tab === tab;
  if (!showing) ctx.go({ level: "product", name: p.name, tab });
  const el = ctx.app.root.querySelector<HTMLElement>(`#${CSS.escape(`nx-sec-${id}`)}`);
  if (!el) return;
  el.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
  if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
  el.focus({ preventScroll: true });
}

function toggle(ctx: Ctx, id: string, open: boolean): void {
  if (open) ctx.mem.drawers.add(id);
  else ctx.mem.drawers.delete(id);
}

/** "Looks good" while research is newer than the last review; "Reviewed <date> ✓" after (researchState). */
function reviewControl(ctx: Ctx, p: ProductSnapshot, m: MarketingNote, part: "competitors" | "hooks", editable: boolean): HTMLElement | null {
  const date = m.reviewed[part];
  const id = `mk:${p.name}:review:${part}`;
  if (researchState(m).reviewed[part] && date) return doneText(`Reviewed ${shortDate(date, ctx.today)} ✓`, id);
  if (!m.research || !editable) return null;
  return ctx.button({
    id,
    label: "Looks good",
    doneLabel: "Reviewed",
    title: part === "competitors" ? "Marks these competitors as checked" : "Marks these hooks as checked",
    onClick: () => write(ctx, p, () => reviewedOp(m, part, ctx.today)),
  });
}

const missingNote = (p: ProductSnapshot) => `${p.displayName} has no Marketing Engine note (${DOC_FILES.marketing}).`;

/** A section root with its anchor (U7). */
function sectionRoot(id: string, head: HTMLElement): HTMLElement {
  return h("section", { class: "nx-section nx-mk-sec", id: `nx-sec-${id}` }, head);
}

// ---------------------------------------------------------------------------------------------------
// Competitors
// ---------------------------------------------------------------------------------------------------

/** Competitors (id nx-sec-competitors): research status, Ask for research, Looks good, 3 cards and how they were picked. */
export function competitorsSection(ctx: Ctx, p: ProductSnapshot): HTMLElement {
  const sec = sectionRoot("competitors", sectionHead(ctx, "competitors", `Competitors (${p.competitorsFilled} of 3)`));
  const m = p.marketing;
  if (!m) {
    sec.append(emptyNote(missingNote(p)));
    return sec;
  }
  const ro = readOnlyLine(p.status);
  if (ro) sec.append(h("p", { class: "nx-mk-readonly" }, ro));
  sec.append(researchBar(ctx, p, m, !ro));

  const rows = m.competitors;
  if (!rows || rows.length === 0) {
    sec.append(emptyNote(rows ? "No competitors in the note yet." : "The Marketing Engine has no Competitor swipe section yet.", openNote(ctx, p, rows ? "Competitor swipe" : undefined)));
  } else {
    sec.append(h("div", { class: "nx-mk-cards" }, rows.map((r) => competitorCard(ctx, p, r, !ro))));
  }
  if (m.picked) sec.append(pickedDrawer(ctx, p, m.picked));
  return sec;
}

function researchBar(ctx: Ctx, p: ProductSnapshot, m: MarketingNote, editable: boolean): HTMLElement {
  const line = researchLine(m, p.profile, ctx.today, { blockers: editable });
  const pending = researchState(m).pending;
  const actions = h("div", { class: "nx-mk-actions" });
  if (line.fillIn && editable) {
    actions.append(
      ctx.button({ id: `mk:${p.name}:fill`, label: "Fill in", variant: "ghost", title: "Shows the product profile on the Developer side", onClick: () => showSection(ctx, p, "dev", "profile") }),
    );
  }
  if (pending) actions.append(doneText("Asked ✓", `mk:${p.name}:ask`));
  else if (editable) {
    actions.append(
      ctx.button({
        id: `mk:${p.name}:ask`,
        label: "Ask for research",
        doneLabel: "Asked",
        variant: m.research ? "ghost" : "primary",
        title: "Gives the Developer a quest to run /competitors",
        onClick: async () => {
          const undo = await write(ctx, p, () => requestResearchOp(m, ctx.today, requestBy(ctx.host.prefs.role)));
          ctx.app.toast("Asked for research. The Developer gets a quest to run /competitors.", { undo });
        },
      }),
    );
  }
  const review = reviewControl(ctx, p, m, "competitors", editable);
  if (review) actions.append(review);
  return h("div", { class: "nx-mk-status" }, h("p", { class: "nx-mk-status-text" }, line.text), actions.childElementCount ? actions : null);
}

function competitorCard(ctx: Ctx, p: ProductSnapshot, r: CompetitorRow, editable: boolean): HTMLElement {
  const n = r.index + 1;
  const card = h("article", { class: ["nx-card", "nx-mk-card", r.missing !== null && "is-missing"] }, h("span", { class: "nx-card-label" }, `Competitor ${n}`));
  if (r.missing !== null) card.append(...missingBlock(r.missing));
  else {
    card.append(
      ...[
        r.name.col !== "" ? h("h4", { class: "nx-mk-title" }, valueOf(r.name)) : null,
        labeled("Top video", r.link),
        quoteLine(r.hook),
        labeled("Why it works", r.why),
      ].filter((x): x is HTMLElement => x !== null),
    );
  }
  const rows = p.marketing?.competitors ?? [r];
  if (editable) card.append(h("div", { class: "nx-mk-card-actions" }, editButton(`mk:${p.name}:competitor:${r.index}:edit`, `competitor ${n}`, () => editCompetitor(ctx, p, rows, r))));
  return card;
}

/** URL boxes: a warning (never a block) when the text isn't a whole web link. */
function linkCheck(v: string): Check | null {
  return v === "" || /^(?:https?:\/\/|www\.)\S+$/i.test(v) ? null : { level: "warn", text: LINK_WARN };
}

function editCompetitor(ctx: Ctx, p: ProductSnapshot, rows: readonly CompetitorRow[], row: CompetitorRow): void {
  const n = row.index + 1;
  const form = competitorForm(row);
  /** The MISSING line an empty Name box stands for, as the sheet last read it. */
  let nameBehind = row.missing !== null ? splitLink(row.name).label : "";
  /**
   * The competitor as the sheet last showed it, found again by its name (sameRow) whenever the note changes, so the
   * sheet keeps editing it wherever its line moved, and never another competitor; the save goes to its line now.
   */
  let shown = row;
  let shownRows = rows;
  const fields: FieldSpec[] = [];
  if (row.name.col !== "") {
    fields.push(
      { key: "name", label: "Name", kind: "text", value: form.name, example: row.name.example },
      { key: "storeUrl", label: "Store page link", kind: "url", value: form.storeUrl, example: LINK_EXAMPLE, hint: "The page where it's sold.", check: linkCheck },
    );
  }
  if (row.link.col !== "") {
    fields.push(
      { key: "video", label: "Top video", kind: "text", value: form.video, example: row.link.example },
      { key: "videoUrl", label: "Top video link", kind: "url", value: form.videoUrl, example: LINK_EXAMPLE, check: linkCheck },
    );
  }
  if (row.hook.col !== "") fields.push({ key: "hook", label: "Hook", kind: "line", value: form.hook, example: row.hook.example, hint: "What their top video says in the first 3 seconds." });
  if (row.why.col !== "") fields.push({ key: "why", label: "Why it works", kind: "textarea", value: form.why, example: row.why.example });

  editSheet(ctx, {
    title: `Edit competitor ${n}`,
    intro:
      row.missing !== null
        ? `Research couldn't fill this: ${sentence(row.missing)}. Add one you found yourself, or ask for research again.`
        : `Saves to ${p.displayName}'s Marketing Engine.`,
    fields,
    current: () => {
      const all = latestMarketing(ctx, p)?.competitors;
      const fresh = sameRow(shownRows, shown, all, competitorKey, competitorCells);
      if (!fresh || !all) return null;
      shown = fresh;
      shownRows = all;
      const now = competitorForm(fresh);
      if (now.name === "" && now.storeUrl === "") nameBehind = fresh.missing !== null ? splitLink(fresh.name).label : "";
      return now;
    },
    save: (values, changed, seen) =>
      sheetWrite(ctx, latest(ctx, p), "marketing", competitorSave(shown, values, changed, seen, nameBehind), "Not saved: this competitor is no longer in the note."),
  });
}

/** "How these 3 were picked": the callout's lines (links clickable, lists kept) and its table. */
function pickedDrawer(ctx: Ctx, p: ProductSnapshot, picked: NonNullable<MarketingNote["picked"]>): HTMLElement {
  const id = `mk-picked:${p.name}`;
  return drawer({
    id,
    open: ctx.mem.drawers.has(id),
    onToggle: (o) => toggle(ctx, id, o),
    label: h("span", null, "How these 3 were picked", picked.date ? h("span", { class: "nx-muted" }, ` · ${shortDate(picked.date, ctx.today)}`) : null),
    body: () => h("div", { class: "nx-mk-picked" }, pickedLines(picked.lines), picked.table ? pickedTable(picked.table) : null),
  });
}

function pickedLines(lines: string[]): HTMLElement[] {
  const out: HTMLElement[] = [];
  let list: HTMLElement | null = null;
  for (const line of lines) {
    const bullet = /^[-*+]\s+(.*)$/.exec(line);
    const numbered = /^(\d+)[.)]\s+(.*)$/.exec(line);
    if (!bullet && !numbered) {
      list = null;
      out.push(h("p", null, richText(line)));
      continue;
    }
    const tag = bullet ? "ul" : "ol";
    if (!list || list.tagName.toLowerCase() !== tag) {
      list = bullet ? h("ul", null) : h("ol", { start: numbered ? Number(numbered[1]) : 1 });
      out.push(list);
    }
    list.append(h("li", null, richText(bullet ? bullet[1] : numbered ? numbered[2] : line)));
  }
  return out;
}

function pickedTable(t: Table): HTMLElement {
  const text = (s: string) => richText(stripExamples(s).trim());
  return h(
    "div",
    { class: "nx-table-wrap" },
    h(
      "table",
      { class: "nx-table nx-mk-picked-table" },
      h("thead", null, h("tr", null, t.headers.map((x) => h("th", { scope: "col" }, text(x))))),
      h("tbody", null, t.rows.map((r) => h("tr", null, r.map((c, i) => (i === 0 ? h("th", { scope: "row" }, text(c)) : h("td", null, text(c))))))),
    ),
  );
}

// ---------------------------------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------------------------------

/** Hooks (id nx-sec-hooks): Recommended, Medium, Don't use (collapsed), Not rated yet; Edit and Use in a video. */
export function hooksSection(ctx: Ctx, p: ProductSnapshot): HTMLElement {
  const m = p.marketing;
  const ro = readOnlyLine(p.status);
  const extra: Child[] = [];
  if (m?.hooks) {
    extra.push(h("span", { class: "nx-muted" }, `${p.hooksFilled} of ${p.hooksTotal} written`));
    const review = reviewControl(ctx, p, m, "hooks", !ro);
    if (review) extra.push(review);
  }
  const sec = sectionRoot("hooks", sectionHead(ctx, "hooks", "Hooks", extra.length ? extra : undefined));
  if (!m) {
    sec.append(emptyNote(missingNote(p)));
    return sec;
  }
  if (ro) sec.append(h("p", { class: "nx-mk-readonly" }, ro));
  const rows = m.hooks?.rows ?? null;
  if (!rows || rows.length === 0) {
    sec.append(emptyNote(rows ? "No hooks in the note yet." : "The Marketing Engine has no Hook scripts section yet.", openNote(ctx, p, rows ? "Hook scripts" : undefined)));
    return sec;
  }

  const cards = (list: HookRow[]) => h("div", { class: "nx-mk-cards" }, list.map((r) => hookCard(ctx, p, m, r, !ro)));
  const group = (title: string, list: HookRow[]) => (list.length ? h("div", { class: "nx-mk-group" }, h("h4", { class: "nx-mk-group-title" }, title), cards(list)) : null);
  const of = (rating: HookRating) => rows.filter((r) => r.rating === rating);

  const avoid = of("avoid");
  const id = `mk-avoid:${p.name}`;
  sec.append(
    ...[
      group(RATING_LABEL.recommended, of("recommended")),
      group(RATING_LABEL.medium, of("medium")),
      avoid.length
        ? drawer({
            id,
            open: ctx.mem.drawers.has(id),
            onToggle: (o) => toggle(ctx, id, o),
            label: h("span", null, `${RATING_LABEL.avoid} (${avoid.length})`),
            body: () => [h("p", { class: "nx-mk-drawer-note" }, "Patterns that got few views. Don't record these."), cards(avoid)],
          })
        : null,
      group("Not rated yet", of("")),
    ].filter((x): x is HTMLElement => x !== null),
  );
  return sec;
}

function hookCard(ctx: Ctx, p: ProductSnapshot, m: MarketingNote, r: HookRow, editable: boolean): HTMLElement {
  const num = hookNumber(r);
  const avoid = r.rating === "avoid";
  const used = videosUsing(m, r);
  const card = h(
    "article",
    { class: ["nx-card", "nx-mk-card", "nx-mk-hook", r.rating && `is-${r.rating}`, r.missing !== null && "is-missing"] },
    h(
      "div",
      { class: "nx-mk-top" },
      r.rating ? ratingChip(r.rating) : null,
      h("span", { class: "nx-card-label" }, `Hook ${num}`),
      used.length ? h("span", { class: "nx-mk-used" }, usedText(used)) : null,
    ),
  );
  const body: (HTMLElement | null)[] =
    r.missing !== null
      ? missingBlock(r.missing)
      : avoid
        ? [r.hook.col !== "" ? h("p", { class: "nx-mk-pattern" }, valueOf(r.hook)) : null, labeled("Based on", r.basedOn, "nx-mk-small")]
        : [quoteLine(r.hook), labeled("Shows", r.demo), labeled("Ends with", r.cta), labeled("Based on", r.basedOn, "nx-mk-small")];
  card.append(...body.filter((x): x is HTMLElement => x !== null));

  if (editable) {
    const rows = m.hooks?.rows ?? [r];
    const actions = h("div", { class: "nx-mk-card-actions" }, editButton(`mk:${p.name}:hook:${r.index}:edit`, `hook ${num}`, () => editHook(ctx, p, rows, r)));
    if (!avoid && r.missing === null && !isPlaceholder(r.hook.value)) {
      const use = ctx.button({
        id: `mk:${p.name}:hook:${r.index}:use`,
        label: "Use in a video",
        doneLabel: "Added",
        variant: "quiet",
        title: "Adds a video with this hook to Videos to make",
        onClick: async () => {
          // The number the write gave the video (the data on screen may not hold an earlier press yet).
          const out: { inverse?: TableOp } = {};
          const undo = await write(ctx, p, () => useHookOp(m, r), out);
          ctx.app.toast(`Added as video ${writtenNumber(out.inverse) ?? nextVideoNumber(m)}`, { undo });
        },
      });
      // Every card has one: the spoken name says which hook, after the visible words (label in name).
      use.querySelector("button")?.setAttribute("aria-label", `Use in a video: hook ${num}`);
      actions.append(use);
    }
    card.append(actions);
  }
  return card;
}

function editHook(ctx: Ctx, p: ProductSnapshot, rows: readonly HookRow[], row: HookRow): void {
  const num = hookNumber(row);
  const v2 = row.ratingCell.col !== "";
  const avoid = row.rating === "avoid";
  const form = hookForm(row);
  /** The Rating cell's text the sheet last read for each rating, so a save expects the note's own words. */
  const ratingText = new Map<string, string>([[row.rating, row.ratingCell.value]]);
  /** The MISSING line an empty Hook box stands for, as the sheet last read it. */
  let hookBehind = row.missing !== null ? formValue(row.hook) : "";
  /** The hook as the sheet last showed it (findHook), so the save goes to its line wherever it moved. */
  let shown = row;
  let shownRows = rows;

  const fields: FieldSpec[] = [];
  // Old notes (v1) have no Rating column, and nothing ever adds one (U9).
  if (v2) fields.push({ key: "rating", label: "Rating", kind: "select", value: row.rating, options: RATING_OPTIONS });
  if (row.hook.col !== "") {
    fields.push(
      avoid
        ? {
            key: "hook",
            label: "Opening to avoid",
            kind: "line",
            value: form.hook ?? "",
            example: row.hook.example,
            hint: "Describe the pattern and its numbers, never a script someone could post.",
            // Rated up in this sheet, it becomes a spoken hook again: 12 words at most.
            check: (v, all) => (all.rating === "recommended" || all.rating === "medium" ? hookWordsCheck(v) : null),
          }
        : { key: "hook", label: "Hook", kind: "line", value: form.hook ?? "", example: row.hook.example, hint: "Spoken in the first 3 seconds, in your own words.", maxWords: 12 },
    );
  }
  if (row.demo.col !== "") fields.push({ key: "demo", label: "Demo shot", kind: "line", value: form.demo ?? "", example: row.demo.example, hint: "What the screen shows in the first 3 seconds." });
  if (row.cta.col !== "") fields.push({ key: "cta", label: "CTA", kind: "line", value: form.cta ?? "", example: row.cta.example, hint: "How the video ends: what viewers should do next." });
  if (row.basedOn.col !== "") fields.push({ key: "basedOn", label: "Based on", kind: "textarea", value: form.basedOn ?? "", example: row.basedOn.example, hint: "Links to the competitor videos it comes from. Each one is written [name 2.6×](web address): keep the square and round brackets, so the card shows it as a link." });

  editSheet(ctx, {
    title: `Edit hook ${num}`,
    intro:
      row.missing !== null
        ? `Research couldn't fill this: ${sentence(row.missing)}. You can write one yourself.`
        : avoid
          ? "An opening to avoid: competitor videos that started this way got few views."
          : `Saves to ${p.displayName}'s Marketing Engine.`,
    fields,
    current: () => {
      const m = latestMarketing(ctx, p);
      const fresh = findHook(m, shown, shownRows);
      if (!fresh || !m?.hooks) return null;
      shown = fresh;
      shownRows = m.hooks.rows;
      if (v2) ratingText.set(fresh.rating, fresh.ratingCell.value);
      const now = hookForm(fresh);
      if (now.hook === "") hookBehind = fresh.missing !== null ? formValue(fresh.hook) : "";
      return now as Record<string, string>;
    },
    save: (values, changed, seen) =>
      sheetWrite(ctx, latest(ctx, p), "marketing", hookSave(shown, values, changed, seen, { ratingText, hookBehind }), "Not saved: this hook is no longer in the note."),
  });
}
