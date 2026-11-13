// The edit kit every Marketing and Developer section uses: one edit sheet (checks as you type, partner changes
// and conflicts shown inside it, Undo), runEdit for every table or marker write, and the text cards show (green
// examples, safe links). Ops come only from the pure builders in data/marketingOps.ts.

import type { Cell } from "../data/marketing";
import { hookWords, hookWordsCheck, linkParts, stripeCheck } from "../data/marketingOps";
import type { Check } from "../data/marketingOps";
import { ConflictError, RowNotFoundError, TableNotFoundError } from "../data/tableEdit";
import type { TableOp } from "../data/tableEdit";
import type { DocKey, ProductSnapshot } from "../data/types";
import type { Ctx } from "./app";
import { Child, h } from "./dom";
import type { Undo } from "./host";
import { DUR, enter, reducedMotion, replayClass } from "./motion";
import { cancel, openSheet } from "./sheets";
import type { Sheet } from "./sheets";

export interface FieldSpec {
  /** Unique within the sheet; the key of values, changed, seen and current(). */
  key: string;
  /** Always shown above the input. */
  label: string;
  /**
   * "date" is a date picker while the value is empty or YYYY-MM-DD, else a text box (so "day 15" isn't lost).
   * "line" is one line of text that wraps and grows as you type (a hook, a demo shot, a CTA): Enter saves and a
   * pasted line break becomes a space, unless the note's text already has line breaks (then it's a text area).
   */
  kind: "text" | "line" | "textarea" | "select" | "date" | "number" | "url";
  /** What the note holds now, as the form shows it (formValue / splitLink from data/marketingOps). */
  value: string;
  /** The green example, shown as the placeholder exactly as written ("e.g. …"). */
  example?: string;
  options?: { value: string; label: string }[];
  /** A short line under the input. */
  hint?: Child;
  /** Runs as you type. An error blocks Save; a warn shows under the field. Stripe secret keys are refused in every field anyway. */
  check?: (value: string, all: Record<string, string>) => { level: "error" | "warn"; text: string } | null;
  /** Shows "9 of 12 words" (spoken words), and "14 words: aim for 12 or fewer." past the limit. */
  maxWords?: number;
}

export interface EditSheetOpts {
  title: string;
  intro?: Child;
  fields: FieldSpec[];
  /** Default "Save". */
  saveLabel?: string;
  /**
   * Writes the edit (usually runEdit with a marketingOps builder). values: every field, trimmed. changed: the keys
   * that differ from what the user saw. seen: what the user saw per field (the partner's text after "Keep mine"),
   * for the op's expect. Throwing keeps the sheet open with every field as typed and shows the error inside it.
   */
  save: (values: Record<string, string>, changed: string[], seen: Record<string, string>) => Promise<Undo | void>;
  /**
   * The note's values for the fields now, as the form would show them, or null when the thing is gone from the note.
   * Without it the sheet can't notice partner changes while it's open.
   */
  current?: () => Record<string, string> | null;
  /** A destructive action (Delete). It asks `confirm` inside the sheet first; `done` is the toast (default "Deleted"). */
  danger?: { label: string; confirm: string; run: () => Promise<Undo | void>; done?: string };
}

type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

interface FieldUI {
  spec: FieldSpec;
  /** Swapped for a text area when a partner's text has a line break a one-line box can't hold. */
  control: Control;
  /** A text area where Enter makes a new line (kind textarea, or text with line breaks). */
  multiline: boolean;
  wrap: HTMLElement;
  msg: HTMLElement;
  words: HTMLElement | null;
  notes: HTMLElement;
  /** A date picker's green example, shown under it while it's empty (a date picker shows no placeholder). */
  eg: HTMLElement | null;
}

const NOT_SAVED_PARTNER = "Not saved: your partner changed this note while you were editing. Check the notes above, then save again.";
const SAME_AS_PARTNER = "Your partner already saved the same text, so there's nothing left to save.";
const REMOVED = "Your partner just removed this from the note. Your text is still here, so you can copy it.";
const NOT_SAVED_GONE = "Not saved: it's no longer in the note.";
const CAUGHT_UP = "This sheet just caught up with your last save. Check the boxes, then press Save again.";
const HELD = "Still open: you have changes that aren't saved. Press Save, or Cancel to close without saving.";

