// The dashboard shell: routing, top bar, toasts, sheets, keyboard, and the memory that drives
// microinteractions (what changed since the last render).

import { activeProducts, computeStatus } from "../data/status";
import { computeTotals } from "../data/snapshot";
import { ActionRef, DashboardData, DocKey, ProductSnapshot, StatusKey, StatusResult, Totals } from "../data/types";
import { statusChip, dayProgress } from "./components";
import { clear, h } from "./dom";
import { renderHome } from "./home";
import { Host, Undo } from "./host";
import { countUp, enter, reducedMotion, replayClass, slideIndicator, zoomFrom } from "./motion";
import { renderProduct } from "./product";
import { confirmStartDay1 } from "./sheets";

export type Tab = "overview" | "marketing" | "dev";
export type Route = { level: "home" } | { level: "product"; name: string; tab: Tab };

export class Memory {
  prevStatus = new Map<string, StatusKey>();
  changedAt = new Map<string, number>();
  prevNum = new Map<string, number>();
  known: Set<string> | null = null;
  filled = new Set<string>();
  glowed = new Set<string>();
  lastNext: { id: string; text: string } | null = null;
  feedback = new Map<string, { state: "done" | "error"; until: number; msg: string }>();
  flash = new Map<string, number>();
  tabBox: { name: string; box: { left: number; width: number } } | null = null;
  lastTabKey = "";
  drawers = new Set<string>();
}

export interface ButtonOpts {
  id: string;
  label: string;
  doneLabel?: string;
  variant?: "primary" | "ghost" | "quiet";
  title?: string;
  onClick: () => Promise<Undo | void> | Undo | void;
}

export interface Ctx {
  app: DashboardApp;
  data: DashboardData;
  today: string;
  host: Host;
  mem: Memory;
  status(p: ProductSnapshot): StatusResult;
  totals(p: ProductSnapshot): Totals;
  after(fn: () => void): void;
  button(opts: ButtonOpts): HTMLElement;
  actionButton(p: ProductSnapshot, action: ActionRef, where: string): HTMLElement;
  /** A number that counts up from its previous value. */
  num(key: string, value: number, fmt: (n: number) => string, cls?: string): HTMLElement;
  /** "nx-flash" if `key` was just changed by an action. */
  flashCls(key: string): string | null;
  openDoc(p: ProductSnapshot, doc: DocKey, heading?: string): void;
  go(route: Route, from?: Element | null): void;
}

const TABS: { id: Tab; label: string; key: string }[] = [
  { id: "overview", label: "📊 Overview", key: "1" },
  { id: "marketing", label: "📈 Marketing side", key: "2" },
  { id: "dev", label: "💻 Dev side", key: "3" },
];

export class DashboardApp {
  readonly root: HTMLElement;
  private scroller: HTMLElement;
  private screen: HTMLElement;
  private toasts: HTMLElement;
  readonly overlay: HTMLElement;
  route: Route = { level: "home" };
  data: DashboardData | null = null;
  mem = new Memory();
  private zoom: { rect: DOMRect; to: "product" | "home"; name: string } | null = null;
  private timers: number[] = [];

  constructor(container: HTMLElement, readonly host: Host) {
    this.root = h("div", { class: "nx-root", tabindex: "-1" });
    this.scroller = h("div", { class: "nx-scroller" });
    this.screen = h("div", { class: "nx-screen" });
    this.toasts = h("div", { class: "nx-toasts", role: "status", "aria-live": "polite" });
    this.overlay = h("div", { class: "nx-overlay", hidden: true });
    this.scroller.append(this.screen);
    this.root.append(this.scroller, this.toasts, this.overlay);
    container.appendChild(this.root);
    this.root.addEventListener("keydown", (e) => this.onKey(e));
    // Refresh "changed just now" dots and day rollovers.
    this.timers.push(window.setInterval(() => this.data && this.render(), 60_000));
  }

  destroy(): void {
    this.timers.forEach((t) => clearInterval(t));
    this.root.remove();
  }

  focus(): void {
    this.root.focus({ preventScroll: true });
  }

  setData(data: DashboardData): void {
    this.data = data;
    if (this.route.level === "product" && !data.products.some((p) => p.name === (this.route as { name: string }).name)) {
      this.route = { level: "home" };
    }
    this.render();
  }

