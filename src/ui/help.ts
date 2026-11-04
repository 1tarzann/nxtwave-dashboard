// The Help sheet: colors, pages, quest tags, number tags, words, keyboard. Nothing to guess.

import { GLOSSARY } from "../data/fields";
import { STATUS_STYLE } from "../data/status";
import { StatusKey } from "../data/types";
import type { Ctx } from "./app";
import { h } from "./dom";
import { openSheet } from "./sheets";

const COLOR_ORDER: StatusKey[] = ["healthy", "stale", "gate", "kill", "unstarted", "queued"];

export function legendRow(): HTMLElement {
  return h(
    "div",
    { class: "nx-legend-row", "aria-label": "Color key" },
    COLOR_ORDER.map((k) =>
      h("span", { class: "nx-legend-item", title: STATUS_STYLE[k].meaning }, h("span", { class: ["nx-legend-swatch", `nx-st-${k}`] }, STATUS_STYLE[k].icon), STATUS_STYLE[k].label),
    ),
  );
}

export function openHelp(ctx: Ctx): void {
  openSheet(ctx, "How this dashboard works", () => [
    h("h4", { class: "nx-help-h" }, "1 · What the colors mean"),
    h(
      "dl",
      { class: "nx-help-list" },
      COLOR_ORDER.map((k) =>
        h("div", null, h("dt", null, h("span", { class: ["nx-chip", "nx-chip-sm", `nx-st-${k}`] }, `${STATUS_STYLE[k].icon} ${STATUS_STYLE[k].label}`)), h("dd", null, STATUS_STYLE[k].meaning)),
      ),
    ),

    h("h4", { class: "nx-help-h" }, "2 · The pages"),
    h(
      "dl",
      { class: "nx-help-list" },
      h("div", null, h("dt", null, "🏠 All Products"), h("dd", null, "Every product as a square, the single next thing to do, and company quests.")),
      h("div", null, h("dt", null, "📊 Overview"), h("dd", null, "One product: its quests, latest activity, money, timeline and linked accounts.")),
      h("div", null, h("dt", null, "📈 Marketing side"), h("dd", null, "What the Marketer owns: competitor examples, video lines, content, daily numbers.")),
      h("div", null, h("dt", null, "💻 Developer side"), h("dd", null, "What the Developer owns: the 3 core features, progress log, launch readiness.")),
    ),

    h("h4", { class: "nx-help-h" }, "3 · Quests"),
    h(
      "p",
      null,
      "Quests are jobs only a person can do: logins, filming, payments, signatures and decisions. Claude can write, plan and code, but never logs into your accounts, spends money or signs for you. ",
      "Each quest says ",
      h("strong", null, "who"),
      " (FOR DEV, FOR MARKETING, FOR BOTH), ",
      h("strong", null, "why"),
      ", and ",
      h("strong", null, "where"),
      ". It checks itself off when the work shows up in your notes.",
    ),

    h("h4", { class: "nx-help-h" }, "4 · Where each number comes from"),
    h(
      "dl",
      { class: "nx-help-list" },
      h("div", null, h("dt", null, h("span", { class: "nx-source is-notyet" }, "⏳ Not yet")), h("dd", null, "Nothing exists to measure yet (for example, sales before launch). Nothing to do.")),
      h("div", null, h("dt", null, h("span", { class: "nx-source is-youfill" }, "✍️ Needs you")), h("dd", null, "A person has to type it into a note. The tag says who and where.")),
      h("div", null, h("dt", null, h("span", { class: "nx-source is-typed" }, "✍️ Typed by")), h("dd", null, "Someone already typed it in.")),
      h("div", null, h("dt", null, h("span", { class: "nx-source is-auto" }, "🔌 Auto")), h("dd", null, "Filled by a connected service (Stripe, the scheduler, ads). Coming in the next update.")),
    ),

    h("h4", { class: "nx-help-h" }, "5 · Words"),
    h("dl", { class: "nx-help-list" }, GLOSSARY.map(([w, d]) => h("div", null, h("dt", null, w), h("dd", null, d)))),

    h("h4", { class: "nx-help-h" }, "6 · Keyboard"),
    h(
      "dl",
      { class: "nx-help-list" },
      h("div", null, h("dt", null, "H or Esc"), h("dd", null, "Back to All Products")),
      h("div", null, h("dt", null, "1 · 2 · 3"), h("dd", null, "Overview · Marketing side · Developer side")),
      h("div", null, h("dt", null, "[ and ]"), h("dd", null, "Previous / next product")),
    ),
    h("p", { class: "nx-muted" }, `Dashboard version ${ctx.host.version}. Every ⓘ next to a section explains that section.`),
  ]);
}
