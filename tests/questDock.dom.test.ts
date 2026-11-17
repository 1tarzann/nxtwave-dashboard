// The quest log docked to the right edge (src/ui/quests.ts + DashboardApp): quests live only there, the tab shows the
// open count, it opens and closes by tab, ✕, Q and Esc, remembers that per device, groups by product then by who
// does it, and keeps the keyboard where it should be (inert when closed, under a sheet, or behind a covering drawer).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it } from "vitest";
import { makeApp, sleep } from "./dom/harness";
import { visibleText } from "./dom/fakedom";

let destroy: (() => void) | null = null;
afterEach(() => {
  destroy?.();
  destroy = null;
});

async function app(prefs: Record<string, unknown> = {}) {
  const S = await import("./samples");
  const t = await makeApp({ marketing: S.MKT_V2_TEMPLATE, spec: S.SPEC_EMPTY, prefs });
  destroy = t.destroy;
  const panel = t.root.querySelector(".nx-qpanel")!;
  const tab = t.root.querySelector(".nx-qtab")!;
  const screen = t.root.querySelector(".nx-screen")!;
  const isOpen = () => t.root.classList.contains("nx-quests-open");
  const saved = () => t.host.calls.filter(([k]: [string]) => k === "savePrefs").map(([, [p]]: [string, [any]]) => p.questLogOpen);
  const key = (k: string, target: any = (globalThis as any).document.activeElement) => target.dispatch("keydown", { key: k });
  const active = () => (globalThis as any).document.activeElement;
  return { ...t, panel, tab, screen, isOpen, saved, key, active };
}

describe("quests live only in the quest log", () => {
  it("Home, Overview, Marketing side and Developer side show no quest cards; the log has them all", async () => {
    const t = await app();
    const routes = [{ level: "home" }, ...(["overview", "marketing", "dev"] as const).map((tab) => ({ level: "product", name: "Demo_Tool", tab }))];
    for (const r of routes) {
      t.app.go(r);
      expect(t.screen.querySelectorAll(".nx-quest")).toHaveLength(0);
      expect(t.screen.querySelectorAll(".nx-quests")).toHaveLength(0);
    }
    expect(t.panel.querySelectorAll(".nx-qcard").length).toBeGreaterThan(0);
  });

  it("Home keeps one “Do this next” line", async () => {
    const t = await app();
    expect(t.screen.querySelectorAll(".nx-next")).toHaveLength(1);
    expect(visibleText(t.screen.querySelector(".nx-next")!)).toMatch(/^▶ Do this next /);
  });
});

