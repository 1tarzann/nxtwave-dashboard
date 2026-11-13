# NXTWAVE Dashboard

An Obsidian plugin for a 2-partner sprint vault: color-coded product squares, a 3-level drill-down (Home → Product Hub → Marketing / Dev side) and one-click sprint actions.

## Install (each partner, once)
1. Obsidian → Settings → Community plugins → Browse → **BRAT** → Install → Enable.
2. Settings → BRAT → **Add beta plugin** → paste `1tarzann/nxtwave-dashboard` → Add plugin.
3. Settings → BRAT → turn on **Auto-update plugins at startup**.
4. Settings → Community plugins → enable **NXTWAVE Dashboard**. Open it from the ribbon icon or Cmd/Ctrl+P → "NXTWAVE Dashboard: Open dashboard".

## What it shows
- **Home:** every product as a square. Color + icon + word: ✕ KILL SIGNAL (maroon), ⚑ GATE TODAY (amber), ⏸ STALE (pink-red), ✓ HEALTHY (emerald), grey for queued / clock not started. A "Do this next" banner names the single most urgent fix.
- **Product hub:** status banner with its fix button, last post / last dev update, spend · views · clicks · revenue, the 28-day timeline, connection pills, social stats, and doors to the Marketing and Dev sides.
- **Buttons that write:** Start Day 1, Posted today, Connect handle / repo, New Sprint wizard. Each edits only the frontmatter lines it names and offers Undo for 5 seconds.

## Quests
Jobs only a person can do (logins, filming, payments, signatures, votes), each tagged **FOR DEV**, **FOR MARKETING** or **FOR BOTH**, with why it matters, why Claude can't do it, and where to do it.
- **Home:** open items from `SETUP_CHECKLIST.md` (grouped P0–P3) plus Business Model §8 items the checklist doesn't cover. Add `#dev` or `#marketing` to a checklist line to assign it. **Mark done** ticks the line (with Undo).
- **Each product:** sprint quests from the 28-day plan (accounts, videos, checkout, break-it test, test purchase, publish, sign-offs, first $100, daily post and numbers, votes). They check themselves off when the work shows up in the notes.
- Settings → **Who uses this device?** sets which quests show first.

## Marketing editor (0.5.0)
The Marketer can fill in and review the whole Marketing Engine on the dashboard, without opening the note. Every change is saved straight into the note, so it looks the same in Obsidian and on your partner's Mac.

