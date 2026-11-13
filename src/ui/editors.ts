// Three parts of the Marketing Engine (2_Marketing_Engine) the Marketer fills in on the dashboard without opening the
// note: Videos to make (the content backlog), Brand kit and Paid test plan. Every write goes through runEdit
// (inline.ts) with an op from a builder in data/marketingOps.ts, and every edit happens in one edit sheet that shows
// its checks, a partner's changes and any error inside it (U1–U6). A queued or archived product shows the same
// sections read-only (U8). saveEach and readOnlyLine are shared with the profile line (profile.ts).

import { addDays, daysBetween, isIsoDate, longDate, relativeDay } from "../data/dates";
import type { FieldId } from "../data/fields";
import { isPlaceholder, plainText } from "../data/markdown";
import { videoRule } from "../data/marketing";
import type { BacklogRow, Cell, HookRow, KvRow, MarketingNote } from "../data/marketing";
import {
  addVideoOp,
  avoidHookWarning,
  BACKLOG_STEPS,
  backlogCells,
  backlogOp,
  backlogStatusOp,
  budgetCheck,
  deleteRowOp,
  formValue,
  kvOp,
  sameRow,
  startDayCheck,
  stripeCheck,
  stripeSecret,
} from "../data/marketingOps";
import type { BacklogValues, Check } from "../data/marketingOps";
import { GENERIC_EXAMPLES, MARKETING_SECTIONS, RATING_LABEL } from "../data/noteFormat";
import { ConflictError } from "../data/tableEdit";
import type { TableOp } from "../data/tableEdit";
import { DOC_FILES } from "../data/types";
import type { DocKey, ProductSnapshot } from "../data/types";
import type { Ctx } from "./app";
import { emptyNote, sectionHead } from "./components";
import { Child, h } from "./dom";
import type { Undo } from "./host";
import { cellText, editSheet, isGone, plainError, runEdit, sheetWrite } from "./inline";
import type { FieldSpec } from "./inline";
import { replayClass } from "./motion";

// ─────────────────────────────────────────────────────────────────────────────
// Shared with the profile line
// ─────────────────────────────────────────────────────────────────────────────

/**
 * U8: the one muted line a product outside a running sprint shows on its sections, or null when they can be
 * edited. Queued products wait for their sprint; scaled and killed ones are decided. Same signature and words as
 * marketing.ts's readOnlyLine, so the whole Marketing side reads alike (either one can stay).
 */
export function readOnlyLine(status: string): string | null {
  const s = status.trim().toLowerCase();
  if (s === "queued") return "Queued: not in a sprint yet, so nothing here can be changed.";
  if (s === "scaled" || s === "killed") return `Archived: this sprint was decided (${s === "scaled" ? "Scale" : "Kill"}), so nothing here can be changed.`;
  return null;
}

/** The product as the dashboard holds it now. An open sheet reads a partner's changes from here (U6). */
export function latestProduct(ctx: Ctx, p: ProductSnapshot): ProductSnapshot | null {
  return ctx.app.data?.products.find((x) => x.name === p.name) ?? null;
}

/** One field of a sheet that saves each field as its own write: its name for messages, and its op. */
export interface SaveStep {
  label: string;
  /** Built when the step runs, so a refusal (a Stripe key, a missing column) stays with its own field. */
  op: () => TableOp;
}

/**
 * Saves each step as its own write, in order (U1). All saved: one Undo for all of them. Nothing saved because of a
 * partner's change: that conflict exactly as it was thrown, so the edit sheet shows the change the usual way (U5,
 * U6). Otherwise the thrown error says in plain words which fields didn't save and why, and when some did save, a
 * toast offers their Undo. The fields that saved then match the note, so the next Save sends only the others.
 */
export async function saveEach(ctx: Ctx, p: ProductSnapshot, doc: DocKey, steps: SaveStep[]): Promise<Undo | void> {
  const undos: Undo[] = [];
  const saved: string[] = [];
  const failed: Failure[] = [];
  for (const step of steps) {
    try {
      undos.push(await runEdit(ctx, p, doc, step.op()));
      saved.push(step.label);
    } catch (error) {
      failed.push({ label: step.label, error });
    }
  }
  if (failed.length === 0) return undos.length ? undoAll(undos) : undefined;
  if (saved.length === 0) {
    const conflict = failed.find((f) => isConflict(f.error));
    if (conflict) throw conflict.error;
  } else {
    ctx.app.toast(`Saved ${andList(saved.map(quoted))}`, { undo: undoAll(undos) });
  }
  throw new Error(saveReport(saved, failed));
}

interface Failure {
  label: string;
  error: unknown;
}

/** Undoes several writes, newest first. Every one is tried; the first failure is reported (each already in plain words). */
function undoAll(undos: Undo[]): Undo {
  if (undos.length === 1) return undos[0];
  return async () => {
    let failure: { error: unknown } | null = null;
    for (const undo of [...undos].reverse()) {
      try {
        await undo();
      } catch (error) {
        if (!failure) failure = { error };
      }
    }
    if (failure) throw failure.error;
  };
}

const isConflict = (e: unknown): boolean => e instanceof ConflictError || (e instanceof Error && e.name === "ConflictError");

/**
 * "Saved “Video” and “Platform”. “Budget” didn't save: your partner changed it while you were editing. Check the note
 * above, then save again." The same trouble for several fields (the note can't be written) is said once.
 */
