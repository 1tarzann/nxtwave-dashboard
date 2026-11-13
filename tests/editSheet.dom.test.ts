// The edit sheets, toasts and focus on a fake DOM, driving the real DashboardApp with the sample notes. Each test
// is a partner-data or a usability case a review found by clicking through (the regression it pins is named).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeApp, sleep } from "./dom/harness";

const lineOf = (note: string, start: RegExp) => note.split("\n").find((l) => start.test(l)) ?? "";

let destroy: (() => void) | null = null;
afterEach(() => {
  destroy?.();
  destroy = null;
  vi.useRealTimers();
});

async function researched(opts: { deferMs?: number } = {}) {
  const S = await import("./samples");
  const t = await makeApp({ marketing: S.MKT_V2_RESEARCHED, spec: S.SPEC_FILLED, ...opts });
  destroy = t.destroy;
  t.app.go({ level: "product", name: "Demo_Tool", tab: "marketing" });
  return t;
}

describe("a partner's text that the open box can't hold is never written over", () => {
  it("video: the partner writes 'launch day' into Go-live (a date picker) while the Marketer changes Format", async () => {
    const t = await researched();
    await t.open("ed:video:Demo_Tool:1:edit");
    expect(t.control("Go-live date").type).toBe("date");
    t.type(t.control("Format"), "Screen recording + your voice, 25s");
    t.partner((n) => n.replace(/^(\| 1 \| Screen recording[^\n]*\| )<span class="nx-eg">[^<]*<\/span>( \|)$/m, "$1launch day$2"));
    expect(lineOf(t.note(), /^\| 1 \| Screen/)).toContain("| launch day |");
    expect(t.control("Go-live date").value).toBe("launch day");
    t.button("Save").click();
    await sleep(30);
    const row = lineOf(t.note(), /^\| 1 \| Screen/);
    expect(row).toContain("Screen recording + your voice, 25s");
    expect(row).toContain("| launch day |");
  });

  it("paid test: the partner writes 'day 15' into Start date while the Marketer changes Budget", async () => {
    const t = await researched();
    await t.open("ed:paid:Demo_Tool:edit");
    t.type(t.control("Budget"), "$150");
    t.partner((n) => n.replace(/^\| Start date \|[^\n]*$/m, "| Start date | day 15 |"));
    t.button("Save").click();
    await sleep(30);
    expect(lineOf(t.note(), /^\| Start date/)).toBe("| Start date | day 15 |");
    expect(t.edits.at(-1)?.edits?.[0]?.values).not.toHaveProperty("Value", "");
  });

  it("a one-line box given a line break becomes a text area, so the partner's two lines aren't glued", async () => {
    const t = await researched();
    await t.open("ed:video:Demo_Tool:1:edit");
    expect(t.control("Format").localName).toBe("input");
    t.type(t.control("Platforms"), "TikTok, Reels");
    t.partner((n) => n.replace("| 1 | Screen recording + your voice, 20s |", "| 1 | Screen recording<br>+ your voice, 20s |"));
    expect(t.control("Format").localName).toBe("textarea");
    t.button("Save").click();
    await sleep(30);
    expect(lineOf(t.note(), /^\| 1 \| Screen/)).toContain("| Screen recording<br>+ your voice, 20s |");
    expect(lineOf(t.note(), /^\| 1 \| Screen/)).toContain("TikTok, Reels");
  });

  it("hook: the partner splits the CTA over two lines while the Marketer changes Demo shot", async () => {
    const t = await researched();
    await t.open("mk:Demo_Tool:hook:1:edit");
    t.type(t.control("Demo shot"), "Before/after: harsh take, one knob turn, smooth");
    t.partner((n) => n.replace("| $29 once. Link in bio. | [Acme Vox 2.6×]", "| $29 once.<br>Link in bio. | [Acme Vox 2.6×]"));
    t.button("Save").click();
    await sleep(30);
    expect(lineOf(t.note(), /^\| 2 \|/)).toContain("$29 once.<br>Link in bio.");
  });
});

describe("one-line text that grows (Hook, Demo shot, CTA)", () => {
  it("is a one-row text area; Enter saves and never adds a line break; a pasted break becomes a space", async () => {
    const t = await researched();
    await t.open("mk:Demo_Tool:hook:1:edit");
    const cta = t.control("CTA");
    expect([cta.localName, cta.getAttribute("rows"), cta.classList.contains("nx-input-line")]).toEqual(["textarea", "1", true]);
    t.type(cta, "Link in bio.\nNow.");
    expect(cta.value).toBe("Link in bio. Now.");
    const ev = cta.dispatch("keydown", { key: "Enter" });
    expect(ev.defaultPrevented).toBe(true);
    await sleep(30);
    expect(lineOf(t.note(), /^\| 2 \|/)).toContain("| Link in bio. Now. |");
  });
});