  go(route: Route, from?: Element | null): void {
    const prev = this.route;
    if (route.level === "product" && prev.level === "home" && from) {
      this.zoom = { rect: from.getBoundingClientRect(), to: "product", name: route.name };
    } else if (route.level === "home" && prev.level === "product") {
      this.zoom = { rect: this.screen.getBoundingClientRect(), to: "home", name: prev.name };
    }
    this.route = route;
    if (prev.level !== route.level || (route.level === "product" && prev.level === "product" && (prev.name !== route.name || prev.tab !== route.tab))) {
      this.scroller.scrollTop = 0;
    }
    this.render();
    this.focus();
  }

  render(): void {
    const data = this.data;
    if (!data) return;
    const afters: (() => void)[] = [];
    const statusCache = new Map<string, StatusResult>();
    const totalsCache = new Map<string, Totals>();
    const ctx: Ctx = {
      app: this,
      data,
      today: data.today,
      host: this.host,
      mem: this.mem,
      totals: (p) => {
        if (!totalsCache.has(p.name)) totalsCache.set(p.name, computeTotals(p));
        return totalsCache.get(p.name)!;
      },
      status: (p) => {
        if (!statusCache.has(p.name)) statusCache.set(p.name, computeStatus(p, data.thresholds, data.today, ctx.totals(p)));
        return statusCache.get(p.name)!;
      },
      after: (fn) => afters.push(fn),
      button: (o) => this.button(o),
      actionButton: (p, a, where) => this.actionButton(ctx, p, a, where),
      num: (key, value, fmt, cls) => {
        const el = h("span", { class: ["nx-num", cls] }, fmt(value));
        const prev = this.mem.prevNum.get(key);
        this.mem.prevNum.set(key, value);
        const from = prev ?? 0;
        if (from !== value) afters.push(() => countUp(el, from, value, fmt));
        return el;
      },
      flashCls: (key) => ((this.mem.flash.get(key) ?? 0) > Date.now() ? "nx-flash" : null),
      openDoc: (p, doc, heading) => this.host.openDoc(p, doc, heading),
      go: (r, from) => this.go(r, from),
    };

    const route = this.route;
    const product = route.level === "product" ? data.products.find((p) => p.name === route.name) ?? null : null;
    const view = h("div", { class: ["nx-view", product ? "is-product" : "is-home"] });
    view.append(this.topBar(ctx, product));
    if (product && route.level === "product") {
      const tabKey = `${product.name}:${route.tab}`;
      const body = renderProduct(ctx, product, route.tab);
      if (this.mem.lastTabKey && this.mem.lastTabKey !== tabKey && this.mem.lastTabKey.startsWith(`${product.name}:`)) {
        afters.push(() => enter(body));
      }
      this.mem.lastTabKey = tabKey;
      view.append(body);
    } else {
      this.mem.lastTabKey = "";
      view.append(renderHome(ctx));
    }

    // Re-rendering replaces the focused element; keep keyboard focus inside the dashboard
    // (on the same button if it still exists) so shortcuts keep working.
    const active = document.activeElement as HTMLElement | null;
    const hadFocus = !!active && this.root.contains(active);
    const focusKey = active?.getAttribute("data-fb") ?? active?.getAttribute("data-product") ?? null;
    clear(this.screen);
    this.screen.append(view);
    if (hadFocus && !this.sheetOpen()) {
      const again = focusKey ? this.screen.querySelector<HTMLElement>(`[data-fb="${CSS.escape(focusKey)}"], [data-product="${CSS.escape(focusKey)}"]`) : null;
      (again ?? this.root).focus({ preventScroll: true });
    }

    // Square ↔ hub zoom.
    const z = this.zoom;
    this.zoom = null;
    if (z?.to === "product") zoomFrom(this.screen, z.rect);
    if (z?.to === "home") {
      const sq = this.screen.querySelector<HTMLElement>(`[data-product="${CSS.escape(z.name)}"]`);
      if (sq) zoomFrom(sq, z.rect);
    }
    afters.forEach((fn) => fn());
  }

  // ── Top bar ──────────────────────────────────────────────────────────────

