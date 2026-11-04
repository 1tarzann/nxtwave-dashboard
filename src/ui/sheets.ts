// Small in-view dialogs: Start Day 1, Connect a handle, and the New Sprint wizard.

import { addDays, longDate } from "../data/dates";
import { activeProducts } from "../data/status";
import { sanitizeName, NewSprintInput } from "../data/templates";
import { DocKey, LinkRef, ProductSnapshot } from "../data/types";
import type { Ctx } from "./app";
import { clear, Child, h } from "./dom";
import { Undo } from "./host";
import { reducedMotion, replayClass } from "./motion";

interface Sheet {
  close(): void;
  body: HTMLElement;
}

export function openSheet(ctx: Ctx, title: string, build: (sheet: Sheet) => Child): Sheet {
  const overlay = ctx.app.overlay;
  clear(overlay);
  const panel = h("div", { class: "nx-sheet", role: "dialog", "aria-modal": "true", "aria-label": title });
  const closeBtn = h("button", { class: "nx-sheet-close nx-pressable", type: "button", "aria-label": "Close" }, "✕");
  const body = h("div", { class: "nx-sheet-body" });
  const previousFocus = document.activeElement as HTMLElement | null;
  let closed = false;
  const sheet: Sheet = {
    body,
    close: () => {
      if (closed) return;
      closed = true;
      overlay.classList.add("is-leaving");
      window.setTimeout(() => {
        overlay.hidden = true;
        overlay.classList.remove("is-leaving");
        clear(overlay);
        // The opener may have been replaced by a re-render while the sheet was open.
        (previousFocus?.isConnected ? previousFocus : ctx.app.root).focus({ preventScroll: true });
      }, reducedMotion() ? 0 : 160);
    },
  };
  closeBtn.addEventListener("click", sheet.close);
  overlay.onclick = (e) => {
    if (e.target === overlay) sheet.close();
  };
  panel.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      sheet.close();
    }
  });
  panel.append(h("div", { class: "nx-sheet-head" }, h("h3", null, title), closeBtn), body);
  const content = build(sheet);
  if (Array.isArray(content)) content.forEach((c) => c instanceof Node && body.append(c));
  else if (content instanceof Node) body.append(content);
  overlay.append(panel);
  overlay.hidden = false;
  window.setTimeout(() => (panel.querySelector<HTMLElement>("input, select, button.nx-btn-primary") ?? closeBtn).focus(), 30);
  return sheet;
}

function field(label: string, input: HTMLElement, hint?: Child): HTMLElement {
  return h("label", { class: "nx-field" }, h("span", { class: "nx-field-label" }, label), input, hint ? h("span", { class: "nx-field-hint" }, hint) : null);
}

/** Opens the confirm sheet. The returned promise resolves right away; the sheet's own button gives feedback. */
export async function confirmStartDay1(ctx: Ctx, p: ProductSnapshot): Promise<void> {
  const today = ctx.today;
  const other = activeProducts(ctx.data.products).filter((x) => x.name !== p.name);
  openSheet(ctx, `Start ${p.displayName}'s 28-day clock?`, (sheet) => [
    h(
      "dl",
      { class: "nx-summary" },
      h("div", null, h("dt", null, "Day 1"), h("dd", null, longDate(today))),
      h("div", null, h("dt", null, "Launch gate (day 14)"), h("dd", null, longDate(addDays(today, 13)))),
      h("div", null, h("dt", null, "Verdict (day 28)"), h("dd", null, longDate(addDays(today, 27)))),
    ),
    h("p", { class: "nx-muted" }, `Sets Day 1 to today in ${p.displayName}'s hub note and all 6 notes, so the 28-day countdown starts. You can undo it for 5 seconds.`),
    other.length
      ? h("p", { class: "nx-error-box", role: "alert" }, `${other.map((o) => o.displayName).join(", ")} is still active. One sprint at a time: finish its day-28 verdict first.`)
      : null,
    h(
      "div",
      { class: "nx-sheet-actions" },
      ctx.button({
        id: `sheet:start:${p.name}`,
        label: "Start Day 1",
        doneLabel: "Clock started",
        onClick: async (): Promise<Undo> => {
          const undo = await ctx.host.startDay1(p);
          window.setTimeout(sheet.close, 700);
          return undo;
        },
      }),
      cancel(sheet),
    ),
  ]);
}