function saveReport(saved: string[], failed: Failure[]): string {
  const labels = (list: Failure[]) => andList(list.map((f) => quoted(f.label)));
  const conflicts = failed.filter((f) => isConflict(f.error));
  const gone = failed.filter((f) => !isConflict(f.error) && isGone(f.error));
  const others = failed.filter((f) => !isConflict(f.error) && !isGone(f.error));
  const parts = saved.length ? [`Saved ${andList(saved.map(quoted))}.`] : [];
  if (conflicts.length) {
    const one = conflicts.length === 1;
    parts.push(`${labels(conflicts)} didn't save: your partner changed ${one ? "it" : "them"} while you were editing. Check the ${one ? "note" : "notes"} above, then save again.`);
  }
  if (gone.length) parts.push(`${labels(gone)} didn't save: ${gone.length === 1 ? "it's" : "they're"} no longer in the note. Open the note to check.`);
  const reasons = [...new Set(others.map((f) => plainError(f.error)))];
  if (reasons.length === 1) parts.push(`${labels(others)} didn't save: ${reasons[0]}`);
  else for (const f of others) parts.push(`${quoted(f.label)} didn't save: ${plainError(f.error)}`);
  return parts.join(" ");
}

const quoted = (s: string): string => `“${s}”`;

/** "a", "a and b", "a, b and c". */
function andList(items: string[]): string {
  if (items.length <= 2) return items.join(" and ");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** A link-style button that opens a note, at a heading when there is one ("Open Dev Spec →"). */
export function openNoteButton(ctx: Ctx, p: ProductSnapshot, doc: DocKey, label: string, heading?: string, name?: string): HTMLButtonElement {
  const b = h("button", { class: "nx-link nx-ed-open", type: "button", "aria-label": name }, label);
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    ctx.openDoc(p, doc, heading);
  });
  return b;
}

/** A button that opens an edit sheet. `name` is its accessible name when the label alone is ambiguous ("Edit video #2"). */
export function sheetOpener(label: string, onClick: () => void, opts: { name?: string; variant?: "primary" | "ghost" | "quiet"; id?: string } = {}): HTMLButtonElement {
  const b = h(
    "button",
    { class: ["nx-btn", `nx-btn-${opts.variant ?? "quiet"}`, "nx-pressable", "nx-ed-btn"], type: "button", "aria-haspopup": "dialog", "aria-label": opts.name, "data-fb": opts.id },
    label,
  );
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}

/** The section root: U7's anchor id, and the dashboard's section title with its ⓘ card. */
function sectionRoot(ctx: Ctx, id: string, field: FieldId, title: string, extra?: Child): HTMLElement {
  return h("section", { class: "nx-section nx-ed-section", id: `nx-sec-${id}`, "aria-label": title }, sectionHead(ctx, field, title, extra));
}

const muted = (text: string): HTMLElement => h("span", { class: "nx-muted" }, text);

/** The muted line under a section title: read-only (U8) or a missing note. */
const quietLine = (text: string): HTMLElement => h("p", { class: "nx-ed-locked" }, text);

/** U8: one line naming the missing note. */
function noNote(p: ProductSnapshot): HTMLElement {
  return quietLine(`${p.displayName} has no Marketing Engine note (${DOC_FILES.marketing}).`);
}

/** The note is there but this part of it isn't (renamed heading, deleted list). */
function noPart(ctx: Ctx, p: ProductSnapshot, name: string, heading: string, locked: boolean): HTMLElement {
  return emptyNote(`The Marketing Engine has no ${name} section yet.`, locked ? null : openNoteButton(ctx, p, "marketing", "Open Marketing Engine →", heading));
}

/** A cell on a card: its text with working links, or its green example when it's empty (U4), else `empty` in muted text. */
function cellOr(c: Cell, empty: string): Child {
  return cellText(c) ?? muted(empty);
}

/** A check's message on a card: ⚠ for a warning, ✕ for a refusal. */
function checkLine(c: Check): HTMLElement {
  return h("p", { class: ["nx-ed-warn", c.level === "error" && "is-error"] }, c.text);
}

/** One line of a label / value list. The action (an Edit button) sits at the end of the value. */
function kvRow(label: Child, value: Child, action?: Child): HTMLElement {
  return h("div", { class: "nx-kv-row" }, h("dt", { class: "nx-kv-label" }, label), h("dd", { class: "nx-kv-value" }, h("div", { class: "nx-kv-text" }, value), action ?? null));
}

/** "Sat Nov 14" (the year left out, as on the timeline). */
function shortDate(iso: string): string {
  return longDate(iso).replace(/, \d{4}$/, "");
}

/** A real YYYY-MM-DD date (not just the shape). */
function isDate(s: string): boolean {
  return isIsoDate(s) && !Number.isNaN(Date.parse(`${s.trim()}T12:00:00Z`));
}

/** "Sat Nov 14 (day 14)": the sprint day once Day 1 is set. */
function dateText(p: ProductSnapshot, iso: string): string {
  const day = p.cycleStart && isDate(p.cycleStart) ? daysBetween(p.cycleStart, iso) + 1 : null;
  return day !== null && day >= 1 ? `${shortDate(iso)} (day ${day})` : shortDate(iso);
}

/** Text that fits on one line of a card or a select: the first `max` characters, cut at a word. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const at = cut.lastIndexOf(" ");
  return `${(at > max / 2 ? cut.slice(0, at) : cut).replace(/[\s,.;:]+$/, "")}…`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Videos to make (the content backlog)
// ─────────────────────────────────────────────────────────────────────────────

const VIDEO_KEYS: Array<keyof BacklogValues> = ["format", "platforms", "hookNum", "status", "goLive"];

/**
 * The rows that are videos in this note: the data layer's rule (videoRule, by the note's layout), so this list, its
 * counter and the quests count alike.
 */