let seq = 0;

/**
 * Field values this device saved in the last few seconds, by product, sheet and field. Obsidian re-reads a note a
 * moment after a save, so a sheet reopened in between is built from the older text; when the newer text arrives it
 * is our own save, and the sheet takes it without calling it the partner's (U6).
 */
const recentSaves = new Map<string, { value: string; until: number }>();
const RECENT_SAVE_MS = 15_000;

/**
 * The data the dashboard showed when this device last wrote a note through runEdit (a status step, Use in a video,
 * a toast's Undo, …), while the dashboard hasn't read the note again since. A sheet opened from that older data takes
 * the first re-read's text in boxes the user hasn't typed in as our own write, not the partner's (U6).
 */
let staleSince: unknown = null;

/** A button with the dashboard's busy spinner, for actions inside a sheet. */
function sheetButton(label: string, ...cls: string[]): HTMLButtonElement {
  return h(
    "button",
    { class: ["nx-btn", ...cls, "nx-pressable"], type: "button", "aria-label": label },
    h("span", { class: "nx-btn-label" }, label),
    h("span", { class: "nx-btn-spin", "aria-hidden": "true" }),
  );
}

function setBusy(b: HTMLButtonElement, on: boolean): void {
  b.classList.toggle("is-busy", on);
  b.setAttribute("aria-busy", String(on));
  b.disabled = on;
}

/** A text area for `value`: several rows, or one wrapping row that grows with its text ("line"). */
function textArea(base: Record<string, string>, value: string, placeholder: string | undefined, line: boolean): HTMLTextAreaElement {
  const t = h("textarea", { ...base, class: line ? "nx-input nx-input-line" : "nx-input", rows: line ? 1 : 3, placeholder }, value);
  t.value = value;
  return t;
}

/** A one-line text area as tall as its text, so a long hook shows whole at phone width. */
function grow(c: Control): void {
  if (!(c instanceof HTMLTextAreaElement) || !c.classList.contains("nx-input-line")) return;
  c.style.height = "auto";
  if (typeof c.scrollHeight === "number" && c.scrollHeight > 0) c.style.height = `${c.scrollHeight}px`;
}

function buildControl(spec: FieldSpec, id: string, describedBy: string): Control {
  const base = { id, class: "nx-input", autocomplete: "off", "aria-describedby": describedBy };
  const placeholder = spec.example || undefined;
  // A one-line box would drop the line breaks of a cell that has them, so such a cell gets a text area.
  const kind = spec.kind !== "select" && spec.kind !== "date" && spec.value.includes("\n") ? "textarea" : spec.kind;
  switch (kind) {
    case "textarea":
      return textArea(base, spec.value, placeholder, false);
    case "line":
      return textArea(base, spec.value, placeholder, true);
    case "select": {
      const options = spec.options ?? [];
      // A value that isn't one of the options (typed in the note) stays selectable, so opening the sheet never changes it.
      const list = options.some((o) => o.value === spec.value) ? options : [{ value: spec.value, label: spec.value || "Not set" }, ...options];
      const s = h("select", base, list.map((o) => h("option", { value: o.value }, o.label)));
      s.value = spec.value;
      return s;
    }
    case "date": {
      const picker = spec.value === "" || /^\d{4}-\d{2}-\d{2}$/.test(spec.value);
      const input = h("input", { ...base, type: picker ? "date" : "text", value: spec.value, placeholder });
      // A date the picker can't hold would read back as "": keep the text instead.
      if (input.value !== spec.value) {
        input.type = "text";
        input.value = spec.value;
      }
      return input;
    }
    case "number":
      return h("input", { ...base, type: "text", inputmode: "decimal", value: spec.value, placeholder });
    case "url":
      return h("input", { ...base, type: "text", inputmode: "url", autocapitalize: "off", spellcheck: "false", value: spec.value, placeholder });
    default:
      return h("input", { ...base, type: "text", value: spec.value, placeholder });
  }
}