function cancel(sheet: Sheet): HTMLElement {
  const b = h("button", { class: "nx-btn nx-btn-ghost nx-pressable", type: "button" }, "Cancel");
  b.addEventListener("click", sheet.close);
  return b;
}

export function connectSheet(ctx: Ctx, p: ProductSnapshot, doc: DocKey, key: string, label: string, placeholder: string): void {
  openSheet(ctx, `Connect ${label}`, (sheet) => {
    const input = h("input", { class: "nx-input", type: "text", placeholder, autocomplete: "off", spellcheck: "false" });
    const save = ctx.button({
      id: `sheet:connect:${p.name}:${key}`,
      label: "Save",
      doneLabel: "Connected",
      onClick: async () => {
        const v = input.value.trim();
        if (!v) {
          replayClass(input, "nx-shake", 400);
          throw new Error(`Type the ${label} first.`);
        }
        const undo = await ctx.host.setField(p, doc, key, v);
        window.setTimeout(sheet.close, 700);
        return undo;
      },
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") (save.querySelector("button") as HTMLButtonElement).click();
    });
    return [field(label, input, `Saved in ${p.displayName}'s ${doc === "spec" ? "Dev Spec" : "Marketing Engine"} note. You can undo it for 5 seconds.`), h("div", { class: "nx-sheet-actions" }, save, cancel(sheet))];
  });
}

export function newSprintWizard(ctx: Ctx, prefill: { name?: string; originIdea?: LinkRef } = {}): void {
  const active = activeProducts(ctx.data.products);
  openSheet(ctx, "🚀 Launch new 28-day sprint", (sheet) => {
    const name = h("input", { class: "nx-input", type: "text", placeholder: "e.g. VocalChain AI", value: prefill.name ?? "", autocomplete: "off" });
    const folderHint = h("span", null);
    const updateHint = () => {
      const f = sanitizeName(name.value);
      const exists = ctx.data.products.some((p) => p.name.toLowerCase() === f.toLowerCase());
      folderHint.textContent = f ? `Creates the folder 02_Active_Sprints/${f} with a hub note and the 6 standard notes${exists ? " · ⚠ a product with this name already exists" : ""}` : "Letters, numbers and spaces";
      folderHint.classList.toggle("is-bad", exists);
    };
    name.addEventListener("input", updateHint);
    updateHint();

    const types = [...new Set(ctx.data.products.map((p) => p.productType).filter(Boolean))];
    const type = h("input", { class: "nx-input", type: "text", list: "nx-types", placeholder: "e.g. VST audio plugin" });
    const typeList = h("datalist", { id: "nx-types" }, types.map((t) => h("option", { value: t })));
    const category = h(
      "select",
      { class: "nx-input" },
      h("option", { value: "" }, "None yet"),
      ctx.data.categories.map((c) => h("option", { value: c.path }, c.title)),
    );
    const pitch = h("input", { class: "nx-input", type: "text", placeholder: "Auto-mixes rap vocals in one knob" });
    const mechs = [1, 2, 3].map((n) => h("input", { class: "nx-input", type: "text", placeholder: `Mechanic ${n}` }));
    const tiktok = h("input", { class: "nx-input", type: "text", placeholder: "@handle" });
    const instagram = h("input", { class: "nx-input", type: "text", placeholder: "@handle" });
    const youtube = h("input", { class: "nx-input", type: "text", placeholder: "@handle" });
    const repo = h("input", { class: "nx-input", type: "text", placeholder: "https://github.com/…" });
    const startNow = h("input", { type: "checkbox" }) as HTMLInputElement;
    if (active.length) startNow.disabled = true;

    const create = ctx.button({
      id: "sheet:create",
      label: "⚡ Create project & files",
      doneLabel: "Created",
      onClick: async () => {
        if (!sanitizeName(name.value)) {
          replayClass(name, "nx-shake", 400);
          name.focus();
          throw new Error("Give the product a name first.");
        }
        const cat = ctx.data.categories.find((c) => c.path === category.value) ?? null;
        const input: NewSprintInput = {
          name: name.value,
          productType: type.value,
          pitch: pitch.value,
          mechanics: mechs.map((m) => m.value),
          tiktok: tiktok.value,
          instagram: instagram.value,
          youtube: youtube.value,
          repoUrl: repo.value,
          category: cat,
          originIdea: prefill.originIdea ?? null,
        };
        const folder = await ctx.host.createSprint(input, startNow.checked && !active.length);
        window.setTimeout(() => {
          sheet.close();
          ctx.app.toast(`Created ${folder.replace(/_/g, " ")} · ${startNow.checked && !active.length ? "Day 1 started" : "queued"}`, {
            action: { label: "Open", run: () => ctx.go({ level: "product", name: folder, tab: "overview" }) },
          });
        }, 700);
      },
    });

    return [
      h("p", { class: "nx-step" }, "1 · Basics"),
      field("Product name", name, folderHint),
      h("div", { class: "nx-row2" }, field("Type", h("span", null, type, typeList)), field("Category", category)),
      field("One-line pitch", pitch),
      h("p", { class: "nx-step" }, "2 · Socials (optional, add anytime)"),
      h("div", { class: "nx-row3" }, field("TikTok", tiktok), field("Instagram", instagram), field("YouTube", youtube)),
      h("p", { class: "nx-step" }, "3 · MVP setup (max 3 core mechanics)"),
      ...mechs.map((m, i) => field(`Mechanic ${i + 1}`, m)),
      field("GitHub repo (optional)", repo),
      h(
        "label",
        { class: ["nx-check-row", active.length > 0 && "is-disabled"] },
        startNow,
        h(
          "span",
          null,
          active.length
            ? `Created as queued: ${active.map((a) => a.displayName).join(", ")} is the active sprint (one at a time).`
            : "Start Day 1 today (sets building + cycle_start)",
        ),
      ),
      prefill.originIdea ? h("p", { class: "nx-muted" }, `Linked to idea: ${prefill.originIdea.title}. The idea note isn't moved; archive it yourself when you're ready.`) : null,
      h("div", { class: "nx-sheet-actions" }, create, cancel(sheet)),
    ];
  });
}