export const isVideoIn = videoRule;

/** A video with a number of its own (a key for buttons and the paid test plan's choices). */
const byNumber = (row: BacklogRow): boolean => /^\d+$/.test(row.num);

/** A key for a video's controls that no other video shares: its number, or its place when it has none or shares it. */
const videoId = (row: BacklogRow): string => (byNumber(row) && !row.repeated ? row.num : `@${row.index}`);

/** "Video #2" ("video #2" inside a sentence), or "Video 3" for a row without a number. */
function videoName(row: BacklogRow, lower = false): string {
  const name = row.num ? `Video #${row.num}` : `Video ${row.index + 1}`;
  return lower ? `v${name.slice(1)}` : name;
}

/** A video's key and cells for sameRow: an open sheet finds it again by its number, and never takes another video for it. */
const videoKey = (r: BacklogRow): string => r.num;
const videoCells = (r: BacklogRow): string[] => [r.num, ...Object.values(backlogCells(r)).map((c) => c.value)];

/** A hook number as typed in a video row or a hook's # cell: "2", "#2", "Hook 2" → 2; anything else → null. */
function hookNumber(s: string): number | null {
  const m = /^\s*(?:hook\s*)?#?\s*(\d{1,4})\s*$/i.exec(s);
  return m ? Number(m[1]) : null;
}

/** The hook a video points to, looked up by number in the Hooks list, or null. */
function hookFor(m: MarketingNote, hookNum: string): HookRow | null {
  const n = hookNumber(hookNum);
  return n === null ? null : m.hooks?.rows.find((r) => hookNumber(r.num) === n) ?? null;
}

