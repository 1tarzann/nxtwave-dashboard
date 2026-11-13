// A DashboardApp on the fake DOM with Demo_Tool's sample notes and an in-memory host that writes through the real
// table editor, the way ObsidianHost.editTable does. `deferMs` delays the re-read after a write (Obsidian reloads a
// note at least 250 ms after it changes); without it the dashboard re-reads at once, like the preview.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { FElement, fakeDocument, installFakeDom, visibleText } from "./fakedom";

installFakeDom();

export interface Scenario {
  marketing: string | null;
  spec: string;
  status?: string;
  today?: string;
  deferMs?: number;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function makeApp(sc: Scenario) {
  // Imported after the fake DOM is in place.
  const S = await import("../samples");
  const { buildSnapshot } = await import("../../src/data/snapshot");
  const { applyTableOp } = await import("../../src/data/tableEdit");
  const { DEFAULT_THRESHOLDS, DOC_FILES, DOC_ORDER } = await import("../../src/data/types");
  const { DashboardApp } = await import("../../src/ui/app");
  const today = sc.today ?? "2026-11-21";
  const name = "Demo_Tool";
  const folder = `HQ/02_Active_Sprints/${name}`;
  const pathOf = (doc: string) => `${folder}/${(DOC_FILES as any)[doc]}.md`;
  const vault = new Map<string, string>();
  if (sc.marketing !== null) vault.set(pathOf("marketing"), sc.marketing);
  vault.set(pathOf("spec"), sc.spec);
  const raw = (doc: string) => {
    const t = vault.get(pathOf(doc));
    return t === undefined ? undefined : { path: pathOf(doc), frontmatter: S.frontmatterOf(t), body: t, mtime: 0 };
  };
  const toasts: Array<{ message: string; opts: any }> = [];
  const edits: any[] = [];
  const snapshot = () => {
    const s = buildSnapshot(name, folder, { marketing: raw("marketing"), spec: raw("spec") } as any, { path: `${folder}/${name}_Hub.md`, frontmatter: {}, body: "", mtime: 0 });
    return { ...s, warnings: [], status: sc.status ?? "building", cycleStart: "2026-11-13", paths: Object.fromEntries(DOC_ORDER.map((k: string) => [k, pathOf(k)])) };
  };
  const data = () => ({ hqRoot: "HQ", today, thresholds: DEFAULT_THRESHOLDS, archive: { scaled: [], killed: [] }, ideas: [], categories: [], setup: [], businessModel: [], products: [snapshot()] });
  let app: any;
  const reread = () => (sc.deferMs === undefined ? app.setData(data()) : setTimeout(() => app.setData(data()), sc.deferMs));
  const host: any = {
    version: "test",
    prefs: { role: "both", guideSeen: true },
    savePrefs: async () => undefined,
    openDoc: () => undefined,
    openPath: () => undefined,
    copy: async () => undefined,
    socialKit: () => ({ ok: false, reason: "no kit", minGapHours: 6 }),
    calls: [] as Array<[string, unknown]>,
    setField: async (...args: unknown[]) => {
      host.calls.push(["setField", args]);
      return async () => undefined;
    },
    setFields: async (...args: unknown[]) => {
      host.calls.push(["setFields", args]);
      return async () => undefined;
    },
    createSprint: async (...args: unknown[]) => {
      host.calls.push(["createSprint", args]);
      return "Acme";
    },
    editTable: async (p: any, doc: string, op: any) => {
      edits.push(op);
      const path = p.paths[doc];
      const r = applyTableOp(vault.get(path)!, op);
      vault.set(path, r.text);
      reread();
      return {
        inverse: r.inverse,
        settled: Promise.resolve(null),
        undo: async () => {
          const r2 = applyTableOp(vault.get(path)!, r.inverse);
          vault.set(path, r2.text);
          reread();
        },
      };
    },
  };
  const container = fakeDocument.createElement("div");
  fakeDocument.body.replaceChildren(container);
  app = new DashboardApp(container as any, host);
  const toast = app.toast.bind(app);
  app.toast = (message: string, opts: any = {}) => {
    toasts.push({ message, opts });
    return toast(message, opts);
  };
  app.setData(data());
  /** A partner's edit: the note changes and the dashboard re-reads it. */
  const partner = (fn: (note: string) => string, doc = "marketing") => {
    vault.set(pathOf(doc), fn(vault.get(pathOf(doc))!));
    app.setData(data());
  };
  const root = app.root as FElement;
  const overlay = app.overlay as FElement;
  const fields = () => overlay.querySelectorAll(".nx-ef");
  const control = (label: string) => fields().find((f) => f.querySelector("label")!.textContent === label)?.querySelector("input, textarea, select") as any;
  const button = (label: string) =>
    overlay.querySelectorAll("button").find((b) => b.textContent.trim() === label || (b.querySelector(".nx-btn-label")?.textContent ?? "") === label) as any;
  const type = (el: any, v: string) => {
    el.value = v;
    el.dispatch("input");
  };
  const open = async (fb: string) => {
    const b = root.querySelector(`[data-fb="${fb}"]`);
    if (!b) throw new Error(`no ${fb}`);
    b.focus();
    b.click();
    await sleep(60);
  };
  const note = () => vault.get(pathOf("marketing"))!;
  const notes = () => fields().map((f) => visibleText(f.querySelector(".nx-ef-notes")!)).filter(Boolean);
  return { app, host, vault, toasts, edits, data, pathOf, partner, root, overlay, control, button, type, open, note, notes, S, destroy: () => app.destroy() };
}