/** One sheet for all social handles (the "Create the accounts" quest). */
export async function handlesSheet(ctx: Ctx, p: ProductSnapshot): Promise<void> {
  const apps: [string, "tiktok" | "instagram" | "youtube" | "x"][] = [
    ["TikTok", "tiktok"],
    ["Instagram", "instagram"],
    ["YouTube", "youtube"],
    ...(p.hasXField ? ([["X", "x"]] as [string, "x"][]) : []),
  ];
  openSheet(ctx, `${p.displayName}: paste the social handles`, (sheet) => {
    const inputs = apps.map(([label, key]) => {
      const input = h("input", { class: "nx-input", type: "text", placeholder: "@handle", value: p.handles[key], autocomplete: "off", spellcheck: "false" });
      return { key, input, el: field(label, input) };
    });
    const save = ctx.button({
      id: `sheet:handles:${p.name}`,
      label: "Save handles",
      doneLabel: "Saved",
      onClick: async () => {
        const values: Record<string, string> = {};
        for (const { key, input } of inputs) if (input.value.trim() !== p.handles[key]) values[key] = input.value.trim();
        if (!Object.keys(values).length) throw new Error("Nothing changed. Paste at least one handle.");
        const undo = await ctx.host.setFields(p, "marketing", values);
        window.setTimeout(sheet.close, 700);
        return undo;
      },
    });
    return [
      h("p", { class: "nx-muted" }, "Create each account in its app first (Claude can't: each one needs a phone number and a login). Leave a box empty if that account doesn't exist yet."),
      ...inputs.map((i) => i.el),
      h("p", { class: "nx-muted" }, `Saved in ${p.displayName}'s Marketing Engine note. You can undo it for 5 seconds.`),
      h("div", { class: "nx-sheet-actions" }, save, cancel(sheet)),
    ];
  });
}

/** Asks before refreshing again soon: each refresh is a visit to the apps, and frequent visits raise ban risk. */
export async function confirmRefreshSheet(ctx: Ctx, p: ProductSnapshot, ago: string, run: () => Promise<void>): Promise<void> {
  openSheet(ctx, "Refresh again so soon?", (sheet) => [
    h("p", null, `${p.displayName}'s TikTok and Instagram numbers were refreshed ${ago}.`),
    h(
      "p",
      { class: "nx-muted" },
      "Each refresh opens the apps the way a person would. Doing it many times a day makes the apps more likely to flag a product account. Once or twice a day is plenty.",
    ),
    h(
      "div",
      { class: "nx-sheet-actions" },
      ctx.button({
        id: `sheet:refresh:${p.name}`,
        label: "Refresh anyway",
        doneLabel: "Updated",
        onClick: async () => {
          await run();
          window.setTimeout(sheet.close, 700);
        },
      }),
      cancel(sheet),
    ),
  ]);
}
