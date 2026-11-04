import { describe, expect, it } from "vitest";
import { addDays } from "../src/data/dates";
import { computeStatus, nextActions } from "../src/data/status";
import { parseThresholds } from "../src/data/thresholds";
import { DEFAULT_THRESHOLDS, LedgerRow } from "../src/data/types";
import { product } from "./helpers";

const START = "2026-11-01";
const dayN = (n: number) => addDays(START, n - 1);
const th = DEFAULT_THRESHOLDS;
const row = (day: number, r: Partial<LedgerRow>): LedgerRow => ({ day, date: "", spend: 0, impressions: 0, clicks: 0, signups: 0, sales: 0, revenue: 0, filled: true, ...r });

describe("grey states", () => {
  it("queued", () => {
    expect(computeStatus(product({ status: "queued" }), th, dayN(5)).key).toBe("queued");
  });
  it("building with no cycle_start offers Start Day 1", () => {
    const s = computeStatus(product({ cycleStart: null }), th, dayN(5));
    expect(s.key).toBe("unstarted");
    expect(s.action?.kind).toBe("startDay1");
  });
  it("scaled and killed are closed", () => {
    expect(computeStatus(product({ status: "scaled" }), th, dayN(5)).key).toBe("closed");
    expect(computeStatus(product({ status: "killed" }), th, dayN(5)).key).toBe("closed");
  });
});

describe("build phase (days 1–14)", () => {
  it("day 1 is healthy: grace period counts from cycle_start", () => {
    expect(computeStatus(product(), th, dayN(1)).key).toBe("healthy");
  });
  it("day 3 still healthy (2 quiet days) with a stale-tomorrow warning", () => {
    const s = computeStatus(product({ marketingTouched: dayN(3) }), th, dayN(3));
    expect(s.key).toBe("healthy");
    expect(s.info).toEqual(["Goes quiet tomorrow without a Changelog entry"]);
    expect(s.reason).toBe("Progress logged not yet · marketing edited today");
  });
  it("stale after 3 days with no changelog entry", () => {
    const s = computeStatus(product({ marketingTouched: dayN(4) }), th, dayN(4));
    expect(s.key).toBe("stale");
    expect(s.reason).toBe("No progress logged in the Changelog for 3 days");
    expect(s.action?.doc).toBe("changelog");
  });
  it("stale when the marketing file is untouched for 3 days", () => {
    const s = computeStatus(product({ lastChangelogDate: dayN(6), marketingTouched: dayN(3) }), th, dayN(6));
    expect(s.key).toBe("stale");
    expect(s.reason).toBe("Marketing notes untouched for 3 days");
    expect(s.action?.doc).toBe("marketing");
  });
  it("both quiet: the longer one leads, the other is an info line", () => {
    const s = computeStatus(product({ lastChangelogDate: dayN(2), marketingTouched: dayN(4) }), th, dayN(8));
    expect(s.reason).toBe("No progress logged in the Changelog for 6 days");
    expect(s.info).toEqual(["Marketing notes untouched for 4 days"]);
  });
  it("social posts don't matter before launch", () => {
    const s = computeStatus(product({ lastChangelogDate: dayN(9), marketingTouched: dayN(9) }), th, dayN(10));
    expect(s.key).toBe("healthy");
  });
});

describe("gates", () => {
  it("day 14 is the launch gate even if stale", () => {
    const s = computeStatus(product(), th, dayN(14));
    expect(s.key).toBe("gate");
    expect(s.action?.doc).toBe("launch");
  });
  it("day 28 is verdict day", () => {
    const s = computeStatus(product({ status: "watching", lastSocialPostDate: dayN(28) }), th, dayN(28));
    expect(s.key).toBe("gate");
    expect(s.action?.heading).toBe("Day-28 verdict");
  });
  it("overdue verdict after day 28 stays amber", () => {
    const s = computeStatus(product({ status: "watching", lastSocialPostDate: dayN(30) }), th, dayN(30));
    expect(s.label).toBe("DECISION OVERDUE");
  });
  it("extended sprints gate on day 35, not 28-overdue", () => {
    const p = product({ status: "extended", lastSocialPostDate: dayN(31) });
    expect(computeStatus(p, th, dayN(31)).key).toBe("healthy");
    expect(computeStatus(p, th, dayN(35)).key).toBe("gate");
  });
});