  private topBar(ctx: Ctx, product: ProductSnapshot | null): HTMLElement {
    const home = h(
      "button",
      { class: ["nx-crumb", "nx-pressable", !product && "is-current"], type: "button", title: "All products (H)" },
      "🏠 All Products",
    );
    home.addEventListener("click", () => this.go({ level: "home" }));
    const left = h("div", { class: "nx-topbar-left" }, home);
    const right = h("div", { class: "nx-topbar-right" });

    if (product && this.route.level === "product") {
      const st = ctx.status(product);
      const select = h(
        "select",
        { class: "nx-switch", "aria-label": "Switch product", title: "Switch product ([ and ])" },
        ctx.data.products.map((p) => {
          const o = h("option", { value: p.name }, `📦 ${p.displayName}`);
          if (p.name === product.name) o.selected = true;
          return o;
        }),
      );
      select.addEventListener("change", () => this.go({ level: "product", name: select.value, tab: (this.route as { tab: Tab }).tab }));
      left.append(h("span", { class: "nx-sep", "aria-hidden": "true" }, "▸"), select);
      if (st.day !== null && st.day >= 1) {
        right.append(
          h("span", { class: "nx-daycount" }, `⏱ Day ${st.day} / ${st.totalDays}`),
          h("div", { class: "nx-topbar-progress" }, dayProgress(st.day, st.totalDays, false)),
        );
      }
      right.append(statusChip(st, "sm"));
    } else {
      right.append(h("span", { class: "nx-today" }, ctx.data.today ? new Date(ctx.data.today + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : ""));
    }

    const bar = h("header", { class: "nx-topbar" }, h("div", { class: "nx-topbar-row" }, left, right));

    if (product && this.route.level === "product") {
      const active = (this.route as { tab: Tab }).tab;
      const indicator = h("span", { class: "nx-tab-indicator", "aria-hidden": "true" });
      const tabs = h("nav", { class: "nx-tabs", role: "tablist" });
      let activeBtn: HTMLElement | null = null;
      for (const t of TABS) {
        const b = h("button", { class: ["nx-tab", t.id === active && "is-active"], role: "tab", "aria-selected": String(t.id === active), type: "button", title: `${t.label} (${t.key})` }, t.label);
        b.addEventListener("click", () => this.go({ level: "product", name: product.name, tab: t.id }));
        if (t.id === active) activeBtn = b;
        tabs.append(b);
      }
      tabs.append(indicator);
      bar.append(tabs);
      ctx.after(() => {
        if (!activeBtn) return;
        const prev = this.mem.tabBox?.name === product.name ? this.mem.tabBox.box : null;
        const box = slideIndicator(indicator, activeBtn, prev);
        this.mem.tabBox = { name: product.name, box };
      });
    }
    return bar;
  }

  // ── Buttons with micro-feedback ──────────────────────────────────────────

  private applyFeedback(btn: HTMLElement, wrap: HTMLElement, id: string): void {
    const fb = this.mem.feedback.get(id);
    btn.classList.remove("is-busy", "is-done", "is-error");
    wrap.querySelector(".nx-btn-error")?.remove();
    if (!fb || fb.until < Date.now()) return;
    btn.classList.add(fb.state === "done" ? "is-done" : "is-error");
    if (fb.state === "error") wrap.append(h("span", { class: "nx-btn-error", role: "alert" }, fb.msg));
  }

  button(o: ButtonOpts): HTMLElement {
    const btn = h(
      "button",
      { class: ["nx-btn", `nx-btn-${o.variant ?? "primary"}`, "nx-pressable"], type: "button", "data-fb": o.id, title: o.title },
      h("span", { class: "nx-btn-label" }, o.label),
      h("span", { class: "nx-btn-spin", "aria-hidden": "true" }),
      h("span", { class: "nx-btn-done" }, `✓ ${o.doneLabel ?? "Done"}`),
    );
    const wrap = h("span", { class: "nx-btn-wrap" }, btn);
    this.applyFeedback(btn, wrap, o.id);
    btn.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      if (btn.classList.contains("is-busy")) return;
      btn.classList.remove("is-done", "is-error");
      wrap.querySelector(".nx-btn-error")?.remove();
      btn.classList.add("is-busy");
      try {
        const undo = await o.onClick();
        if (o.doneLabel) {
          this.mem.feedback.set(o.id, { state: "done", until: Date.now() + 1500, msg: "" });
          this.refreshFeedback(o.id);
          window.setTimeout(() => this.refreshFeedback(o.id), 1550);
        } else {
          btn.classList.remove("is-busy");
        }
        if (typeof undo === "function") this.toast(`${o.doneLabel ?? "Done"}`, { undo });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.mem.feedback.set(o.id, { state: "error", until: Date.now() + 6000, msg });
        this.refreshFeedback(o.id);
        const current = this.root.querySelector<HTMLElement>(`[data-fb="${CSS.escape(o.id)}"]`);
        if (current) replayClass(current, "nx-shake", 400);
        window.setTimeout(() => this.refreshFeedback(o.id), 6050);
      }
    });
    return wrap;
  }

  /** Re-apply feedback state to whichever copy of the button is on screen now (re-renders replace it). */
  private refreshFeedback(id: string): void {
    const btn = this.root.querySelector<HTMLElement>(`[data-fb="${CSS.escape(id)}"]`);
    const wrap = btn?.parentElement;
    if (btn && wrap) this.applyFeedback(btn, wrap, id);
  }

  private actionButton(ctx: Ctx, p: ProductSnapshot, a: ActionRef, where: string): HTMLElement {
    const id = `${where}:${p.name}:${a.kind}:${a.doc ?? ""}`;
    if (a.kind === "startDay1") {
      return this.button({ id, label: a.label, onClick: () => confirmStartDay1(ctx, p) });
    }
    if (a.kind === "postedToday") {
      return this.button({
        id,
        label: a.label,
        doneLabel: "Logged",
        onClick: async () => {
          const undo = await this.host.postedToday(p);
          this.mem.flash.set(`${p.name}:post`, Date.now() + 1300);
          return undo;
        },
      });
    }
    if (a.kind === "openDoc" && a.doc) {
      const doc = a.doc;
      return this.button({ id, label: `${a.label} →`, variant: "ghost", onClick: () => this.host.openDoc(p, doc, a.heading) });
    }
    return h("span");
  }

  // ── Toasts & sheets ──────────────────────────────────────────────────────

  toast(message: string, opts: { undo?: Undo; action?: { label: string; run: () => void } } = {}): void {
    const t = h("div", { class: "nx-toast" }, h("span", { class: "nx-toast-icon", "aria-hidden": "true" }, "✓"), h("span", { class: "nx-toast-msg" }, message));
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      t.classList.add("is-leaving");
      window.setTimeout(() => t.remove(), reducedMotion() ? 0 : 200);
    };
    if (opts.undo) {
      const undo = opts.undo;
      const b = h("button", { class: "nx-toast-btn", type: "button" }, "Undo");
      b.addEventListener("click", async () => {
        close();
        try {
          await undo();
          this.toast("Undone");
        } catch (e) {
          this.toast(`Undo failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      });
      t.append(b);
    }
    if (opts.action) {
      const { label, run } = opts.action;
      const b = h("button", { class: "nx-toast-btn", type: "button" }, label);
      b.addEventListener("click", () => {
        close();
        run();
      });
      t.append(b);
    }
    this.toasts.append(t);
    while (this.toasts.children.length > 3) this.toasts.firstElementChild?.remove();
    window.setTimeout(close, opts.undo ? 5000 : 3000);
  }

  sheetOpen(): boolean {
    return !this.overlay.hidden;
  }

  // ── Keyboard ─────────────────────────────────────────────────────────────

  private onKey(e: KeyboardEvent): void {
    const target = e.target as HTMLElement;
    if (e.key === "Escape" && this.sheetOpen()) return; // the sheet handles it
    if (this.sheetOpen() || e.metaKey || e.ctrlKey || e.altKey) return;
    if (target.closest("input, textarea, select, [contenteditable]")) return;
    const data = this.data;
    if (!data) return;
    const route = this.route;
    if (e.key === "h" || e.key === "Escape") {
      if (route.level !== "home") {
        e.preventDefault();
        this.go({ level: "home" });
      }
      return;
    }
    if (route.level !== "product") return;
    const tab = TABS.find((t) => t.key === e.key);
    if (tab) {
      e.preventDefault();
      this.go({ ...route, tab: tab.id });
      return;
    }
    if (e.key === "[" || e.key === "]") {
      const list = data.products;
      const i = list.findIndex((p) => p.name === route.name);
      const next = list[(i + (e.key === "]" ? 1 : -1) + list.length) % list.length];
      if (next) {
        e.preventDefault();
        this.go({ ...route, name: next.name });
      }
    }
  }

  activeSprint(): ProductSnapshot | null {
    return this.data ? activeProducts(this.data.products)[0] ?? null : null;
  }
}