describe("the tab", () => {
  it("shows the open count and the overdue count, and says them out loud", async () => {
    const t = await app({ questLogOpen: false });
    const open = t.panel.querySelectorAll(".nx-qcard").filter((c) => c.classList.contains("is-now") || c.classList.contains("is-overdue"));
    const late = open.filter((c) => c.classList.contains("is-overdue"));
    expect(late.length).toBeGreaterThan(0);
    expect(t.tab.querySelector(".nx-qtab-count")!.textContent).toBe(String(open.length));
    expect(t.tab.querySelector(".nx-qtab-late")!.textContent).toBe(`⚠ ${late.length}`);
    expect(t.tab.getAttribute("aria-label")).toBe(`Quest log: ${open.length} open, ${late.length} overdue`);
    expect(t.tab.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("opening and closing", () => {
  it("remembered closed: starts closed, the panel can't take focus; the tab opens it, saves it and moves focus in", async () => {
    const t = await app({ questLogOpen: false });
    expect(t.isOpen()).toBe(false);
    expect(t.panel.hasAttribute("inert")).toBe(true);
    t.tab.focus();
    t.tab.click();
    expect(t.isOpen()).toBe(true);
    expect(t.panel.hasAttribute("inert")).toBe(false);
    expect(t.tab.getAttribute("aria-expanded")).toBe("true");
    expect(t.active().classList.contains("nx-qpanel-title")).toBe(true);
    expect(t.saved()).toEqual([true]);
  });

  it("✕ closes it, saves it closed and hands focus back to the tab", async () => {
    const t = await app({ questLogOpen: true });
    expect(t.isOpen()).toBe(true);
    const close = t.panel.querySelector(".nx-qpanel-close")!;
    close.focus();
    close.click();
    expect(t.isOpen()).toBe(false);
    expect(t.active()).toBe(t.tab);
    expect(t.saved()).toEqual([false]);
  });

  it("nothing remembered yet: open when there's room beside the page, and the first render saves nothing", async () => {
    const t = await app();
    expect(t.isOpen()).toBe(true);
    expect(t.saved()).toEqual([]);
  });

  it("Q opens and closes it from anywhere in the dashboard; Esc inside it closes it", async () => {
    const t = await app({ questLogOpen: false });
    t.app.focus();
    t.key("q");
    expect(t.isOpen()).toBe(true);
    t.key("Q");
    expect(t.isOpen()).toBe(false);
    t.key("q");
    t.key("Escape");
    expect(t.isOpen()).toBe(false);
    expect(t.active()).toBe(t.tab);
    expect(t.saved()).toEqual([true, false, true, false]);
  });

  it("beside the page, Esc outside the log still goes home and leaves the log open", async () => {
    const t = await app({ questLogOpen: true });
    t.app.go({ level: "product", name: "Demo_Tool", tab: "marketing" });
    t.key("Escape", t.root);
    expect(t.app.route.level).toBe("home");
    expect(t.isOpen()).toBe(true);
  });
});

describe("what the log shows", () => {
  it("groups by product, then For Dev / For Marketing, the person's own first; the filter keeps shared quests", async () => {
    const t = await app({ role: "marketing" });
    const chip = (label: string) => t.panel.querySelectorAll(".nx-filter-chip").find((b) => b.textContent === label)!;
    // The Marketer's device starts on For Marketing.
    expect(chip("For Marketing").getAttribute("aria-pressed")).toBe("true");
    expect(t.panel.querySelectorAll(".nx-qowner.own-dev")).toHaveLength(0);
    chip("All").click();
    const group = t.panel.querySelector('[data-qgroup="product:Demo_Tool"]')!;
    expect(visibleText(group.querySelector(".nx-qgroup-name")!)).toBe("📦 Demo Tool");
    expect(group.querySelectorAll(".nx-qowner").map((o) => o.classList.contains("own-marketing") ? "marketing" : o.classList.contains("own-dev") ? "dev" : "both")).toEqual(["marketing", "dev"]);
    t.panel.querySelectorAll(".nx-filter-chip").find((b) => b.textContent === "For Dev")!.click();
    expect(t.panel.querySelectorAll(".nx-qowner.own-marketing")).toHaveLength(0);
    expect(t.panel.querySelectorAll(".nx-qowner.own-dev")).toHaveLength(1);
  });

  it("the product being looked at comes first, Company last and folded", async () => {
    const t = await app();
    t.app.go({ level: "product", name: "Demo_Tool", tab: "overview" });
    const groups = t.panel.querySelectorAll(".nx-qgroup");
    expect(groups[0].getAttribute("data-qgroup")).toBe("product:Demo_Tool");
    const company = groups[groups.length - 1];
    expect(company.getAttribute("data-qgroup")).toBe("company");
    expect(company.classList.contains("is-open")).toBe(false);
    expect(company.querySelector(".nx-qgroup-body")!.hasAttribute("inert")).toBe(true);
  });

  it("each quest keeps its overdue flag, progress and action button", async () => {
    const t = await app();
    const card = t.panel.querySelectorAll(".nx-qcard").find((c) => visibleText(c).includes("paste the handles"))!;
    expect(card.classList.contains("is-overdue")).toBe(true);
    expect(card.querySelector(".nx-quest-when.is-late")).not.toBeNull();
    expect(visibleText(card.querySelector(".nx-quest-prog")!)).toMatch(/^\d+ of \d+$/);
    expect(card.querySelector('[data-fb="quest:Demo_Tool:mkt-accounts"]')).not.toBeNull();
  });

  it("a group folds and stays folded after a re-render; a quest's name opens why and where", async () => {
    const t = await app();
    const toggle = t.panel.querySelector(".nx-qgroup-toggle")!;
    toggle.click();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    t.app.render();
    expect(t.panel.querySelector(".nx-qgroup-toggle")!.getAttribute("aria-expanded")).toBe("false");
    t.panel.querySelector(".nx-qgroup-toggle")!.click();
    const title = t.panel.querySelector(".nx-qcard-title")!;
    const details = title.parentElement!.querySelector(".nx-qcard-details")!;
    expect(details.hidden).toBe(true);
    title.click();
    expect(details.hidden).toBe(false);
    expect(title.getAttribute("aria-expanded")).toBe("true");
    expect(visibleText(details)).toContain("Only a person:");
  });
});

describe("keyboard and screen readers", () => {
  it("a sheet opened from the log shuts out the log too, and focus comes back to its button", async () => {
    const t = await app({ questLogOpen: true });
    const dock = t.root.querySelector(".nx-qdock")!;
    const paste = t.panel.querySelector('[data-fb="quest:Demo_Tool:mkt-accounts"]')!;
    paste.focus();
    paste.click();
    await sleep(20);
    expect(dock.hasAttribute("inert")).toBe(true);
    expect(t.root.querySelector(".nx-scroller")!.hasAttribute("inert")).toBe(true);
    t.button("Cancel").click();
    await sleep(20);
    expect(dock.hasAttribute("inert")).toBe(false);
    expect(t.root.querySelector(".nx-scroller")!.hasAttribute("inert")).toBe(false);
    expect(t.active().getAttribute("data-fb")).toBe("quest:Demo_Tool:mkt-accounts");
  });

  it("focus stays on a quest log button across a re-render", async () => {
    const t = await app();
    const chip = t.panel.querySelectorAll(".nx-filter-chip").find((b) => b.textContent === "For Marketing")!;
    chip.focus();
    chip.click();
    expect(t.active().getAttribute("data-fb")).toBe("quests:filter:marketing");
    expect(t.active().getAttribute("aria-pressed")).toBe("true");
  });

  it("on a narrow pane it covers the page: a dialog, the page behind inert, and Esc closes it from anywhere", async () => {
    const t = await app({ questLogOpen: false });
    Object.defineProperty(t.root, "clientWidth", { value: 375, configurable: true });
    t.tab.click();
    expect(t.panel.getAttribute("role")).toBe("dialog");
    expect(t.panel.getAttribute("aria-modal")).toBe("true");
    expect(t.root.querySelector(".nx-scroller")!.hasAttribute("inert")).toBe(true);
    t.key("Escape", t.root);
    expect(t.isOpen()).toBe(false);
    expect(t.root.querySelector(".nx-scroller")!.hasAttribute("inert")).toBe(false);
    expect(t.panel.hasAttribute("role")).toBe(false);
  });

  it("on a narrow pane, a “Go to …” quest button closes the log and shows that section", async () => {
    const S = await import("./samples");
    const t = await makeApp({ marketing: S.MKT_V2_TEMPLATE, spec: S.SPEC_EMPTY, prefs: { questLogOpen: true } });
    destroy = t.destroy;
    Object.defineProperty(t.root, "clientWidth", { value: 375, configurable: true });
    const go = t.root.querySelectorAll(".nx-qpanel .nx-btn").find((b) => /^Go to/.test(b.querySelector(".nx-btn-label")?.textContent ?? ""));
    expect(go).toBeDefined();
    go!.click();
    await sleep(10);
    expect(t.root.classList.contains("nx-quests-open")).toBe(false);
    expect(t.app.route).toMatchObject({ level: "product", name: "Demo_Tool" });
    expect(((globalThis as any).document.activeElement.getAttribute("id") ?? "").startsWith("nx-sec-")).toBe(true);
  });
});

describe("“Show in quest log”", () => {
  it("opens the log at that quest: its group and details open, focus on its name", async () => {
    const t = await app({ questLogOpen: false });
    const { revealQuest } = await import("../src/ui/quests");
    t.panel.querySelector(".nx-qgroup-toggle")!.click(); // folded by hand first
    revealQuest({ app: t.app, mem: t.app.mem } as any, "product:Demo_Tool", "mkt-accounts");
    expect(t.isOpen()).toBe(true);
    const card = t.active().closest(".nx-qcard");
    expect(visibleText(card.querySelector(".nx-qcard-name"))).toContain("paste the handles");
    expect(card.querySelector(".nx-qcard-details").hidden).toBe(false);
    expect(t.panel.querySelector('[data-qgroup="product:Demo_Tool"]')!.classList.contains("is-open")).toBe(true);
  });
});
