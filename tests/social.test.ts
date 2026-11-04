import { describe, expect, it } from "vitest";
import { buildSnapshot } from "../src/data/snapshot";
import { applySocialStats, newerPostDate, parseKitStats, readSocialMarker, SocialStats } from "../src/data/social";
import { doc, fixture, hasFixtures } from "./helpers";

const tiktok: SocialStats = {
  platform: "tiktok",
  handle: "@demo_tool",
  scrapedAt: "2026-11-04T22:30:12.000Z",
  followers: 1500,
  postCount: 2,
  postsScanned: 2,
  totalViews: 23500,
  lastPostDate: "2026-11-04",
  best: { url: "https://www.tiktok.com/@demo_tool/video/111", views: 20000, likes: 900 },
};

const padded = [
  "## 2. Organic snapshot",
  "| Platform        | Followers | Total views | Best video link | Best video views |",
  "| --------------- | --------- | ----------- | --------------- | ---------------- |",
  "| TikTok          |           |             |                 |                  |",
  "| Instagram Reels |           |             |                 |                  |",
  "| YouTube Shorts  | 38        | 2,200       |                 |                  |",
  "",
  "## 3. Extension (optional, one video, days 29–35)",
].join("\n");

describe("kit stats file", () => {
  it("accepts the kit's file and rejects junk", () => {
    expect(parseKitStats(tiktok)).toEqual(tiktok);
    expect(parseKitStats({ platform: "pinterest" })).toBeNull();
    expect(parseKitStats(null)).toBeNull();
    expect(parseKitStats({ ...tiktok, lastPostDate: "yesterday" })?.lastPostDate).toBeNull();
  });
});

describe("writing into the Free social stats table", () => {
  it("fills only the matching row, keeps typed rows, adds one hidden refresh line", () => {
    const out = applySocialStats(padded, [tiktok]);
    expect(out).toContain("| TikTok | 1500 | 23500 | https://www.tiktok.com/@demo_tool/video/111 | 20000 |");
    expect(out).toContain("| Instagram Reels |           |             |                 |                  |");
    expect(out).toContain("| YouTube Shorts  | 38        | 2,200       |                 |                  |");
    expect(out).toContain("<!-- nx-social: tiktok=2026-11-04T22:30 -->");
    expect(out.indexOf("<!-- nx-social")).toBeLessThan(out.indexOf("## 3. Extension"));
    expect(readSocialMarker(out)).toEqual({ tiktok: "2026-11-04T22:30" });
  });
  it("a second refresh updates the same line instead of adding another", () => {
    const once = applySocialStats(padded, [tiktok]);
    const twice = applySocialStats(once, [{ ...tiktok, platform: "instagram", handle: "@demo.tool", scrapedAt: "2026-11-05T09:00:00Z", followers: 96 }]);
    expect(twice.match(/nx-social/g)).toHaveLength(1);
    expect(readSocialMarker(twice)).toEqual({ tiktok: "2026-11-04T22:30", instagram: "2026-11-05T09:00" });
    expect(twice).toContain("| Instagram Reels | 96 |");
  });
  it("missing numbers don't erase what was typed", () => {
    const typed = padded.replace("| TikTok          |           |", "| TikTok          | 999       |");
    const out = applySocialStats(typed, [{ ...tiktok, followers: null }]);
    expect(out).toContain("| TikTok | 999 | 23500 |");
  });
  it("the dashboard reads the refresh time back", () => {
    const p = buildSnapshot("D", "D", { analytics: doc("a.md", {}, applySocialStats(padded, [tiktok])) });
    expect(p.socialRefreshed).toEqual({ tiktok: "2026-11-04T22:30" });
    expect(p.organic[0]).toMatchObject({ platform: "TikTok", followers: 1500, totalViews: 23500 });
  });
});

describe.skipIf(!hasFixtures)("real template", () => {
  it("works on the untouched Analytics template", () => {
    const out = applySocialStats(fixture("TPL_3_Analytics_And_Gate.md"), [tiktok]);
    expect(out).toContain("| TikTok | 1500 | 23500 |");
    expect(out).toContain("## 3. Extension");
  });
});

describe("last post date", () => {
  it("only moves forward", () => {
    expect(newerPostDate("2026-11-01", [tiktok])).toBe("2026-11-04");
    expect(newerPostDate("2026-11-05", [tiktok])).toBeNull();
    expect(newerPostDate(null, [{ ...tiktok, lastPostDate: null }])).toBeNull();
  });
});