/** A hook's words on one line, without the quote marks around a spoken line. */
function spoken(v: string): string {
  const text = plainText(v.replace(/<br\s*\/?>/gi, " ")).replace(/\\\|/g, "|").replace(/\s+/g, " ").trim();
  const inQuotes = /^["“'‘]([\s\S]+)["”'’]$/.exec(text);
  return inQuotes ? inQuotes[1].trim() : text;
}

/** The first words of a hook for a select option, or why there are none. */
function hookWordsShort(r: HookRow): string {
  if (r.missing !== null) return "research couldn't fill this one";
  const words = spoken(r.hook.value);
  return words ? clip(words, 44) : "not written yet";
}

/** "2 · 🟢 Recommended · Your vocal is fine. The S's…": the rating always with its word (rule 6). */
function hookOptionLabel(r: HookRow): string {
  return `${r.num.replace(/^#/, "")} · ${r.rating ? RATING_LABEL[r.rating] : "Not rated yet"} · ${hookWordsShort(r)}`;
}

/**
 * The Hook select: None, then every numbered hook. The note's own text stands in for its hook's value ("#2" stays
 * "#2"), so a select nobody touched reads back exactly as the note has it and never conflicts.
 */
function hookOptions(hooks: HookRow[], current: string): Array<{ value: string; label: string }> {
  const n = hookNumber(current);
  return [{ value: "", label: "None" }, ...hooks.map((r) => ({ value: n !== null && hookNumber(r.num) === n ? current : r.num, label: hookOptionLabel(r) }))];
}

/** Not set, then the 4 steps. A step written in another case ("Scripted") keeps the note's text as its value. */
function statusOptions(current: string): Array<{ value: string; label: string }> {
  const typed = current.trim().toLowerCase();
  return [{ value: "", label: "Not set" }, ...BACKLOG_STEPS.map((s) => ({ value: typed === s.value ? current : s.value, label: s.label }))];
}

/** U11: picking a Don't use hook for a video warns. */
function avoidCheck(m: MarketingNote, v: string): Check | null {
  const hook = hookFor(m, v);
  return hook?.rating === "avoid" ? { level: "warn", text: avoidHookWarning(hook) } : null;
}

/** "Launch day (day 14) is Sat Nov 14." once Day 1 is set. */
function launchHint(p: ProductSnapshot): string | undefined {
  return p.cycleStart && isDate(p.cycleStart) ? `Launch day (day 14) is ${shortDate(addDays(p.cycleStart, 13))}.` : undefined;
}

/** Every editable field of a video as the edit form shows it (formValue), keyed like BacklogValues. */
function videoForm(row: BacklogRow): Record<string, string> {
  const cells = backlogCells(row);
  return Object.fromEntries(VIDEO_KEYS.map((k) => [k, formValue(cells[k])]));
}

/** The changed fields as BacklogValues. */
function videoValues(values: Record<string, string>, keys: string[]): BacklogValues {
  const out: BacklogValues = {};
  for (const k of VIDEO_KEYS) if (keys.includes(k)) out[k] = values[k];
  return out;
}

/** Everything a delete expects (U2): the cells the user was shown, and the video's # so a shifted row can't be hit. */
function shownCells(row: BacklogRow): Cell[] {
  const cells = Object.values(backlogCells(row));
  return row.num ? [...cells, { value: row.num, raw: row.num, example: "", col: "#" }] : cells;
}

/** Edit sheet for one video, or for a new one (row null: "Add a video", saved with addVideoOp). */
function videoSheet(ctx: Ctx, p: ProductSnapshot, m: MarketingNote, row: BacklogRow | null): void {
  // Column names and examples: the row's own, else the first row's (a new video goes in the same list).
  const like = row ?? m.backlog?.[0] ?? null;
  const cells = like ? backlogCells(like) : null;
  const has = (k: keyof BacklogValues) => !cells || cells[k].col !== "";
  const example = (k: keyof BacklogValues) => cells?.[k].example || GENERIC_EXAMPLES.backlog[k];
  const form = row ? videoForm(row) : Object.fromEntries(VIDEO_KEYS.map((k) => [k, ""]));
  const hooks = (m.hooks?.rows ?? []).filter((r) => hookNumber(r.num) !== null);

  const fields: FieldSpec[] = [];
  if (has("format")) fields.push({ key: "format", label: "Format", kind: "text", value: form.format, example: example("format") });
  if (has("platforms")) {
    fields.push({ key: "platforms", label: "Platforms", kind: "text", value: form.platforms, example: example("platforms"), hint: "The apps it goes on, separated by commas." });
  }
  fields.push({
    key: "hookNum",
    label: "Hook",
    kind: "select",
    value: form.hookNum,
    options: hookOptions(hooks, form.hookNum),
    hint: hooks.length ? undefined : "No numbered hooks yet. Write them under Hooks first.",
    check: (v) => avoidCheck(m, v),
  });
  if (has("status")) fields.push({ key: "status", label: "Status", kind: "select", value: form.status, options: statusOptions(form.status) });
  if (has("goLive")) fields.push({ key: "goLive", label: "Go-live date", kind: "date", value: form.goLive, example: example("goLive"), hint: launchHint(p) });

  if (!row) {
    editSheet(ctx, {
      title: "Add a video",
      fields,
      save: async (values, changed) => sheetWrite(ctx, p, "marketing", addVideoOp(videoValues(values, changed), m), NO_BACKLOG),
    });
    return;
  }

  // The video as the sheet last showed it: current() moves it forward whenever the sheet shows a partner's change,
  // so Save and Delete go to this video wherever it moved and expect what's on screen (U2).
  let shown: BacklogRow = row;
  let shownRows: readonly BacklogRow[] = m.backlog ?? [row];
  const name = videoName(row, true);
  editSheet(ctx, {
    title: videoName(row),
    fields,
    save: async (values, changed, seen) => sheetWrite(ctx, p, "marketing", backlogOp(shown, videoValues(values, changed), seen), VIDEO_GONE),
    current: () => {
      const rows = latestProduct(ctx, p)?.marketing?.backlog;
      const now = sameRow(shownRows, shown, rows, videoKey, videoCells);
      if (!now || !rows) return null;
      shown = now;
      shownRows = rows;
      return videoForm(now);
    },
    danger: {
      label: "Delete",
      confirm: `Delete ${name}? You can undo it for 5 seconds.`,
      run: async () => sheetWrite(ctx, p, "marketing", deleteRowOp(MARKETING_SECTIONS.backlog, shown.index, shownCells(shown)), "Nothing to delete: this video is no longer in the note."),
      done: `Deleted ${name}`,
    },
  });
}

function addVideoButton(ctx: Ctx, p: ProductSnapshot, m: MarketingNote, variant: "primary" | "ghost"): HTMLButtonElement {
  return sheetOpener("Add a video", () => videoSheet(ctx, p, m, null), { variant, id: `ed:video:${p.name}:add` });
}

const lineLabel = (text: string): HTMLElement => h("span", { class: "nx-vline-label" }, text);

function platformsLine(row: BacklogRow): HTMLElement {
  if (row.platforms.length) return h("ul", { class: "nx-vchips", "aria-label": "Platforms" }, row.platforms.map((x) => h("li", { class: "nx-vchip" }, x)));
  return h("p", { class: "nx-vline" }, lineLabel("Platforms: "), cellOr(row.platformsCell, "none picked yet"));
}

/** "Hook 2: “…”", plus U11's warning when the hook is rated Don't use. */
function hookLines(m: MarketingNote, row: BacklogRow): HTMLElement[] {
  const line = (...c: Child[]) => h("p", { class: "nx-vline" }, ...c);
  if (row.hookNum === "") return [line(lineLabel("Hook: "), h("span", { class: "nx-eg" }, GENERIC_EXAMPLES.backlog.hookNum))];
  const hook = hookFor(m, row.hookNum);
  if (!hook) {
    const n = hookNumber(row.hookNum);
    return [n === null ? line(lineLabel("Hook: "), plainText(row.hookNum)) : line(lineLabel(`Hook ${n}: `), muted("there's no hook with that number"))];
  }
  const words = hook.missing === null ? spoken(hook.hook.value) : "";
  const text = hook.missing !== null ? muted("research couldn't fill this one") : words ? `“${words}”` : muted("not written yet");
  const out: HTMLElement[] = [line(lineLabel(`Hook ${hook.num.replace(/^#/, "")}: `), text)];
  if (hook.rating === "avoid") out.push(checkLine({ level: "warn", text: avoidHookWarning(hook) }));
  return out;
}

function goLiveLine(ctx: Ctx, p: ProductSnapshot, row: BacklogRow): HTMLElement {
  const v = row.goLive.value;
  if (!isDate(v)) return h("p", { class: "nx-vline" }, lineLabel("Go-live: "), cellOr(row.goLive, "not set yet"));
  const when = isDate(ctx.today) ? ` · ${relativeDay(v, ctx.today)}` : "";
  return h("p", { class: "nx-vline" }, lineLabel("Go-live: "), dateText(p, v), when ? muted(when) : null);
}

/** Status text the 4 steps can't show ("posted", "recorded, editing tomorrow"), as the note has it. */
function otherStatus(row: BacklogRow): HTMLElement | null {
  const v = row.statusCell.value;
  if (v === "" || v.toLowerCase() === row.status) return null;
  return h("p", { class: "nx-vline" }, lineLabel("Status in the note: "), `“${plainText(v)}”`);
}

const VIDEO_GONE = "Not saved: this video is no longer in the note.";
const NO_BACKLOG = "Not saved: the content backlog is no longer in the Marketing Engine. Open the note to check.";

/** Why a status step didn't save, in plain words (there's no sheet around it to show a partner's change). */
function stepFailure(e: unknown): string {
  if (isConflict(e)) {
    const now = e instanceof ConflictError ? e.actual : "";
    return `Not saved: your partner just changed this video's status${now ? ` to “${now}”` : ""}. Press a step again if you still want to change it.`;
  }
  if (isGone(e)) return VIDEO_GONE;
  return `Not saved: ${plainError(e)}`;
}

/** Where a status control's error lives on screen now (a render may have replaced the one that was pressed). */
function stepsError(ctx: Ctx, key: string): HTMLElement | null {
  return ctx.app.root.querySelector<HTMLElement>(`[data-vsteps-error="${CSS.escape(key)}"]`);
}

/**
 * The 4-step status: Scripted → Recorded → Edited → Scheduled. Pressing a step writes it (backlogStatusOp) and offers
 * Undo; the current step is pressed (aria-pressed), and it and the steps before it look done. Read-only: a plain list.
 */
function statusSteps(ctx: Ctx, p: ProductSnapshot, row: BacklogRow, locked: boolean): HTMLElement {
  const at = BACKLOG_STEPS.findIndex((s) => s.value === row.status);
  const label = `Status of ${videoName(row, true)}`;
  const parts = (i: number) => [h("span", { class: "nx-vstep-bar", "aria-hidden": "true" }), h("span", { class: "nx-vstep-label" }, BACKLOG_STEPS[i].label)];
  const cls = (i: number) => ["nx-vstep", i <= at && "is-reached", i === at && "is-current"];

  if (locked) {
    return h(
      "ol",
      { class: "nx-vsteps is-static", "aria-label": label },
      BACKLOG_STEPS.map((_, i) => h("li", { class: cls(i), "aria-current": i === at ? "step" : undefined }, parts(i))),
    );
  }

  const key = `ed:vstep:${p.name}:${videoId(row)}`;
  const group = h("div", { class: "nx-vsteps", role: "group", "aria-label": label });
  const error = h("p", { class: "nx-vsteps-error", role: "alert", "data-vsteps-error": key });
  const fb = ctx.mem.feedback.get(key);
  if (fb?.state === "error" && fb.until > Date.now()) error.textContent = fb.msg;

  let busy = false;
  const buttons = BACKLOG_STEPS.map((step, i) => {
    const pop = i === at && (ctx.mem.flash.get(`${key}:${step.value}`) ?? 0) > Date.now();
    const b = h("button", { class: [...cls(i), pop && "nx-vstep-pop"], type: "button", "aria-pressed": String(i === at), "data-fb": `${key}:${step.value}` }, parts(i));
    b.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (busy || i === at) return;
      busy = true;
      group.setAttribute("aria-busy", "true");
      b.classList.add("is-busy");
      ctx.mem.feedback.delete(key);
      error.textContent = "";
      // The render that follows the write marks the new step, so it can fill in once.
      ctx.mem.flash.set(`${key}:${step.value}`, Date.now() + 1500);
      try {
        const undo = await runEdit(ctx, p, "marketing", backlogStatusOp(row, step.value));
        // Still on screen: it has filled in already, so the re-render that follows mustn't play the fill again.
        if (b.isConnected) ctx.mem.flash.delete(`${key}:${step.value}`);
        b.classList.remove("is-busy");
        buttons.forEach((x, j) => {
          x.classList.toggle("is-reached", j <= i);
          x.classList.toggle("is-current", j === i);
          x.setAttribute("aria-pressed", String(j === i));
        });
        ctx.app.toast(`${videoName(row)}: ${step.label}`, { undo });
        // Until the note is read again this control still holds the old status, and another press would conflict.
        window.setTimeout(() => {
          busy = false;
          group.removeAttribute("aria-busy");
        }, 3000);
      } catch (err) {
        busy = false;
        group.removeAttribute("aria-busy");
        b.classList.remove("is-busy");
        ctx.mem.flash.delete(`${key}:${step.value}`);
        const msg = stepFailure(err);
        const until = Date.now() + 6000;
        ctx.mem.feedback.set(key, { state: "error", until, msg });
        const live = stepsError(ctx, key) ?? error;
        live.textContent = msg;
        replayClass(live.previousElementSibling ?? group, "nx-shake", 400);
        window.setTimeout(() => {
          if ((ctx.mem.feedback.get(key)?.until ?? 0) > Date.now()) return;
          ctx.mem.feedback.delete(key);
          const el = stepsError(ctx, key);
          if (el) el.textContent = "";
        }, 6050);
      }
    });
    return b;
  });
  group.append(...buttons);
  return h("div", { class: "nx-vsteps-wrap" }, group, error);
}

