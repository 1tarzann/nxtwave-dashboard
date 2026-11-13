import { describe, expect, it } from "vitest";
import { parseChecklistNote, uniqueBusinessItems } from "../src/data/company";
import { addDays } from "../src/data/dates";
import { sourceTag } from "../src/data/fields";
import { parseMarketing } from "../src/data/marketing";
import { parseProfile } from "../src/data/profile";
import { companyQuests, forRole, sprintQuests } from "../src/data/quests";
import { buildSnapshot } from "../src/data/snapshot";
import { computeStatus } from "../src/data/status";
import { setChecklistLine } from "../src/data/templates";
import { DEFAULT_THRESHOLDS, LedgerRow } from "../src/data/types";
import { doc, product } from "./helpers";
import * as S from "./samples";

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
  it("the videos and brand kit quests go to the dashboard's own sections, never to the note", () => {
    const qs = quests({}, dayN(5));
    for (const id of ["mkt-record", "mkt-schedule"]) {
      expect(byId(qs, id), id).toMatchObject({ where: "Marketing side → Videos to make", action: { kind: "section", label: "Go to Videos", tab: "marketing", id: "videos" } });
    }
    expect(byId(qs, "mkt-stripe")).toMatchObject({ where: "Marketing side → Brand kit", action: { kind: "section", label: "Go to Brand kit", tab: "marketing", id: "brandkit" } });
    expect(byId(quests({ status: "scaled" }, dayN(5)), "mkt-record")?.action.kind ?? "section").toBe("section");
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

describe("competitor research quests", () => {
  const profileOf = (spec: string) => parseProfile(spec, S.frontmatterOf(spec), {});
  const COMPLETE = profileOf(S.SPEC_FILLED);
  const EMPTY = profileOf(S.SPEC_EMPTY);
  const REQUEST = "nx-research-request: date=2026-11-18";
  /** Research quests for Demo_Tool with this Marketing Engine and Dev Spec profile. Day 1 is unset unless given. */
  const research = (note: string | null, over: Parameters<typeof product>[0], today: string) =>
    quests({ name: "Demo_Tool", cycleStart: null, profile: COMPLETE, marketing: note === null ? null : parseMarketing(note), ...over }, today).filter((q) =>
      ["dev-profile", "dev-research", "mkt-review"].includes(q.id),
    );
  const one = (qs: ReturnType<typeof research>, id: string) => {
    const q = byId(qs, id);
    expect(q, id).toBeDefined();
    return q!;
  };

  it("dev-profile: open while building with an incomplete profile, even before Day 1", () => {
    const q = one(research(S.MKT_V2_TEMPLATE, { profile: EMPTY }, "2026-11-13"), "dev-profile");
    expect(q).toMatchObject({ owner: "dev", state: "now", when: "Due day 2 · start any time", progress: { done: 0, total: 7 } });
    expect(q.why).toBe("Competitor research needs 7 facts about the product. Still missing: Product type, One-line pitch, Who buys it, Job it does, Price, Target platforms and Core mechanic.");
    expect(q.where).toBe("Dev Spec → Product type (in the properties at the top)");
    expect(q.action).toEqual({ kind: "openDoc", label: "Open Dev Spec", doc: "spec", heading: "pitch" });
    const spanOnly = one(research(null, { profile: profileOf(S.SPEC_SPAN_ONLY) }, "2026-11-13"), "dev-profile");
    expect(spanOnly).toMatchObject({ progress: { done: 4, total: 7 }, where: "Dev Spec → 1. One-line pitch (the lines under the pitch)" });
    expect(spanOnly.why).toContain("Still missing: Who buys it, Job it does and Price.");
  });

  it("dev-profile: due on day 2, or the day after a waiting research request; checked off when complete", () => {
    const withDay1 = (today: string) => one(research(null, { cycleStart: START, profile: EMPTY }, today), "dev-profile");
    expect(withDay1(dayN(1)).when).toBe("Due tomorrow");
    expect(withDay1(dayN(2))).toMatchObject({ state: "now", when: "Due today" });
    expect(withDay1(dayN(5))).toMatchObject({ state: "overdue", when: "Overdue by 3 days (was due Nov 2)" });
    const asked = one(research(S.MKT_V2_REQUESTED, { profile: EMPTY }, "2026-11-18"), "dev-profile");
    expect(asked.when).toBe("Due tomorrow");
    expect(one(research(S.MKT_V2_REQUESTED, { profile: COMPLETE }, "2026-11-18"), "dev-profile")).toMatchObject({ state: "done", when: "Done" });
  });

  it("dev-profile only shows while the sprint is building", () => {
    expect(byId(research(null, { status: "watching", cycleStart: START, profile: EMPTY }, dayN(16)), "dev-profile")).toBeUndefined();
    expect(byId(research(null, { status: "extended", cycleStart: START, profile: EMPTY }, dayN(30)), "dev-profile")).toBeUndefined();
  });

  it("dev-research: open while a request is newer than the research; the button copies the command", () => {
    expect(byId(research(S.MKT_V2_TEMPLATE, {}, "2026-11-18"), "dev-research")).toBeUndefined();
    const q = one(research(S.MKT_V2_REQUESTED, {}, "2026-11-18"), "dev-research");
    expect(q).toMatchObject({ owner: "dev", state: "now", when: "Due tomorrow" });
    expect(q.why).toBe("The Marketer asked for it today: 3 real competitors and 10 rated video openings, written into the Marketing Engine.");
    expect(q.action).toEqual({ kind: "copy", label: "Copy command", text: "/competitors Demo_Tool" });
    expect(q.open).toBeUndefined();
    expect(one(research(S.MKT_V2_REQUESTED, {}, "2026-11-21"), "dev-research")).toMatchObject({ state: "overdue", when: "Overdue by 2 days (was due Nov 19)" });
    expect(one(research(S.MKT_V2_REQUESTED.replace("by=marketing", "by=dev"), {}, "2026-11-20"), "dev-research").why).toMatch(/^The Developer asked for it 2 days ago:/);
  });

  it("dev-research: says it's blocked while the profile is incomplete", () => {
    const q = one(research(S.MKT_V2_REQUESTED, { profile: profileOf(S.SPEC_SPAN_ONLY) }, "2026-11-19"), "dev-research");
    expect(q.why).toBe("Blocked by the product profile: /competitors won't start until Who buys it, Job it does and Price are filled in. The Marketer asked for it yesterday.");
    expect(q.open).toEqual({ doc: "spec", heading: "pitch", label: "Open Dev Spec" });
    expect(q.state).toBe("now");
  });

  it("dev-research: checked off by research after the request, and opens again for a newer request", () => {
    expect(one(research(S.MKT_V2_RESEARCHED, {}, "2026-11-20"), "dev-research").state).toBe("done");
    // A run deletes the request marker (note-apply), so a same-day request that's still there came after the run.
    const sameDay = S.MKT_V2_RESEARCHED.replace(REQUEST, "nx-research-request: date=2026-11-20");
    expect(one(research(sameDay, {}, "2026-11-20"), "dev-research").state).toBe("now");
    // The run removed the request: nothing left to do, and no quest.
    const consumed = S.MKT_V2_RESEARCHED.replace(/^<!-- nx-research-request:[^\n]*\n/m, "");
    expect(consumed).not.toBe(S.MKT_V2_RESEARCHED);
    expect(byId(research(consumed, {}, "2026-11-20"), "dev-research")).toBeUndefined();
    const askedAgain = S.MKT_V2_RESEARCHED.replace(REQUEST, "nx-research-request: date=2026-11-22");
    expect(askedAgain).not.toBe(S.MKT_V2_RESEARCHED);
    expect(one(research(askedAgain, {}, "2026-11-22"), "dev-research")).toMatchObject({ state: "now", when: "Due tomorrow" });
  });

  it("mkt-review: once research exists, until both parts are reviewed on or after the research date", () => {
    expect(byId(research(S.MKT_V2_REQUESTED, {}, "2026-11-20"), "mkt-review")).toBeUndefined();
    const q = one(research(S.MKT_V2_RESEARCHED, {}, "2026-11-20"), "mkt-review");
    expect(q).toMatchObject({ owner: "marketing", state: "now", when: "Due Nov 22 · in 2 days", progress: { done: 0, total: 2 } });
    expect(q.action).toEqual({ kind: "section", label: "Review competitors and hooks", tab: "marketing", id: "competitors" });
    expect(one(research(S.MKT_V2_REVIEWED, {}, "2026-11-21"), "mkt-review")).toMatchObject({ state: "now", when: "Due tomorrow", progress: { done: 1, total: 2 } });
    expect(one(research(S.MKT_V2_RESEARCHED, {}, "2026-11-25"), "mkt-review")).toMatchObject({ state: "overdue", when: "Overdue by 3 days (was due Nov 22)" });
    const both = S.MKT_V2_REVIEWED.replace("competitors=2026-11-21", "competitors=2026-11-21 hooks=2026-11-20");
    expect(one(research(both, {}, "2026-11-21"), "mkt-review").state).toBe("done");
    const stale = S.MKT_V2_REVIEWED.replace("competitors=2026-11-21", "competitors=2026-11-19 hooks=2026-11-19");
    expect(one(research(stale, {}, "2026-11-21"), "mkt-review").progress).toEqual({ done: 0, total: 2 });
  });

  it("a due date in another year shows the year", () => {
    const lateResearch = S.MKT_V2_RESEARCHED.replace("nx-research: date=2026-11-20", "nx-research: date=2026-12-31");
    expect(one(research(lateResearch, {}, "2026-12-31"), "mkt-review").when).toBe("Due Jan 2, 2027 · in 2 days");
  });

  it("never for queued, scaled or killed products", () => {
    for (const status of ["queued", "scaled", "killed"]) expect(research(S.MKT_V2_REVIEWED, { status, profile: EMPTY }, "2026-11-21"), status).toEqual([]);
  });

  it("come first, and leave every other quest as it was", () => {
    const before = quests({}, dayN(3)).map((q) => q.id);
    const withResearch = quests({ marketing: parseMarketing(S.MKT_V2_RESEARCHED), profile: COMPLETE }, dayN(3));
    expect(withResearch.map((q) => q.id)).toEqual(["dev-profile", "dev-research", "mkt-review", ...before.filter((id) => id !== "dev-profile")]);
    const others = (qs: ReturnType<typeof quests>) => qs.filter((q) => !["dev-profile", "dev-research", "mkt-review"].includes(q.id));
    expect(others(withResearch)).toEqual(others(quests({}, dayN(3))));
  });

  it("read straight from the notes", () => {
    const hub = doc("x/Demo_Tool_Hub.md", { sprint_status: "building" });
    const snap = (mkt: string, spec: string) =>
      buildSnapshot("Demo_Tool", "x", { marketing: doc("2_Marketing_Engine.md", S.frontmatterOf(mkt), mkt), spec: doc("1_Dev_Spec.md", S.frontmatterOf(spec), spec) }, hub);
    const ids = (mkt: string, spec: string, today: string) => {
      const p = snap(mkt, spec);
      return sprintQuests(p, computeStatus(p, DEFAULT_THRESHOLDS, today), today)
        .filter((q) => q.state !== "done" && ["dev-profile", "dev-research", "mkt-review"].includes(q.id))
        .map((q) => q.id);
    };
    expect(ids(S.MKT_V2_TEMPLATE, S.SPEC_EMPTY, "2026-11-13")).toEqual(["dev-profile"]);
    expect(ids(S.MKT_V2_REQUESTED, S.SPEC_NO_TABLE, "2026-11-18")).toEqual(["dev-profile", "dev-research"]);
    expect(ids(S.MKT_V2_REQUESTED, S.SPEC_FILLED, "2026-11-18")).toEqual(["dev-research"]);
    expect(ids(S.MKT_V2_RESEARCHED, S.SPEC_FILLED, "2026-11-20")).toEqual(["mkt-review"]);
    expect(ids(S.MKT_V1_FILLED, S.SPEC_FILLED, "2026-11-20")).toEqual([]);
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