function buildField(spec: FieldSpec): FieldUI {
  const id = `nx-ef-${++seq}`;
  const ids = { hint: `${id}-hint`, eg: `${id}-eg`, words: `${id}-words`, msg: `${id}-msg`, notes: `${id}-notes` };
  // A date picker never shows a placeholder, so its green example (U4) sits under it instead.
  const egLine = spec.kind === "date" && !!spec.example;
  const describedBy = [spec.hint ? ids.hint : "", egLine ? ids.eg : "", spec.maxWords ? ids.words : "", ids.msg, ids.notes].filter(Boolean).join(" ");
  const control = buildControl(spec, id, describedBy);
  const multiline = control instanceof HTMLTextAreaElement && !control.classList.contains("nx-input-line");
  const words = spec.maxWords ? h("span", { class: "nx-ef-words", id: ids.words }) : null;
  const msg = h("p", { class: "nx-ef-msg", id: ids.msg, "aria-live": "polite" });
  const notes = h("div", { class: "nx-ef-notes", id: ids.notes });
  const eg = egLine ? h("span", { class: "nx-field-hint nx-ef-eg", id: ids.eg }, h("span", { class: "nx-eg" }, spec.example)) : null;
  const wrap = h(
    "div",
    { class: "nx-field nx-ef" },
    h("label", { class: "nx-field-label", for: id }, spec.label),
    control,
    eg,
    spec.hint ? h("span", { class: "nx-field-hint", id: ids.hint }, spec.hint) : null,
    words,
    msg,
    notes,
  );
  return { spec, control, multiline, wrap, msg, words, notes, eg };
}

function setMsg(f: FieldUI, c: Check | null): void {
  const text = c?.text ?? "";
  if (f.msg.textContent !== text) f.msg.textContent = text;
  f.msg.classList.toggle("is-error", c?.level === "error");
  f.msg.classList.toggle("is-warn", c?.level === "warn");
  if (c?.level === "error") f.control.setAttribute("aria-invalid", "true");
  else f.control.removeAttribute("aria-invalid");
}

/**
 * Puts `v` in the field's box, first turning the box into one that can hold it, the way buildControl does when a
 * sheet opens: a date picker given text that isn't a date becomes a text box, and a one-line box given a line break
 * becomes a text area (`rewire` adds the sheet's listeners to a new box). Returns false when the box still doesn't
 * show `v` exactly, so the caller never takes it as shown.
 */
function setValue(f: FieldUI, v: string, rewire: (f: FieldUI) => void): boolean {
  let c = f.control;
  if (c instanceof HTMLSelectElement && ![...c.options].some((o) => o.value === v)) c.prepend(h("option", { value: v }, v || "Not set"));
  if (c instanceof HTMLInputElement && c.type === "date" && v !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(v)) c.type = "text";
  if (/[\r\n]/.test(v) && !(c instanceof HTMLSelectElement)) {
    if (c instanceof HTMLInputElement) {
      const base: Record<string, string> = { id: c.id, autocomplete: "off", "aria-describedby": c.getAttribute("aria-describedby") ?? "" };
      const next = textArea(base, v, c.getAttribute("placeholder") || undefined, false);
      if (c.getAttribute("aria-invalid") === "true") next.setAttribute("aria-invalid", "true");
      const focused = document.activeElement === c;
      c.replaceWith(next);
      f.control = next;
      rewire(f);
      if (focused) next.focus();
      c = next;
    } else if (c.classList.contains("nx-input-line")) {
      c.classList.remove("nx-input-line");
      c.rows = 3;
      c.style.height = "";
    }
    f.multiline = true;
  }
  c.value = v;
  grow(c);
  return c.value === v;
}