function videoCard(ctx: Ctx, p: ProductSnapshot, m: MarketingNote, row: BacklogRow, locked: boolean): HTMLElement {
  const edit = locked
    ? null
    : sheetOpener("Edit", () => videoSheet(ctx, p, m, row), { name: `Edit ${videoName(row, true)}`, id: `ed:video:${p.name}:${videoId(row)}:edit` });
  return h(
    "article",
    { class: "nx-card nx-vcard", "aria-label": videoName(row) },
    h(
      "div",
      { class: "nx-vcard-head" },
      h("h4", { class: "nx-vcard-title" }, h("span", { class: "nx-vcard-num" }, row.num ? `#${row.num}` : videoName(row)), " · ", cellOr(row.format, "no format yet")),
      edit,
    ),
    platformsLine(row),
    hookLines(m, row),
    goLiveLine(ctx, p, row),
    statusSteps(ctx, p, row, locked),
    otherStatus(row),
  );
}

/** No videos yet: what one looks like, in the template's green examples (U4), and Add a video. */
function videosEmpty(ctx: Ctx, p: ProductSnapshot, m: MarketingNote, backlog: BacklogRow[], locked: boolean): HTMLElement {
  const first = backlog[0];
  const cells = first ? backlogCells(first) : null;
  const eg = (k: keyof BacklogValues) => h("span", { class: "nx-eg" }, cells?.[k].example || GENERIC_EXAMPLES.backlog[k]);
  return h(
    "div",
    { class: "nx-empty nx-vempty" },
    h("p", { class: "nx-vempty-text" }, "No videos planned yet. Each one looks like this:"),
    h(
      "div",
      { class: "nx-card nx-vcard is-example" },
      h("p", { class: "nx-vcard-title" }, h("span", { class: "nx-vcard-num" }, `#${first?.num || "1"}`), " · ", eg("format")),
      h("p", { class: "nx-vline" }, lineLabel("Platforms: "), eg("platforms")),
      h("p", { class: "nx-vline" }, lineLabel("Hook: "), eg("hookNum")),
      h("p", { class: "nx-vline" }, lineLabel("Status: "), eg("status")),
      h("p", { class: "nx-vline" }, lineLabel("Go-live: "), eg("goLive")),
    ),
    locked ? null : addVideoButton(ctx, p, m, "primary"),
  );
}

