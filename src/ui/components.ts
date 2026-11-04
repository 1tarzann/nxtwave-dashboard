// Small building blocks shared by every screen.

import { longDate, relativeDay } from "../data/dates";
import { StatusResult } from "../data/types";
import { Child, h, s } from "./dom";

export function statusChip(st: StatusResult, size: "sm" | "md" = "md"): HTMLElement {
  return h(
    "span",
    { class: ["nx-chip", `nx-st-${st.key}`, `nx-chip-${size}`], title: st.reason },
    h("span", { class: "nx-chip-icon", "aria-hidden": "true" }, st.icon),
    h("span", { class: "nx-chip-label" }, st.label),
  );
}

/** "3 days ago" with the exact date on hover. */
export function rel(iso: string | null, today: string, never = "none yet"): HTMLElement {
  if (!iso) return h("span", { class: "nx-rel is-never" }, never);
  return h("time", { class: "nx-rel", datetime: iso, title: longDate(iso) }, relativeDay(iso, today));
}

/** Day progress with marks at 14 (launch), 21 (kill check), 28 (verdict). */
export function dayProgress(day: number | null, total: number, animate: boolean): HTMLElement {
  const pct = day === null ? 0 : Math.max(0, Math.min(1, day / total));
  const marks = [14, 21, 28].filter((m) => m < total);
  return h(
    "div",
    {
      class: "nx-progress",
      role: "progressbar",
      "aria-valuemin": 0,
      "aria-valuemax": total,
      "aria-valuenow": day ?? 0,
      "aria-label": day === null ? "Clock not started" : `Day ${day} of ${total}`,
    },
    h("div", { class: ["nx-progress-fill", animate && "nx-fill-in"], style: { transform: `scaleX(${pct})` } }),
    marks.map((m) => h("span", { class: "nx-progress-mark", style: { left: `${(m / total) * 100}%` } })),
  );
}

export function section(title: string, ...children: Child[]): HTMLElement {
  return h("section", { class: "nx-section" }, h("h3", { class: "nx-section-title" }, title), ...children);
}

export function emptyNote(text: string, ...children: Child[]): HTMLElement {
  return h("div", { class: "nx-empty" }, h("span", null, text), ...children);
}

/** Collapsible drawer whose open state survives re-renders. */
export function drawer(opts: { id: string; label: Child; open: boolean; onToggle: (open: boolean) => void; body: () => Child }): HTMLElement {
  const wrap = h("div", { class: ["nx-drawer", opts.open && "is-open"] });
  const btn = h(
    "button",
    { class: "nx-drawer-toggle", type: "button", "aria-expanded": String(opts.open) },
    h("span", { class: "nx-chevron", "aria-hidden": "true" }, "›"),
    opts.label,
  );
  const inner = h("div", { class: "nx-drawer-inner" }, opts.open ? opts.body() : null);
  btn.addEventListener("click", () => {
    const open = !wrap.classList.contains("is-open");
    if (open && !inner.firstChild) {
      const content = opts.body();
      if (Array.isArray(content)) content.forEach((c) => c instanceof Node && inner.appendChild(c));
      else if (content instanceof Node) inner.appendChild(content);
    }
    wrap.classList.toggle("is-open", open);
    btn.setAttribute("aria-expanded", String(open));
    opts.onToggle(open);
  });
  wrap.append(btn, h("div", { class: "nx-drawer-body" }, inner));
  return wrap;
}

export function checkIcon(cls = "nx-check"): SVGElement {
  return s("svg", { class: cls, viewBox: "0 0 24 24", width: 22, height: 22, "aria-hidden": "true" },
    s("circle", { cx: 12, cy: 12, r: 11, class: "nx-check-ring" }),
    s("path", { d: "M7 12.5l3.2 3.2L17 9", class: "nx-check-mark" }),
  );
}

export const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
export const moneyExact = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
export const count = (n: number) => Math.round(n).toLocaleString("en-US");