/** A value as a note quotes it: a select shows its option's label (a rating's word and icon), text on one line. */
function display(f: FieldUI, v: string): string {
  const label = f.spec.kind === "select" ? f.spec.options?.find((o) => o.value === v)?.label : undefined;
  const text = (label ?? v).replace(/\s*\n\s*/g, " ");
  return text.length > 160 ? `${text.slice(0, 157)}…` : text;
}

/**
 * "it now says “Link in bio.”" + the sentence's end: text already in quote marks (a spoken hook) isn't quoted twice,
 * and a quote that ends its own sentence gets no second full stop. "it's empty now." for an empty value.
 */
function nowSays(text: string): string {
  if (text === "") return "it's empty now.";
  const quoted = /^["“'‘][\s\S]*["”'’]$/.test(text) && text.length > 1 ? text : `“${text}”`;
  return `it now says ${quoted}${/[.!?…]["”'’]$/.test(quoted) ? "" : "."}`;
}

const isConflict = (e: unknown): boolean => e instanceof ConflictError || (e instanceof Error && e.name === "ConflictError");

/**
 * Opens one edit sheet (U5). Examples are placeholders; checks run as you type; Save is off while saving, while
 * nothing changed and while a field has an error. On success the sheet closes and a toast says "Saved" with Undo.
 * On an error the sheet stays with every typed value and says what went wrong inside it. While it's open it
 * watches for partner changes (U6) through current(), and stops watching once Save starts.
 */
export function editSheet(ctx: Ctx, opts: EditSheetOpts): void {
  // A tap on the dimmed area never throws typed text away (U5); Cancel, ✕ and Escape still close on purpose.
  const guard: { held: () => boolean } = { held: () => false };
  openSheet(ctx, opts.title, (sheet) => buildEditSheet(ctx, opts, sheet, guard), { canDismiss: () => !guard.held() });
}

function buildEditSheet(ctx: Ctx, opts: EditSheetOpts, sheet: Sheet, guard: { held: () => boolean }): HTMLElement[] {
  const panel = sheet.body.parentElement;
  panel?.classList.add("nx-edit-sheet");
  const fields = opts.fields.map(buildField);
  /** What the user saw per field: the note's text when the sheet opened, or the partner's after "Keep mine". */
  const seen: Record<string, string> = Object.fromEntries(fields.map((f) => [f.spec.key, f.spec.value.trim()]));
  /** The partner text each open note offers, so a repeat of the same data doesn't redraw it. */
  const pending = new Map<string, string>();
  let saving = false;
  let stop: (() => void) | null = null;
  const route = ctx.app.route;
  const memoKey = (k: string) => `${route.level === "product" ? route.name : ""}\u0000${opts.title}\u0000${k}`;
  /** Fields the user typed in or picked from. Only these count as changed, so a box that can't show the note's text exactly never writes over it. */
  const dirty = new Set<string>();
  /** Opened from data older than this device's last write: the first re-read may hold that write (U6). */
  let ownWriteBehind = staleSince !== null && ctx.app.data === staleSince;

  const notice = h("p", { class: "nx-ef-notice", role: "status" });
  const alert = h("div", { class: "nx-ef-alert", role: "alert" });
  const saveBtn = sheetButton(opts.saveLabel ?? "Save", "nx-btn-primary");
  const actions = h("div", { class: "nx-sheet-actions" }, saveBtn, cancel(sheet));

  const read = (f: FieldUI) => f.control.value.trim();
  const readAll = (): Record<string, string> => Object.fromEntries(fields.map((f) => [f.spec.key, read(f)]));
  const changedKeys = (all: Record<string, string>) => fields.map((f) => f.spec.key).filter((k) => dirty.has(k) && all[k] !== seen[k]);
  const put = (f: FieldUI, v: string): boolean => setValue(f, v, wire);
  const checkOf = (f: FieldUI, v: string, all: Record<string, string>): Check | null => stripeCheck(v) ?? f.spec.check?.(v, all) ?? null;
  const setAlert = (text: string) => {
    if (alert.textContent !== text) alert.textContent = text;
  };

  const refresh = (): void => {
    const all = readAll();
    const changed = changedKeys(all);
    let blocked = false;
    for (const f of fields) {
      const v = all[f.spec.key];
      const c = checkOf(f, v, all);
      // Only a field the save writes can block it: the note's own text elsewhere (a handle with "live_" in it) can't.
      if (c?.level === "error" && changed.includes(f.spec.key)) blocked = true;
      setMsg(f, c);
      if (f.eg) f.eg.hidden = v !== "" || !(f.control instanceof HTMLInputElement && f.control.type === "date");
      if (f.words && f.spec.maxWords) {
        const over = hookWordsCheck(v, f.spec.maxWords);
        const text = over ? over.text : `${hookWords(v)} of ${f.spec.maxWords} words`;
        if (f.words.textContent !== text) f.words.textContent = text;
        f.words.classList.toggle("is-over", !!over);
      }
    }
    saveBtn.disabled = saving || blocked || changed.length === 0;
  };

  const lock = (on: boolean) => {
    for (const f of fields) {
      if (f.control instanceof HTMLSelectElement) f.control.disabled = on;
      else f.control.readOnly = on;
    }
  };

  const setNote = (f: FieldUI, el: HTMLElement | null, theirs?: string) => {
    if (theirs === undefined) pending.delete(f.spec.key);
    else pending.set(f.spec.key, theirs);
    f.notes.replaceChildren(...(el ? [el] : []));
    if (el) enter(el, DUR.fast);
    // Every partner note answered: "check the notes above" no longer applies.
    if (pending.size === 0 && alert.textContent === NOT_SAVED_PARTNER) setAlert("");
  };

  const partnerNote = (f: FieldUI, theirs: string): HTMLElement => {
    const k = f.spec.key;
    const use = sheetButton("Use theirs", "nx-btn-quiet");
    const keep = sheetButton("Keep mine", "nx-btn-quiet");
    use.addEventListener("click", () => {
      if (!put(f, theirs)) return;
      seen[k] = theirs;
      setNote(f, null);
      refresh();
      f.control.focus();
    });
    keep.addEventListener("click", () => {
      // Saving now overwrites the partner's text knowingly.
      seen[k] = theirs;
      setNote(f, null);
      refresh();
      f.control.focus();
    });
    return h(
      "div",
      { class: "nx-ef-partner", role: "alert" },
      h("p", null, `Your partner just changed ${f.spec.label}: ${nowSays(display(f, theirs))} Your text is still here.`),
      h("div", { class: "nx-ef-partner-actions" }, use, keep),
    );
  };

  /**
   * Compares the note's values with what the user saw. A field the user hasn't touched takes the partner's text
   * (nothing typed is lost); a field the user typed the same into just moves on; any other asks Use theirs / Keep mine.
   * Text this device saved into the same field a moment ago is our own save read back late: taken without a note.
   */
  const partnerChanges = (fresh: Record<string, string>, ownWrite = false): { asked: number; adopted: number; same: number; ours: number } => {
    const r = { asked: 0, adopted: 0, same: 0, ours: 0 };
    for (const f of fields) {
      const k = f.spec.key;
      if (fresh[k] === undefined) continue;
      const theirs = fresh[k].trim();
      if (theirs === seen[k]) {
        if (pending.has(k)) setNote(f, null);
        continue;
      }
      const mine = read(f);
      // Untouched: nothing typed or picked there (a box that couldn't show the note's text exactly counts as untouched).
      const untouched = !dirty.has(k) || mine === seen[k];
      const ours = recentSaves.get(memoKey(k));
      if ((ours && ours.until > Date.now() && ours.value === theirs) || (ownWrite && untouched)) {
        if (untouched && !put(f, theirs)) {
          if (pending.get(k) !== theirs) setNote(f, partnerNote(f, theirs), theirs);
          r.asked++;
          continue;
        }
        seen[k] = theirs;
        if (untouched) dirty.delete(k);
        if (pending.has(k)) setNote(f, null);
        r.ours++;
      } else if (dirty.has(k) && mine === theirs) {
        seen[k] = theirs;
        setNote(f, null);
        r.same++;
      } else if (untouched) {
        // A box that can't show their text exactly isn't taken as showing it: Use theirs / Keep mine instead.
        if (!put(f, theirs)) {
          if (pending.get(k) !== theirs) setNote(f, partnerNote(f, theirs), theirs);
          r.asked++;
          continue;
        }
        seen[k] = theirs;
        dirty.delete(k);
        setNote(f, h("p", { class: "nx-ef-info", role: "status" }, `Your partner just changed ${f.spec.label}, so it now shows their text.`));
        r.adopted++;
      } else {
        if (pending.get(k) !== theirs) setNote(f, partnerNote(f, theirs), theirs);
        r.asked++;
      }
    }
    refresh();
    return r;
  };

  const readCurrent = (): Record<string, string> | null | undefined => {
    try {
      return opts.current ? opts.current() : undefined;
    } catch {
      return undefined;
    }
  };

  /** The "removed" line shows while the thing is gone from the note, and leaves if a partner puts it back. */
  const showRemoved = (gone: boolean) => {
    const text = gone ? REMOVED : "";
    if (notice.textContent !== text) notice.textContent = text;
  };

  const scrollToNote = () => {
    const el = panel?.querySelector<HTMLElement>(".nx-ef-partner, .nx-ef-info");
    el?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "nearest" });
  };

  const unlisten = () => {
    stop?.();
    stop = null;
  };

  const listen = () => {
    if (!opts.current || stop) return;
    stop = ctx.app.onData(() => {
      if (sheet.closed) return unlisten();
      if (saving) return;
      const fresh = readCurrent();
      if (fresh === undefined) return;
      const ownWrite = ownWriteBehind;
      ownWriteBehind = false;
      showRemoved(fresh === null);
      if (fresh) partnerChanges(fresh, ownWrite);
    });
  };

  /** Says inside the sheet why a save or delete didn't happen. A partner's conflicting change gets its field notes (U6). */
  const fail = (e: unknown) => {
    // Closed while it was saving (✕, Escape or Cancel; the sheet may still be fading out): a toast is the only place left.
    if (sheet.closed) {
      const why = plainError(e);
      ctx.app.toast(/^Not saved\b/.test(why) ? why : `Not saved: ${why}`, { tone: "error" });
      return;
    }
    // The data may have caught up with the note while it was saving (the sheet wasn't listening then).
    const fresh = readCurrent();
    if (fresh !== undefined) showRemoved(fresh === null);
    if (fresh === null && isConflict(e)) {
      setAlert(NOT_SAVED_GONE);
      return;
    }
    const r = fresh ? partnerChanges(fresh) : null;
    if (r && isConflict(e)) {
      if (r.asked + r.adopted > 0) {
        setAlert(NOT_SAVED_PARTNER);
        scrollToNote();
        return;
      }
      if (r.same > 0 && changedKeys(readAll()).length === 0) {
        setAlert(SAME_AS_PARTNER);
        return;
      }
      if (r.ours > 0) {
        setAlert(CAUGHT_UP);
        return;
      }
    }
    setAlert(plainError(e));
  };

  const save = async (): Promise<void> => {
    if (saving) return;
    refresh();
    const values = readAll();
    const changed = changedKeys(values);
    if (saveBtn.disabled) {
      if (changed.length) {
        replayClass(saveBtn, "nx-shake", 400);
        fields.find((f) => f.control.getAttribute("aria-invalid") === "true")?.control.focus();
      }
      return;
    }
    saving = true;
    unlisten();
    setBusy(saveBtn, true);
    lock(true);
    setAlert("");
    try {
      const undo = await opts.save(values, changed, { ...seen });
      const now = Date.now();
      for (const [k, v] of recentSaves) if (v.until <= now) recentSaves.delete(k);
      for (const k of changed) recentSaves.set(memoKey(k), { value: values[k], until: now + RECENT_SAVE_MS });
      sheet.close();
      ctx.app.toast("Saved", typeof undo === "function" ? { undo } : {});
    } catch (e) {
      saving = false;
      setBusy(saveBtn, false);
      lock(false);
      listen();
      fail(e);
      refresh();
    }
  };

  saveBtn.addEventListener("click", () => void save());
  function wire(f: FieldUI): void {
    const el: HTMLElement = f.control;
    const edited = () => {
      // A one-line box keeps one line: a pasted line break becomes a space, as in a one-line input.
      const c = f.control;
      if (!f.multiline && c instanceof HTMLTextAreaElement && /[\r\n]/.test(c.value)) {
        const at = c.selectionStart;
        c.value = c.value.replace(/\r\n|\r|\n/g, " ");
        if (typeof at === "number") c.setSelectionRange?.(at, at);
      }
      grow(c);
      dirty.add(f.spec.key);
      refresh();
    };
    el.addEventListener("input", edited);
    el.addEventListener("change", edited);
    // Enter saves from a one-line box; in a text area it's a new line, and Cmd/Ctrl+Enter saves.
    el.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || e.isComposing || f.control instanceof HTMLSelectElement) return;
      if (f.multiline && !(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      void save();
    });
  }
  for (const f of fields) wire(f);

  const out: HTMLElement[] = [];
  if (opts.intro !== undefined && opts.intro !== null && opts.intro !== false) {
    out.push(h("div", { class: "nx-ef-intro" }, typeof opts.intro === "string" ? h("p", { class: "nx-muted" }, opts.intro) : opts.intro));
  }
  out.push(...fields.map((f) => f.wrap), notice, alert, actions);

  const danger = opts.danger;
  if (danger) {
    const ask = h("button", { class: "nx-btn nx-btn-ghost nx-ef-danger nx-pressable", type: "button" }, danger.label);
    const yes = sheetButton(danger.label, "nx-btn-primary", "nx-ef-yes");
    const no = h("button", { class: "nx-btn nx-btn-ghost nx-pressable", type: "button" }, "Cancel");
    const confirm = h("div", { class: "nx-ef-confirm", hidden: true }, h("p", null, danger.confirm), h("div", { class: "nx-ef-confirm-actions" }, yes, no));
    const showConfirm = (on: boolean) => {
      confirm.hidden = !on;
      actions.hidden = on;
      (on ? yes : ask).focus();
    };
    ask.addEventListener("click", () => {
      setAlert("");
      showConfirm(true);
    });
    no.addEventListener("click", () => showConfirm(false));
    yes.addEventListener("click", async () => {
      if (saving) return;
      saving = true;
      unlisten();
      setBusy(yes, true);
      lock(true);
      setAlert("");
      try {
        const undo = await danger.run();
        sheet.close();
        ctx.app.toast(danger.done ?? "Deleted", typeof undo === "function" ? { undo } : {});
      } catch (e) {
        saving = false;
        setBusy(yes, false);
        lock(false);
        listen();
        showConfirm(false);
        fail(e);
        refresh();
      }
    });
    actions.append(ask);
    out.push(confirm);
  }

  guard.held = () => {
    if (saving || changedKeys(readAll()).length === 0) return saving;
    setAlert(HELD);
    return true;
  };

  listen();
  refresh();
  // After openSheet's own focus, so a sheet that starts with a text area focuses it too. The growing boxes take
  // their text's height once they're on screen.
  window.setTimeout(() => {
    fields.forEach((f) => grow(f.control));
    fields[0]?.control.focus({ preventScroll: true });
  }, 40);
  return out;
}