/**
 * Videos to make (#nx-sec-videos): one card per video in the content backlog, with its platforms, its hook, its
 * go-live date and a 4-step status, plus Edit, Delete (in the sheet) and Add a video.
 */
export function videosSection(ctx: Ctx, p: ProductSnapshot): HTMLElement {
  const m = p.marketing;
  const locked = readOnlyLine(p.status);
  const backlog = m?.backlog ?? null;
  const videos = (backlog ?? []).filter(isVideoIn(m));
  const scheduled = videos.filter((v) => v.status === "scheduled").length;
  const root = sectionRoot(ctx, "videos", "backlog", "Videos to make", videos.length ? h("strong", null, `${scheduled} of ${videos.length} scheduled`) : undefined);
  if (!m) {
    root.append(noNote(p));
    return root;
  }
  if (locked) root.append(quietLine(locked));
  if (!backlog) {
    root.append(noPart(ctx, p, "Content backlog", "Content backlog", !!locked));
    return root;
  }
  if (!videos.length) {
    root.append(videosEmpty(ctx, p, m, backlog, !!locked));
    return root;
  }
  root.append(h("ul", { class: "nx-vlist" }, videos.map((v) => h("li", null, videoCard(ctx, p, m, v, !!locked)))));
  if (!locked) root.append(h("div", { class: "nx-ed-actions" }, addVideoButton(ctx, p, m, "ghost")));
  return root;
}

// ─────────────────────────────────────────────────────────────────────────────
// Brand kit
// ─────────────────────────────────────────────────────────────────────────────

const STRIPE_HINT = "The payment link starts with https://buy.stripe.com/";
const SECRET_ON_CARD = "A Stripe secret key is saved here. Keys never go in the vault: replace it with the payment link (https://buy.stripe.com/…).";

/** A brand kit or paid test row's key and cells for sameRow: found again by its label the way kvOp finds it. */
const kvKey = (r: KvRow): string => r.label;
const kvCells = (r: KvRow): string[] => [r.label, r.value.value];

const isStripeRow = (row: KvRow): boolean => /stripe/i.test(row.label);

/** One-field sheet for a brand kit row, saved through kvOp. The Stripe row refuses secret keys (U11). */
function brandSheet(ctx: Ctx, p: ProductSnapshot, rows: readonly KvRow[], row: KvRow, label: string): void {
  const stripe = isStripeRow(row);
  // The line as the sheet last showed it: the save goes to it wherever it moved (U2).
  let shown = row;
  let shownRows = rows;
  editSheet(ctx, {
    title: `Brand kit: ${label}`,
    fields: [
      {
        key: "value",
        label,
        kind: stripe ? "url" : "text",
        value: formValue(row.value),
        example: row.value.example || undefined,
        hint: stripe ? STRIPE_HINT : undefined,
        check: stripe ? (v) => stripeCheck(v) : undefined,
      },
    ],
    save: async (values, _changed, seen) => sheetWrite(ctx, p, "marketing", kvOp("brandKit", shown, values.value, seen.value), "Not saved: this line is no longer in the brand kit. Open the note to check."),
    current: () => {
      const fresh = latestProduct(ctx, p)?.marketing?.brandKit;
      const now = sameRow(shownRows, shown, fresh, kvKey, kvCells);
      if (!now || !fresh) return null;
      shown = now;
      shownRows = fresh;
      return { value: formValue(now.value) };
    },
  });
}