describe("only a field the save writes can block it", () => {
  it("a Stripe-looking text the note already has in Based on doesn't stop a Rating change", async () => {
    const S = await import("./samples");
    const key = "sk" + "_live_" + "x".repeat(24);
    const t = await makeApp({ marketing: S.MKT_V2_RESEARCHED.replace("[Acme Vox 2.6×](https://example.com/v/3)", `[Acme Vox 2.6×](https://example.com/v/3) ${key}`), spec: S.SPEC_FILLED });
    destroy = t.destroy;
    t.app.go({ level: "product", name: "Demo_Tool", tab: "marketing" });
    await t.open("mk:Demo_Tool:hook:1:edit");
    const rating = t.control("Rating");
    rating.value = "medium";
    rating.dispatch("change");
    expect(t.button("Save").disabled).toBe(false);
    t.type(t.control("Based on"), `${t.control("Based on").value} more`);
    expect(t.button("Save").disabled).toBe(true);
  });
});

describe("a competitor whose name is still empty", () => {
  it("the partner swaps two nameless lines while the sheet is open: the name goes with its hook", async () => {
    const S = await import("./samples");
    const { parseMarketing } = await import("../src/data/marketing");
    const L = S.MKT_V2_TEMPLATE.split("\n");
    const hdr = L.findIndex((l) => l.startsWith("| Competitor"));
    L[hdr + 2] = "| [Acme Vox](https://example.com/acme-vox) | [184k views](https://example.com/v/1) | \"Your S's are too loud.\" | Result by second 1 |";
    L[hdr + 3] = "| | | \"Harsh vocals? Watch the waveform.\" | Before/after by second 2 |";
    L[hdr + 4] = "| | | | |";
    const t = await makeApp({ marketing: L.join("\n"), spec: S.SPEC_FILLED });
    destroy = t.destroy;
    t.app.go({ level: "product", name: "Demo_Tool", tab: "marketing" });
    await t.open("mk:Demo_Tool:competitor:1:edit");
    t.type(t.control("Name"), "Beta Audio");
    t.partner((n) => {
      const M = n.split("\n");
      [M[hdr + 3], M[hdr + 4]] = [M[hdr + 4], M[hdr + 3]];
      return M.join("\n");
    });
    expect(t.control("Hook").value).toBe('"Harsh vocals? Watch the waveform."');
    t.button("Save").click();
    await sleep(30);
    const c = parseMarketing(t.note()).competitors!.find((x) => x.name.value === "Beta Audio");
    expect(c?.hook.value).toBe('"Harsh vocals? Watch the waveform."');
  });
});

describe("our own write is never shown as the partner's (U6)", () => {
  it("a status step, then Edit before the note is read again", async () => {
    const t = await researched({ deferMs: 120 });
    t.root.querySelector('[data-fb="ed:vstep:Demo_Tool:1:edited"]')!.click();
    await sleep(10);
    await t.open("ed:video:Demo_Tool:1:edit");
    await sleep(200);
    expect(t.notes().join(" ")).not.toMatch(/partner/i);
    expect(t.control("Status").value).toBe("edited");
  });
});

describe("Use in a video names the number it gave", () => {
  it("two quick presses before the note is read again: video 2, then video 3", async () => {
    const t = await researched({ deferMs: 150 });
    t.root.querySelector('[data-fb="mk:Demo_Tool:hook:3:use"]')!.click();
    await sleep(20);
    t.root.querySelector('[data-fb="mk:Demo_Tool:hook:4:use"]')!.click();
    await sleep(20);
    expect(t.toasts.map((x) => x.message).filter((m) => m.startsWith("Added"))).toEqual(["Added as video 2", "Added as video 3"]);
  });
});

describe("toasts", () => {
  it("a warning shows ⚠, is an alert, has a ✕ and stays until it's closed", async () => {
    const t = await researched();
    vi.useFakeTimers();
    t.app.toast("Your partner changed the same spot at the same time.", { tone: "warn" });
    const el = t.root.querySelector(".nx-toast.is-warn")!;
    expect(el.getAttribute("role")).toBe("alert");
    expect(el.querySelector(".nx-toast-icon")!.textContent).toBe("⚠");
    vi.advanceTimersByTime(60_000);
    expect(el.classList.contains("is-leaving")).toBe(false);
    el.querySelector(".nx-toast-close")!.click();
    expect(el.classList.contains("is-leaving")).toBe(true);
    t.app.toast("Undo failed: it changed again since.", { tone: "error" });
    expect(t.root.querySelector(".nx-toast.is-error .nx-toast-icon")!.textContent).toBe("⚠");
  });
  it("an ordinary toast waits while it's hovered or focused, then closes", async () => {
    const t = await researched();
    vi.useFakeTimers();
    t.app.toast("Saved");
    const el = t.root.querySelector(".nx-toast.is-ok")!;
    expect(el.querySelector(".nx-toast-icon")!.textContent).toBe("✓");
    vi.advanceTimersByTime(1000);
    el.dispatch("mouseenter");
    vi.advanceTimersByTime(10_000);
    expect(el.classList.contains("is-leaving")).toBe(false);
    el.dispatch("mouseleave");
    el.dispatch("focusin");
    vi.advanceTimersByTime(10_000);
    expect(el.classList.contains("is-leaving")).toBe(false);
    el.dispatch("focusout", { relatedTarget: null });
    vi.advanceTimersByTime(2100);
    expect(el.classList.contains("is-leaving")).toBe(true);
  });
  it("a read-back warning after a save is a warning toast", async () => {
    const t = await researched();
    t.host.editTable = (orig => async (...a: any[]) => ({ ...(await orig(...a)), settled: Promise.resolve("Your partner changed the same spot at the same time.") }))(t.host.editTable);
    await t.open("mk:Demo_Tool:hook:1:edit");
    t.type(t.control("CTA"), "Link in bio, today.");
    t.button("Save").click();
    await sleep(30);
    expect(t.toasts.find((x) => x.message.startsWith("Your partner"))?.opts.tone).toBe("warn");
  });
});

