import { describe, expect, it } from "vitest";
import { parseChecklistNote, uniqueBusinessItems } from "../src/data/company";
import { addDays } from "../src/data/dates";
import { sourceTag } from "../src/data/fields";
import { companyQuests, forRole, sprintQuests } from "../src/data/quests";
import { computeStatus } from "../src/data/status";
import { setChecklistLine } from "../src/data/templates";
import { DEFAULT_THRESHOLDS, LedgerRow } from "../src/data/types";
import { product } from "./helpers";

const START = "2026-11-01";
const dayN = (n: number) => addDays(START, n - 1);
const row = (day: number, r: Partial<LedgerRow> = {}): LedgerRow => ({ day, date: "", spend: 0, impressions: 0, clicks: 0, signups: 0, sales: 0, revenue: 0, filled: true, ...r });
const quests = (over: Parameters<typeof product>[0], today: string) => {
  const p = product(over);
  return sprintQuests(p, computeStatus(p, DEFAULT_THRESHOLDS, today), today);
};
const byId = (qs: ReturnType<typeof quests>, id: string) => qs.find((q) => q.id === id);

describe("sprint quests", () => {
  it("queued products have no quests", () => {
    expect(quests({ status: "queued" }, dayN(3))).toEqual([]);
  });
  it("before Day 1 is set, build quests are open as prep and later ones are upcoming", () => {
    const qs = quests({ cycleStart: null }, dayN(1));
    expect(byId(qs, "mkt-accounts")?.state).toBe("now");
    expect(byId(qs, "mkt-accounts")?.when).toBe("Due day 7 · start any time");
    expect(byId(qs, "mkt-first-100")?.state).toBe("upcoming");
    expect(byId(qs, "mkt-post-today")?.state).toBe("upcoming");
  });
  it("handles quest shows progress and finishes when all 3 are set", () => {
    const partial = byId(quests({ handles: { tiktok: "@a", instagram: "", youtube: "", x: "" } }, dayN(3)), "mkt-accounts");
    expect(partial?.progress).toEqual({ done: 1, total: 3 });
    const all = byId(quests({ handles: { tiktok: "@a", instagram: "@b", youtube: "@c", x: "" } }, dayN(3)), "mkt-accounts");
    expect(all?.state).toBe("done");
  });
  it("X joins the handles quest only when the note has an x field", () => {
    const q = byId(quests({ hasXField: true, handles: { tiktok: "@a", instagram: "@b", youtube: "@c", x: "" } }, dayN(3)), "mkt-accounts");
    expect(q?.state).toBe("now");
    expect(q?.progress).toEqual({ done: 3, total: 4 });
  });
  it("overdue after its due day", () => {
    const q = byId(quests({}, dayN(9)), "mkt-accounts");
    expect(q?.state).toBe("overdue");
    expect(q?.when).toBe("Overdue by 2 days (was due day 7)");
  });
  it("record and schedule follow the content backlog", () => {
    const qs = quests({ backlog: { total: 3, scripted: 1, recorded: 1, edited: 0, scheduled: 1 } }, dayN(5));
    expect(byId(qs, "mkt-record")?.progress).toEqual({ done: 2, total: 3 });
    expect(byId(qs, "mkt-schedule")?.progress).toEqual({ done: 1, total: 3 });
    const done = quests({ backlog: { total: 2, scripted: 0, recorded: 0, edited: 0, scheduled: 2 } }, dayN(5));
    expect(byId(done, "mkt-record")?.state).toBe("done");
    expect(byId(done, "mkt-schedule")?.state).toBe("done");
  });
  it("launch checklist lines finish dev quests", () => {
    const qs = quests({ launchItems: [{ text: "Checkout works with a real test purchase (Stripe or platform)", checked: true }, { text: "Build or store listing is live", checked: false }] }, dayN(10));
    expect(byId(qs, "dev-test-purchase")?.state).toBe("done");
    expect(byId(qs, "dev-publish")?.state).toBe("now");
  });
  it("daily quests only show inside their window and reset each day", () => {
    const watching = { status: "watching", lastSocialPostDate: dayN(16) };
    expect(byId(quests(watching, dayN(16)), "mkt-post-today")?.state).toBe("done");
    expect(byId(quests(watching, dayN(17)), "mkt-post-today")?.state).toBe("now");
    expect(byId(quests(watching, dayN(17)), "mkt-post-today")?.when).toBe("Today");
    expect(byId(quests({ ...watching, ledger: [row(17)] }, dayN(17)), "mkt-log-numbers")?.state).toBe("done");
    expect(byId(quests({ ...watching, ledger: [row(17, { filled: false })] }, dayN(17)), "mkt-log-numbers")?.state).toBe("now");
    expect(byId(quests(watching, dayN(10)), "mkt-log-numbers")?.state).toBe("upcoming");
  });
  it("votes open on day 28 and close per partner", () => {
    const qs = quests({ status: "watching", lastSocialPostDate: dayN(28), votes: { dev: "Scale", marketing: "" } }, dayN(28));
    expect(byId(qs, "dev-vote")?.state).toBe("done");
    expect(byId(qs, "mkt-vote")?.state).toBe("now");
  });
  it("role filter keeps shared quests", () => {
    const qs = quests({}, dayN(3));
    expect(forRole(qs, "dev").every((q) => q.owner !== "marketing")).toBe(true);
    expect(forRole(qs, "marketing").some((q) => q.owner === "marketing")).toBe(true);
  });
});