/**
 * Applies one op to one note (U1): the Undo comes back for ctx.button or the toast to offer. About 2 s later, if
 * the note no longer holds the edit (Relay merged a partner's change into it), a toast says so with "Open note".
 * The Undo fails in plain words: the toast says "Undo failed: …" without the data layer's own wording.
 */
export async function runEdit(ctx: Ctx, p: ProductSnapshot, doc: DocKey, op: TableOp, out?: { inverse?: TableOp }): Promise<Undo> {
  const done = await wrote(ctx, () => ctx.host.editTable(p, doc, op));
  if (out) out.inverse = done.inverse;
  done.settled.then(
    (warning) => {
      if (warning) ctx.app.toast(warning, { tone: "warn", action: { label: "Open note", run: () => ctx.openDoc(p, doc) } });
    },
    () => undefined,
  );
  const undo = done.undo;
  return async () => {
    try {
      await wrote(ctx, undo);
    } catch (e) {
      throw new Error(undoFailure(e));
    }
  };
}

/** Runs one write; when the dashboard hasn't read the note again by the time it's done, its data is older than the note (U6). */
async function wrote<T>(ctx: Ctx, write: () => Promise<T>): Promise<T> {
  const before = ctx.app.data;
  const r = await write();
  if (ctx.app.data === before) staleSince = before;
  return r;
}

