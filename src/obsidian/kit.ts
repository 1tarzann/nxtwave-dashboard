// Runs the social-scrape-kit (Instagram + TikTok) from inside Obsidian. Desktop only: it starts the
// kit's own browser on this computer. Nothing here runs on a timer; only a button press calls it.

import { Platform } from "obsidian";
import { parseKitStats, PLATFORM_LABEL, SocialPlatform, SocialStats } from "../data/social";

export interface KitSettings {
  kitPath: string;
  nodePath: string;
}

/* eslint-disable @typescript-eslint/no-var-requires */
const fs = () => require("fs") as typeof import("fs");
const pathMod = () => require("path") as typeof import("path");
const os = () => require("os") as typeof import("os");

function expand(p: string): string {
  return p.startsWith("~") ? pathMod().join(os().homedir(), p.slice(1)) : p;
}

function findNode(configured: string): string | null {
  const candidates = configured.trim()
    ? [expand(configured.trim())]
    : ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node", "C:\\Program Files\\nodejs\\node.exe"];
  return candidates.find((c) => fs().existsSync(c)) ?? null;
}

export interface KitCheck {
  ok: boolean;
  /** Plain-English reason when not ok. */
  reason: string;
  node?: string;
  dir?: string;
}

export function checkKit(s: KitSettings): KitCheck {
  if (!Platform.isDesktopApp) return { ok: false, reason: "Refreshing only works in Obsidian on a computer, not on a phone." };
  const dir = expand(s.kitPath.trim() || "~/Developer/social-scrape-kit");
  if (!fs().existsSync(pathMod().join(dir, "kit.js"))) return { ok: false, reason: `The scrape kit isn't set up on this computer (looked in ${dir}). See Settings → NXTWAVE Dashboard.` };
  if (!fs().existsSync(pathMod().join(dir, "node_modules", "playwright"))) return { ok: false, reason: "The scrape kit is missing its browser parts. Run “npm install” in its folder once." };
  const node = findNode(s.nodePath);
  if (!node) return { ok: false, reason: "Couldn't find Node.js on this computer. Set its location in Settings → NXTWAVE Dashboard." };
  return { ok: true, reason: "", node, dir };
}

function run(check: KitCheck, args: string[], timeoutMs: number): Promise<{ code: number; out: string }> {
  const cp = require("child_process") as typeof import("child_process");
  const env = { ...process.env, PATH: [pathMod().dirname(check.node as string), process.env.PATH ?? ""].join(pathMod().delimiter), CRAWL4AI_NO_CLOUD_NOTICE: "1" };
  return new Promise((resolve) => {
    cp.execFile(check.node as string, ["kit.js", ...args], { cwd: check.dir, env, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === "number" ? ((err as { code: number }).code) : 1) : 0;
      resolve({ code, out: `${stdout}\n${stderr}`.trim() });
    });
  });
}

/** Turns the kit's error output into one sentence a partner can act on. */
function explain(platform: SocialPlatform, out: string): string {
  const label = PLATFORM_LABEL[platform];
  if (/Not logged in/i.test(out)) return `${label}: not logged in on this computer. Use “Log in to ${label}” in Settings → NXTWAVE Dashboard (one time).`;
  if (/Couldn't find/i.test(out)) return `${label}: the page loaded but the numbers weren't where the reader expected (the app may have changed). Details are in the scrape kit's data/${platform} folder.`;
  if (/timed out|ETIMEDOUT|SIGTERM/i.test(out)) return `${label}: took longer than 3 minutes and was stopped. Try again later.`;
  const last = out.split("\n").filter(Boolean).at(-1) ?? "unknown error";
  return `${label}: ${last.slice(0, 200)}`;
}

/** One stats run for one account. Returns the numbers, or a plain-English error. */
export async function runStats(s: KitSettings, platform: SocialPlatform, handle: string): Promise<{ stats?: SocialStats; error?: string }> {
  const check = checkKit(s);
  if (!check.ok) return { error: check.reason };
  const started = Date.now();
  const { code, out } = await run(check, ["run", platform, "stats", handle], 180_000);
  if (code !== 0) return { error: explain(platform, out) };
  try {
    const file = pathMod().join(check.dir as string, "data", platform, "stats.json");
    const stats = parseKitStats(JSON.parse(fs().readFileSync(file, "utf8")));
    if (!stats || Date.parse(stats.scrapedAt) < started - 5_000) return { error: `${PLATFORM_LABEL[platform]}: the kit finished but didn't save new numbers.` };
    return { stats };
  } catch {
    return { error: `${PLATFORM_LABEL[platform]}: the kit finished but its stats file couldn't be read.` };
  }
}

/** Opens a visible browser window so a partner can sign in by hand. Resolves when the window closes. */
export async function runLogin(s: KitSettings, platform: SocialPlatform): Promise<string | null> {
  const check = checkKit(s);
  if (!check.ok) return check.reason;
  const { code, out } = await run(check, ["login", platform], 10 * 60_000);
  return code === 0 ? null : explain(platform, out);
}

/** The kit's own self-check, as plain text. */
export async function runDoctor(s: KitSettings): Promise<string> {
  const check = checkKit(s);
  if (!check.ok) return check.reason;
  const { out } = await run(check, ["doctor"], 60_000);
  return out;
}