describe("an open sheet keeps the keyboard inside it", () => {
  it("the dashboard behind it is inert, and another sheet can't replace one holding typed text", async () => {
    const t = await researched();
    await t.open("mk:Demo_Tool:hook:1:edit");
    const scroller = t.root.querySelector(".nx-scroller")!;
    expect(scroller.hasAttribute("inert")).toBe(true);
    t.type(t.control("CTA"), "Typed, not saved");
    const { openSheet } = await import("../src/ui/sheets");
    const ctxLike = { app: t.app } as any;
    openSheet(ctxLike, "Another", () => []);
    expect(t.control("CTA").value).toBe("Typed, not saved");
    t.button("Cancel").click();
    await sleep(10);
    expect(scroller.hasAttribute("inert")).toBe(false);
  });
});

describe("focus after a deleted video", () => {
  it("stays in Videos to make when its Edit button is gone after the re-read", async () => {
    const S = await import("./samples");
    const t = await makeApp({ marketing: S.MKT_V1_FILLED, spec: S.SPEC_FILLED, deferMs: 60 });
    destroy = t.destroy;
    t.app.go({ level: "product", name: "Demo_Tool", tab: "marketing" });
    await t.open("ed:video:Demo_Tool:3:edit");
    t.overlay.querySelector(".nx-ef-danger")!.click();
    t.overlay.querySelector(".nx-ef-yes")!.click();
    await sleep(150);
    const active = (globalThis as any).document.activeElement;
    expect(active.closest("#nx-sec-videos")).not.toBeNull();
  });
});

describe("a closed drawer holds nothing Tab can reach", () => {
  it("Don't use: closing it makes its content inert again", async () => {
    const t = await researched();
    const toggle = t.root.querySelectorAll(".nx-drawer-toggle").find((b) => b.textContent.includes("Don't use"))!;
    const body = toggle.parentElement!.querySelector(".nx-drawer-body")!;
    expect(body.hasAttribute("inert")).toBe(true);
    toggle.click();
    expect(body.hasAttribute("inert")).toBe(false);
    toggle.click();
    expect(body.hasAttribute("inert")).toBe(true);
  });
});

describe("old write paths refuse a Stripe secret key too", () => {
  it("Connect a repo link and Paste handles write nothing and say why", async () => {
    const t = await researched();
    const key = "sk" + "_live_" + "x".repeat(24);
    const { connectSheet, handlesSheet } = await import("../src/ui/sheets");
    const p = t.app.data.products[0];
    const ctx = { app: t.app, host: t.host, data: t.app.data, mem: t.app.mem, button: (o: any) => t.app.button(o) } as any;
    connectSheet(ctx, p, "spec", "repo_url", "GitHub repo link", "https://github.com/…");
    await sleep(40);
    const input = t.overlay.querySelector("input")!;
    (input as any).value = key;
    t.overlay.querySelector('[data-fb^="sheet:connect"]')!.click();
    await sleep(20);
    expect(t.overlay.querySelector(".nx-btn-error")?.textContent).toMatch(/Stripe secret key/);
    t.overlay.querySelector(".nx-sheet-close")!.click();
    await sleep(10);
    await handlesSheet(ctx, p);
    await sleep(40);
    (t.overlay.querySelector("input") as any).value = key;
    t.overlay.querySelector('[data-fb^="sheet:handles"]')!.click();
    await sleep(20);
    expect(t.host.calls).toEqual([]);
  });
});

describe("links from notes only open web addresses", () => {
  it("a Best video link or repo link that isn't http(s) shows as text", async () => {
    await researched();
    const { bestVideo } = await import("../src/ui/product");
    for (const bad of ["obsidian://new?vault=V&file=x&content=y&overwrite=true", "file:///Applications/Utilities/Terminal.app", "javascript:alert(1)"]) {
      const el = bestVideo(bad, 9100) as any;
      expect(el.localName, bad).toBe("span");
      expect(el.getAttribute("href"), bad).toBeNull();
    }
    expect((bestVideo("https://www.tiktok.com/@demo_tool/video/1", 9100) as any).getAttribute("href")).toBe("https://www.tiktok.com/@demo_tool/video/1");
  });
});