function brandLine(ctx: Ctx, p: ProductSnapshot, rows: readonly KvRow[], row: KvRow, v2: boolean, locked: boolean): HTMLElement {
  const label = row.label || `Item ${row.index + 1}`;
  // The same rule as the brand kit count: new notes need more than a placeholder, old notes any text.
  const secret = stripeSecret(row.value.value);
  const filled = !secret && (v2 ? !isPlaceholder(row.value.value) : row.value.value !== "");
  const id = `ed:brand:${p.name}:${row.label && !row.repeated ? row.label : `@${row.index}`}`;
  const edit = locked ? null : sheetOpener("Edit", () => brandSheet(ctx, p, rows, row, label), { name: `Edit ${label}`, id });
  return kvRow(
    [h("span", { class: ["nx-dot", filled && "is-on"], "aria-hidden": "true" }), h("span", null, label)],
    secret ? checkLine({ level: "error", text: SECRET_ON_CARD }) : cellOr(row.value, "Not filled in yet"),
    edit,
  );
}

/** Brand kit (#nx-sec-brandkit): one line per row with its link or green example, and an Edit sheet for each. */
export function brandKitSection(ctx: Ctx, p: ProductSnapshot): HTMLElement {
  const m = p.marketing;
  const locked = readOnlyLine(p.status);
  const rows = m?.brandKit ?? null;
  // U12: the title is "Brand kit"; the counter above it shows how many are filled.
  const root = sectionRoot(ctx, "brandkit", "brandKit", "Brand kit");
  if (!m) {
    root.append(noNote(p));
    return root;
  }
  if (locked) root.append(quietLine(locked));
  if (!rows) {
    root.append(noPart(ctx, p, "Brand kit", "Brand kit", !!locked));
    return root;
  }
  // A line with nothing at all in it (no label, no text, no example) isn't a brand kit item.
  const list = rows.filter((r) => r.label !== "" || r.value.value !== "" || r.value.example !== "");
  if (!list.length) {
    root.append(emptyNote("No brand kit items in the note yet.", locked ? null : openNoteButton(ctx, p, "marketing", "Open Marketing Engine →", "Brand kit")));
    return root;
  }
  const v2 = m.hooks?.layout === "v2";
  root.append(h("dl", { class: "nx-kv" }, list.map((r) => brandLine(ctx, p, rows, r, v2, !!locked))));
  return root;
}

// ─────────────────────────────────────────────────────────────────────────────
// Paid test plan
// ─────────────────────────────────────────────────────────────────────────────

/** The plan's 4 rows, found by the start of the template's labels. */
const PAID = [
  { key: "video", prefix: "video", label: "Video" },
  { key: "platform", prefix: "platform", label: "Platform" },
  { key: "start", prefix: "start", label: "Start date" },
  { key: "budget", prefix: "budget", label: "Budget" },
] as const;
type PaidKey = (typeof PAID)[number]["key"];

const AD_PLATFORMS = ["Meta", "TikTok", "Google"];
const BUDGET_HINT = "Put the first $100 behind the best free video. $300 per sprint at most.";

/** Each of the 4 rows by its label, each row used once. */
function paidRows(rows: KvRow[]): Map<PaidKey, KvRow> {
  const out = new Map<PaidKey, KvRow>();
  for (const f of PAID) {
    const used = [...out.values()];
    const row = rows.find((r) => r.label.toLowerCase().startsWith(f.prefix) && !used.includes(r));
    if (row) out.set(f.key, row);
  }
  return out;
}

/**
 * The backlog video a paid test names. whole: the text is only the reference ("backlog #2", "Backlog #2", "#2", "2"),
 * as a select can stand in for it; else it may say more ("Backlog #2, the best free video").
 */
function backlogNumber(s: string, whole: boolean): number | null {
  const m = whole ? /^\s*(?:backlog\s*)?#?\s*(\d{1,4})\s*$/i.exec(s) : /\bbacklog\s*#?\s*(\d{1,4})\b/i.exec(s) ?? /(?:^|[\s(])#\s*(\d{1,4})\b/.exec(s);
  return m ? Number(m[1]) : null;
}

/** A video's format for a select or a card: plain, on one line, short. */
function formatWords(v: BacklogRow): string {
  const text = plainText(v.format.value.replace(/<br\s*\/?>/gi, " ")).replace(/\s+/g, " ").trim();
  return text ? clip(text, 48) : "no format yet";
}

/** Not chosen yet, then each numbered video as "#2 · <format>", saved as "backlog #2". The note's own text stands in for its video. */
function videoOptions(videos: BacklogRow[], current: string): Array<{ value: string; label: string }> {
  const n = backlogNumber(current, true);
  return [
    { value: "", label: "Not chosen yet" },
    ...videos.map((v) => ({ value: n !== null && Number(v.num) === n ? current : `backlog #${v.num}`, label: `#${v.num} · ${formatWords(v)}` })),
  ];
}

function platformOptions(current: string): Array<{ value: string; label: string }> {
  const typed = current.trim().toLowerCase();
  return [{ value: "", label: "Not chosen yet" }, ...AD_PLATFORMS.map((x) => ({ value: typed === x.toLowerCase() ? current : x, label: x }))];
}

