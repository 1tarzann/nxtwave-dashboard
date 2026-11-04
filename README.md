# NXTWAVE Dashboard

An Obsidian plugin for a 2-partner sprint vault: color-coded product squares, a 3-level drill-down (Home → Product Hub → Marketing / Dev side) and one-click sprint actions.

## Install (each partner, once)
1. Obsidian → Settings → Community plugins → Browse → **BRAT** → Install → Enable.
2. Settings → BRAT → **Add beta plugin** → paste `1tarzann/nxtwave-dashboard` → Add plugin.
3. Settings → BRAT → turn on **Auto-update plugins at startup**.
4. Settings → Community plugins → enable **NXTWAVE Dashboard**. Open it from the ribbon icon or Cmd/Ctrl+P → "NXTWAVE Dashboard: Open dashboard".

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