describe("company checklists", () => {
  const setup = [
    "## P0: make the vault work",
    "- [x] Invite your partner",
    "- [ ] Partner installs the **Kanban** plugin #marketing",
    "\t- Plugins don't sync",
    "## P1: company setup",
    "- [ ] EIN (free, IRS website)",
    "- [ ] Decide where code repos live #dev",
  ].join("\n");
  const business = ["## 8. Current status", "- [ ] Business phone number", "- [ ] EIN", "- [x] LLC filed", "## Related"].join("\n");

  it("reads groups, owners from tags, and nested details", () => {
    const items = parseChecklistNote(setup, "S.md");
    expect(items.map((i) => [i.group, i.owner, i.checked, i.text])).toEqual([
      ["P0: make the vault work", "both", true, "Invite your partner"],
      ["P0: make the vault work", "marketing", false, "Partner installs the Kanban plugin"],
      ["P1: company setup", "both", false, "EIN (free, IRS website)"],
      ["P1: company setup", "dev", false, "Decide where code repos live"],
    ]);
    expect(items[1].details).toEqual(["Plugins don't sync"]);
  });
  it("keeps only Business Model items the checklist doesn't cover, from section 8 only", () => {
    const bm = parseChecklistNote(business, "B.md", "Current status");
    expect(bm.map((i) => i.text)).toEqual(["Business phone number", "EIN", "LLC filed"]);
    const unique = uniqueBusinessItems(bm, parseChecklistNote(setup, "S.md"));
    expect(unique.map((i) => i.text)).toEqual(["Business phone number", "LLC filed"]);
  });
  it("company quests carry the tick action and done state", () => {
    const qs = companyQuests(parseChecklistNote(setup, "S.md"), []);
    expect(qs[0].state).toBe("done");
    expect(qs[1].owner).toBe("marketing");
    expect(qs[1].action.kind).toBe("tickChecklist");
  });
  it("setChecklistLine ticks by exact line or by text start, and round-trips", () => {
    const items = parseChecklistNote(setup, "S.md");
    const ticked = setChecklistLine(setup, { line: items[2].raw }, true);
    expect(ticked).toContain("- [x] EIN (free, IRS website)");
    expect(setChecklistLine(ticked, { line: "- [x] EIN (free, IRS website)" }, false)).toBe(setup);
    const launch = "## 1. Product\n- [ ] Checkout works with a real test purchase\n| Developer | [ ] | |";
    expect(setChecklistLine(launch, { textStart: "checkout works" }, true)).toBe("## 1. Product\n- [x] Checkout works with a real test purchase\n| Developer | [ ] | |");
    expect(setChecklistLine(launch, { textStart: "nothing like this" }, true)).toBe(launch);
  });
});

describe("source tags", () => {
  const tag = (over: Parameters<typeof product>[0], today: string, m: Parameters<typeof sourceTag>[0]) => {
    const p = product(over);
    return sourceTag(m, p, computeStatus(p, DEFAULT_THRESHOLDS, today));
  };
  it("before launch nothing is expected", () => {
    expect(tag({}, dayN(5), "revenue")).toEqual({ kind: "notyet", text: "⏳ Not yet · starts day 14 (launch)" });
    expect(tag({}, dayN(5), "spend")).toEqual({ kind: "notyet", text: "⏳ Not yet · starts day 15 (ads)" });
  });
  it("after launch an empty number asks the right person", () => {
    expect(tag({ status: "watching" }, dayN(16), "spend").kind).toBe("youfill");
    expect(tag({ status: "watching" }, dayN(16), "views").text).toBe("✍️ Needs you · Marketing: fill views in Free social stats");
  });
  it("typed numbers say who typed them", () => {
    expect(tag({ status: "watching", ledger: [row(16, { spend: 20 })] }, dayN(16), "spend").kind).toBe("typed");
  });
});