/** "Paid ads start on day 15: Thu Nov 19." once Day 1 is set. */
function day15Hint(p: ProductSnapshot): string {
  return p.cycleStart && isDate(p.cycleStart) ? `Paid ads start on day 15: ${shortDate(addDays(p.cycleStart, 14))}.` : "Paid ads start on day 15, the day after launch.";
}

/** The plan's Edit sheet: one field per row the plan has, each changed field saved through its own kvOp (saveEach). */
function paidSheet(ctx: Ctx, p: ProductSnapshot, m: MarketingNote, plan: Map<PaidKey, KvRow>): void {
  const isVideo = isVideoIn(m);
  const videos = (m.backlog ?? []).filter((r) => isVideo(r) && byNumber(r));
  const value = (row: KvRow) => formValue(row.value);
  const fields: FieldSpec[] = [];
  for (const f of PAID) {
    const row = plan.get(f.key);
    if (!row) continue;
    const v = value(row);
    const example = row.value.example || undefined;
    if (f.key === "video") {
      fields.push({
        key: f.key,
        label: f.label,
        kind: "select",
        value: v,
        options: videoOptions(videos, v),
        hint: videos.length ? "Pick the free video that did best after launch." : "Add videos under Videos to make first.",
      });
    } else if (f.key === "platform") {
      fields.push({ key: f.key, label: f.label, kind: "select", value: v, options: platformOptions(v) });
    } else if (f.key === "start") {
      fields.push({ key: f.key, label: f.label, kind: "date", value: v, example, hint: day15Hint(p), check: (x) => startDayCheck(x, p.cycleStart) });
    } else {
      fields.push({ key: f.key, label: f.label, kind: "number", value: v, example, hint: BUDGET_HINT, check: (x) => budgetCheck(x) });
    }
  }
  // Each line as the sheet last showed it: a save goes to it wherever it moved (U2).
  const shown = new Map(plan);
  let shownRows: readonly KvRow[] = m.paidTest ?? [...plan.values()];
  editSheet(ctx, {
    title: "Paid test plan",
    fields,
    save: async (values, changed, seen) =>
      saveEach(
        ctx,
        p,
        "marketing",
        PAID.filter((f) => changed.includes(f.key) && shown.has(f.key)).map((f) => ({
          label: f.label,
          op: () => kvOp("paidTest", shown.get(f.key) as KvRow, values[f.key], seen[f.key]),
        })),
      ),
    current: () => {
      const rows = latestProduct(ctx, p)?.marketing?.paidTest;
      if (!rows) return null;
      const out: Record<string, string> = {};
      for (const [key, row] of shown) {
        const now = sameRow(shownRows, row, rows, kvKey, kvCells);
        if (!now) continue;
        shown.set(key, now);
        out[key] = value(now);
      }
      shownRows = rows;
      return out;
    },
  });
}

/** One plan value for the card, with the check it fails (a start before day 15, a budget over $300). */
function paidValue(p: ProductSnapshot, m: MarketingNote, key: PaidKey, row: KvRow): Child[] {
  const v = row.value.value;
  if (key === "video") {
    const n = v === "" ? null : backlogNumber(v, false);
    const video = n === null ? null : (m.backlog ?? []).find((r) => Number(r.num) === n && isVideoIn(m)(r)) ?? null;
    return [h("span", null, cellOr(row.value, "Not chosen yet"), video ? muted(` · ${formatWords(video)}`) : null)];
  }
  if (key === "start") {
    const check = startDayCheck(v, p.cycleStart);
    return [isDate(v) ? h("span", null, dateText(p, v)) : cellOr(row.value, "Not set yet"), check ? checkLine(check) : null];
  }
  if (key === "budget") {
    const check = budgetCheck(v);
    // A bare number is dollars ("150" shows as $150).
    return [/^\d+(?:\.\d{1,2})?$/.test(v) ? h("span", null, `$${v}`) : cellOr(row.value, "Not set yet"), check ? checkLine(check) : null];
  }
  return [cellOr(row.value, "Not chosen yet")];
}

/** Paid test plan (#nx-sec-paidtest): the video, platform, start date and budget, and one Edit sheet for all of it. */
export function paidTestSection(ctx: Ctx, p: ProductSnapshot): HTMLElement {
  const m = p.marketing;
  const locked = readOnlyLine(p.status);
  const root = sectionRoot(ctx, "paidtest", "paidTest", "Paid test plan");
  if (!m) {
    root.append(noNote(p));
    return root;
  }
  if (locked) root.append(quietLine(locked));
  const rows = m.paidTest;
  if (!rows) {
    root.append(noPart(ctx, p, "Paid test plan", "Paid test", !!locked));
    return root;
  }
  const plan = paidRows(rows);
  const used = new Set(plan.values());
  // Rows a partner added to the plan show as they are; they're edited in the note.
  const extras = rows.filter((r) => !used.has(r) && (r.label !== "" || r.value.value !== ""));
  root.append(
    h(
      "dl",
      { class: "nx-kv" },
      PAID.map((f) => {
        const row = plan.get(f.key);
        return kvRow(f.label, row ? paidValue(p, m, f.key, row) : muted("Not in the note"));
      }),
      extras.map((r) => kvRow(r.label || `Item ${r.index + 1}`, cellOr(r.value, "Not filled in yet"))),
    ),
  );
  if (!locked && plan.size) {
    root.append(h("div", { class: "nx-ed-actions" }, sheetOpener("Edit", () => paidSheet(ctx, p, m, plan), { variant: "ghost", id: `ed:paid:${p.name}:edit`, name: "Edit the paid test plan" })));
  }
  return root;
}