/** The number a table write gave its line ("#"), read from its Undo op; null when it has none. */
export function writtenNumber(inverse: TableOp | undefined): string | null {
  const row = inverse?.kind === "delete" ? inverse.expect : inverse?.kind === "set" ? inverse.edits[0]?.expect : undefined;
  const key = row ? Object.keys(row).find((k) => k.trim() === "#") : undefined;
  const n = key && row ? row[key].trim() : "";
  return /^\d+$/.test(n) ? n : null;
}

/**
 * An edit sheet's one write. When its line or its part of the note is gone (a partner deleted it, or renamed the
 * heading), the sheet says `gone` in plain words. A conflict is thrown as it is, so the sheet can show the
 * partner's change next to the field (U6).
 */
export async function sheetWrite(ctx: Ctx, p: ProductSnapshot, doc: DocKey, op: TableOp, gone: string): Promise<Undo> {
  try {
    return await runEdit(ctx, p, doc, op);
  } catch (e) {
    throw isGone(e) ? new Error(gone) : e;
  }
}

/** Why an Undo didn't go through, after "Undo failed: ". */
export function undoFailure(e: unknown): string {
  // A line that can't go back says why itself (it's back already, or its number went to another line since).
  if (isConflict(e) && (e as ConflictError).field === "" && (e as Error).message) return (e as Error).message;
  if (isConflict(e)) return "it changed again since, so it was left as it is. Open the note to check.";
  if (isGone(e)) return "it's no longer in the note, so there was nothing to put back. Open the note to check.";
  return plainError(e);
}

