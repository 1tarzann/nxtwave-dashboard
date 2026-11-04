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

## Where each number comes from
Every number carries a tag: **⏳ Not yet** (nothing to measure yet), **✍️ Needs you** (who and where), **✍️ Typed by**, or **🔌 Auto** (connected service, next release). Every section has an ⓘ explaining what it is, why it's there, where it comes from and who fills it. **? Help** (top right) has the color key, pages, glossary and shortcuts.

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