**What you can change**
- **Marketing side:** the 3 **Competitors**, the 10 **Hooks** (grouped 🟢 Recommended, 🟡 Medium, 🔴 Don't use), **Videos to make** (add, edit, delete, and tap Scripted → Recorded → Edited → Scheduled), each line of the **Brand kit**, and the **Paid test plan**. Each part has an **Edit** button that opens one small form. **Use in a video** on a hook adds a new video that uses it.
- **Developer side:** the **Product profile** line shows which of the 7 facts competitor research needs are still missing. **Fill in** saves Who buys it, Job it does and Price; the other 4 get an **Open Dev Spec** button.
- The counters at the top of the Marketing side jump to their part of the page. **Open Marketing Engine →** at the bottom opens the note itself.
- From day 15 (after launch), the Paid test plan, the spend chart and the social stats move to the top.
- A product that is waiting in line, or already scaled or killed, shows everything read-only.

**Green examples.** An empty box shows a green, slanted hint such as *e.g. Link in bio.* It shows the shape of an answer and never counts as filled in. Type over it, here or in the note. If you empty a box and save, the hint comes back.

**Ask for research and /competitors.** Press **Ask for research** on the Competitors part. The Developer then gets a quest with a **Copy command** button: paste `/competitors <product name>` into Claude Code. Research only starts once the product profile has all 7 facts. It fills in 3 real competitors and 10 rated hooks. A slot it can't fill says "Research couldn't fill this" and why, instead of holding a weak match.

**Looks good.** Research is a draft until the Marketer checks it. Read the competitors and the hooks, fix anything with Edit, then press **Looks good** on each part. The review quest ticks itself off. After a new research run, Looks good shows up again.

**Built-in checks.** A Stripe secret key is refused everywhere: paste the payment link (https://buy.stripe.com/…) instead. A paid test budget over $300 in total is refused (split budgets like "$200 + $200" add up; "$100 first, $300 at most", "$100 first, scale to $300" and "$300 total" are fine). You get a warning, but can still save, when ads start before day 15, when a hook is longer than 12 spoken words, or when a video uses a Don't use hook.

**When you both edit the same spot.** Relay merges both partners' edits line by line.
- If your partner changes a box while your form is open: in a box you haven't typed in, the form takes their text and tells you ("Your partner just changed Hook, so it now shows their text."). In a box you typed in, it says what they wrote and asks: **Keep mine** keeps your text and saves over theirs; **Use theirs** puts their text in the box instead of yours.
- If your partner's change reaches the note at the moment you press Save, nothing is overwritten: the form says what changed, and you choose.
- About 2 seconds after each save the dashboard reads the note again. If Relay kept your partner's version instead of yours, a warning says so, with **Open note**. Warnings and errors (⚠) stay until you close them with ✕.

**Forms keep what you typed.** A tap outside a form with unsaved changes leaves it open; **Cancel**, ✕ or Escape closes it without saving.

**Undo.** Every save shows a message with **Undo** for 5 seconds. Undo puts back exactly what was there before. If the same spot changed again since, Undo leaves it alone and says so.

Old Marketing Engine notes (3 hooks, no ratings) keep working: their hooks show as "Not rated yet", and the dashboard never changes their layout.

## Where each number comes from
Every number carries a tag: **⏳ Not yet** (nothing to measure yet), **✍️ Needs you** (who and where), **✍️ Typed by**, or **🔌 Auto** (connected service, next release). Every section has an ⓘ explaining what it is, why it's there, where it comes from and who fills it. **? Help** (top right) has the color key, pages, glossary and shortcuts.

## Refresh social stats (TikTok + Instagram, manual only)
On a product page, **🔄 Refresh social stats** runs the separate `social-scrape-kit` on that computer once: it opens each app's profile for the product's handles in a hidden browser, reads followers, views, best video and last post date, and writes them into *Analytics and Gate → Organic snapshot* (plus one hidden line recording when). Nothing runs on a timer. If you press it again within the hours set in Settings (default 6), it asks first, because frequent visits raise the chance an app flags the account.

Setup, on one computer only: Settings → NXTWAVE Dashboard → *Social stats refresh*: kit folder, **Check setup**, then **Log in to TikTok / Instagram** (you sign in by hand in the window that opens). Other computers show why the button isn't available.

## Status rules
| Color | When |
|---|---|
| Maroon · KILL SIGNAL | `verdict: kill`, or from day 21: spend ≥ `kill_spend_no_sales` with 0 sales/sign-ups, or click rate < `kill_min_ctr` |
| Amber · DECISION DAY | Day 14 (launch gate), day 28 (verdict), day 35 if extended, or verdict overdue |
| Pink-red · GONE QUIET | Days 1–14: no changelog entry or no edit to the marketing file for `stale_days`. Days 15+: no social post for `stale_days` |
| Emerald · ON TRACK | None of the above |

Thresholds are read from the frontmatter of `00_Global_System/Launch_Framework.md` (partners add them):
```yaml
kill_spend_no_sales: 100
kill_min_ctr:                   # empty = click-rate check off
stale_days: 3
stale_dev_after_launch_days:    # empty = a quiet developer after launch is info only
```

## Settings
**Animations:** Follow system (default) / Always animate / Reduced motion. With macOS Reduce Motion on, "Follow system" keeps check marks, toasts and colors but drops the movement.

## Release (maintainers)
```
npm run bump -- 0.2.0
git commit -am "Release 0.2.0" && git tag 0.2.0 && git push && git push --tags
```
GitHub Actions builds and attaches `main.js`, `manifest.json`, `styles.css`. BRAT picks it up on the next Obsidian start.

## Develop
```
npm install
npm test          # status engine + parsers
npm run preview   # browser harness at http://localhost:5174/preview/
npm run dev       # watch build → main.js
```
