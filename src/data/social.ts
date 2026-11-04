// Social stats from the scrape kit (Instagram + TikTok), written into the "Free social stats"
// table of Analytics and Gate. Pure: no Obsidian, no files.

import { tableIn, splitRow } from "./markdown";

export type SocialPlatform = "instagram" | "tiktok";
export const SOCIAL_PLATFORMS: SocialPlatform[] = ["tiktok", "instagram"];
export const PLATFORM_LABEL: Record<SocialPlatform, string> = { tiktok: "TikTok", instagram: "Instagram" };

/** What the kit saves in data/<platform>/stats.json. */
export interface SocialStats {
  platform: SocialPlatform;
  handle: string;
  scrapedAt: string;
  followers: number | null;
  postCount: number | null;
  postsScanned: number;
  totalViews: number | null;
  lastPostDate: string | null;
  best: { url: string; views: number | null; likes: number | null } | null;
}

export function parseKitStats(raw: unknown): SocialStats | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.platform !== "instagram" && r.platform !== "tiktok") return null;
  if (typeof r.scrapedAt !== "string" || typeof r.handle !== "string") return null;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const best = r.best && typeof r.best === "object" ? (r.best as Record<string, unknown>) : null;
  return {
    platform: r.platform,
    handle: r.handle,
    scrapedAt: r.scrapedAt,
    followers: n(r.followers),
    postCount: n(r.postCount),
    postsScanned: n(r.postsScanned) ?? 0,
    totalViews: n(r.totalViews),
    lastPostDate: typeof r.lastPostDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.lastPostDate) ? r.lastPostDate : null,
    best: best && typeof best.url === "string" ? { url: best.url, views: n(best.views), likes: n(best.likes) } : null,
  };
}

const MARKER = /^<!--\s*nx-social:(.*?)-->\s*$/m;

/** When each platform was last refreshed, from the hidden note line under the table. */
export function readSocialMarker(body: string): Partial<Record<SocialPlatform, string>> {
  const m = MARKER.exec(body);
  const out: Partial<Record<SocialPlatform, string>> = {};
  if (!m) return out;
  for (const part of m[1].trim().split(/\s+/)) {
    const [k, v] = part.split("=");
    if ((k === "tiktok" || k === "instagram") && v) out[k] = v;
  }
  return out;
}

const fmtNum = (n: number | null) => (n === null ? "" : String(Math.round(n)));

/**
 * Writes each platform's numbers into its row of the "Organic snapshot" table and records the
 * refresh time in one hidden line (an HTML comment, invisible in reading view) right under the table.
 * Rows are matched by the first cell ("TikTok", "Instagram Reels"). Other rows and cells stay as typed.
 */
export function applySocialStats(body: string, stats: SocialStats[]): string {
  const t = tableIn(body, "organic");
  if (!t) throw new Error("Couldn't find the Free social stats table (Organic snapshot) in Analytics and Gate.");
  const lines = body.split("\n");
  const headerIdx = lines.findIndex((l) => l.trim().startsWith("|") && splitRow(l).join("|") === t.headers.join("|"));
  if (headerIdx === -1) throw new Error("Couldn't find the Free social stats table header.");
  const headers = t.headers.map((h) => h.toLowerCase());
  const colOf = (...keys: string[]) => headers.findIndex((h) => keys.some((k) => h.includes(k)));
  const cFollowers = colOf("followers");
  const cViews = colOf("total views");
  const cLink = colOf("best video link", "link");
  const cBestViews = colOf("best video views");

  let end = headerIdx + 2;
  while (end < lines.length && lines[end].trim().startsWith("|")) end++;

  for (const s of stats) {
    const rowIdx = lines.slice(headerIdx + 2, end).findIndex((l) => splitRow(l)[0]?.toLowerCase().startsWith(s.platform === "tiktok" ? "tiktok" : "instagram"));
    if (rowIdx === -1) continue;
    const i = headerIdx + 2 + rowIdx;
    const cells = splitRow(lines[i]);
    while (cells.length < t.headers.length) cells.push("");
    const set = (c: number, v: string) => {
      if (c >= 0 && v !== "") cells[c] = v;
    };
    set(cFollowers, fmtNum(s.followers));
    set(cViews, fmtNum(s.totalViews));
    set(cLink, s.best?.url ?? "");
    set(cBestViews, fmtNum(s.best?.views ?? null));
    lines[i] = `| ${cells.join(" | ")} |`;
  }

  const prev = readSocialMarker(body);
  for (const s of stats) prev[s.platform] = s.scrapedAt.slice(0, 16);
  const marker = `<!-- nx-social: ${SOCIAL_PLATFORMS.filter((p) => prev[p]).map((p) => `${p}=${prev[p]}`).join(" ")} -->`;
  const existing = lines.findIndex((l) => MARKER.test(l));
  if (existing !== -1) lines[existing] = marker;
  else if ((lines[end] ?? "").trim() === "") lines.splice(end + 1, 0, marker, "");
  else lines.splice(end, 0, "", marker);
  return lines.join("\n");
}

/** Newest post date across platforms, if it's later than what the note already has. */
export function newerPostDate(current: string | null, stats: SocialStats[]): string | null {
  const dates = stats.map((s) => s.lastPostDate).filter((d): d is string => !!d).sort();
  const newest = dates.at(-1) ?? null;
  if (!newest) return null;
  return !current || newest > current ? newest : null;
}