/** A line or a part of the note that an op names is gone (RowNotFoundError, TableNotFoundError). */
export const isGone = (e: unknown): boolean =>
  e instanceof RowNotFoundError || e instanceof TableNotFoundError || (e instanceof Error && (e.name === "RowNotFoundError" || e.name === "TableNotFoundError"));

/** An empty cell's green example (U4), or null when the cell has text or no example. */
export function exampleText(c: Cell): HTMLElement | null {
  return c.value === "" && c.example !== "" ? h("span", { class: "nx-eg" }, c.example) : null;
}

/** A cell for a card: its text with links as safe new-tab links, or its green example when it's empty. */
export function cellText(c: Cell): Child {
  if (c.value === "") return exampleText(c);
  return h(
    "span",
    { class: "nx-cell-text" },
    linkParts(c.value).map((part) => (part.url ? h("a", { class: "nx-link nx-cell-link", href: part.url, target: "_blank", rel: "noopener" }, part.text) : part.text)),
  );
}

/**
 * An error in plain words for the open sheet: a conflict's own message; a missing part or line also says where to
 * look. The data layer words these for a partner (no "table" or "row"); a sheet that knows what it edits says it
 * more plainly still through sheetWrite.
 */
export function plainError(e: unknown): string {
  if (isConflict(e)) return (e as Error).message;
  if (isGone(e)) return `${(e as Error).message} Open the note to check.`;
  if (e instanceof Error && e.message.trim() !== "") return e.message;
  if (typeof e === "string" && e.trim() !== "") return e;
  return "That didn't go through. Open the note to check.";
}