describe("watch phase (days 15–28)", () => {
  it("day 15 → 16: grace from launch day", () => {
    expect(computeStatus(product({ status: "watching" }), th, dayN(16)).key).toBe("healthy");
  });
  it("no post for 3 days → stale with Posted today", () => {
    const s = computeStatus(product({ status: "watching", lastSocialPostDate: dayN(16) }), th, dayN(19));
    expect(s.key).toBe("stale");
    expect(s.reason).toBe("No social post in 3 days");
    expect(s.action?.kind).toBe("postedToday");
  });
  it("marketing edits don't count after launch", () => {
    const s = computeStatus(product({ status: "watching", lastSocialPostDate: dayN(15), marketingTouched: dayN(19) }), th, dayN(19));
    expect(s.key).toBe("stale");
  });
  it("quiet developer is info only by default", () => {
    const s = computeStatus(product({ status: "watching", lastSocialPostDate: dayN(20), lastChangelogDate: dayN(14) }), th, dayN(20));
    expect(s.key).toBe("healthy");
    expect(s.info).toEqual(["Developer quiet 6 days (normal after launch: bug fixes only)"]);
  });
  it("quiet developer turns stale when partners enable it", () => {
    const t = { ...th, staleDevAfterLaunchDays: 5 };
    const s = computeStatus(product({ status: "watching", lastSocialPostDate: dayN(20), lastChangelogDate: dayN(14) }), t, dayN(20));
    expect(s.key).toBe("stale");
    expect(s.reason).toBe("No developer progress logged for 6 days");
  });
});

describe("kill signal", () => {
  const watching = { status: "watching", lastSocialPostDate: dayN(21) };
  it("$100 spent, 0 sales from day 21", () => {
    const p = product({ ...watching, ledger: [row(15, { spend: 60 }), row(16, { spend: 40 })] });
    expect(computeStatus(p, th, dayN(20)).key).toBe("healthy");
    const s = computeStatus(p, th, dayN(21));
    expect(s.key).toBe("kill");
    expect(s.reason).toBe("$100 spent, 0 sales or sign-ups");
  });
  it("one sign-up prevents the spend kill", () => {
    const p = product({ ...watching, ledger: [row(15, { spend: 120, signups: 1 })] });
    expect(computeStatus(p, th, dayN(21)).key).toBe("healthy");
  });
  it("frontmatter total_spend counts when the ledger is empty", () => {
    const p = product({ ...watching, totalSpendFm: 150 });
    expect(computeStatus(p, th, dayN(21)).key).toBe("kill");
  });
  it("CTR check is off until partners set kill_min_ctr", () => {
    const p = product({ ...watching, ledger: [row(15, { impressions: 10000, clicks: 10, sales: 1 })] });
    expect(computeStatus(p, th, dayN(22)).key).toBe("healthy");
    const s = computeStatus(p, { ...th, killMinCtr: 0.8 }, dayN(22));
    expect(s.key).toBe("kill");
    expect(s.reason).toBe("Only 0.10% of people who saw the ad clicked (your minimum is 0.8%)");
  });
  it("verdict: kill beats everything", () => {
    expect(computeStatus(product({ verdict: "kill" }), th, dayN(14)).key).toBe("kill");
  });
  it("kill beats gate on day 28", () => {
    const p = product({ ...watching, lastSocialPostDate: dayN(28), totalSpendFm: 200 });
    expect(computeStatus(p, th, dayN(28)).key).toBe("kill");
  });
});

describe("thresholds", () => {
  it("defaults when Launch_Framework has no fields", () => {
    expect(parseThresholds({ doc_type: "x" })).toEqual({ ...DEFAULT_THRESHOLDS, missing: true });
  });
  it("reads partner values, empty CTR stays off", () => {
    const t = parseThresholds({ kill_spend_no_sales: 150, kill_min_ctr: null, stale_days: "4", stale_dev_after_launch_days: "" });
    expect(t).toEqual({ killSpendNoSales: 150, killMinCtr: null, staleDays: 4, staleDevAfterLaunchDays: null, missing: false });
  });
});

describe("do this next", () => {
  it("orders kill → gate → stale → unstarted and skips healthy/queued", () => {
    const today = dayN(21);
    const data = {
      hqRoot: "HQ",
      categories: [],
      setup: [],
      businessModel: [],
      today,
      thresholds: th,
      archive: { scaled: [], killed: [] },
      ideas: [],
      products: [
        product({ name: "A", cycleStart: null }),
        product({ name: "B", status: "queued" }),
        product({ name: "C", status: "watching", lastSocialPostDate: dayN(15) }),
        product({ name: "D", status: "watching", totalSpendFm: 100 }),
        product({ name: "E", status: "watching", cycleStart: addDays(today, -13) }),
      ],
    };
    expect(nextActions(data).map((a) => `${a.product.name}:${a.status.key}`)).toEqual(["D:kill", "E:gate", "C:stale", "A:unstarted"]);
  });
});
