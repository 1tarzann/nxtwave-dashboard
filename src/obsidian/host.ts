// The real write actions. Every write goes through app.vault.process (atomic read-modify-write inside
// Obsidian, so Relay sees a normal edit) and changes only the frontmatter lines it names.

import { App, Notice, TFile, WorkspaceLeaf } from "obsidian";
import { addDays, toIsoDate } from "../data/dates";
import { activeProducts } from "../data/status";
import { buildHubNote, fillTemplate, NewSprintInput, readFrontmatterRaw, sanitizeName, setChecklistLine, setFrontmatterRaw, TEMPLATE_FILES, yamlValue } from "../data/templates";
import { DashboardData, DOC_FILES, DOC_ORDER, DocKey, ProductSnapshot } from "../data/types";
import { applySocialStats, newerPostDate, PLATFORM_LABEL, SOCIAL_PLATFORMS, SocialPlatform, SocialStats } from "../data/social";
import { Host, Prefs, Undo } from "../ui/host";
import { checkKit, KitSettings, runStats } from "./kit";
import { join } from "./reader";

type Patch = Record<string, string>;

export class ObsidianHost implements Host {
  private sideLeaf: WorkspaceLeaf | null = null;

  constructor(
    private app: App,
    readonly version: string,
    private getData: () => DashboardData | null,
    private ownLeaf: () => WorkspaceLeaf,
    readonly prefs: Prefs,
    private persistPrefs: (p: Prefs) => Promise<void>,
    private kitSettings: () => KitSettings & { minGapHours: number },
  ) {}

  private refreshing = false;

  socialKit(): { ok: boolean; reason: string; minGapHours: number } {
    const s = this.kitSettings();
    const c = checkKit(s);
    return { ok: c.ok, reason: c.reason, minGapHours: s.minGapHours };
  }

  async refreshSocial(p: ProductSnapshot, onStep: (message: string) => void): Promise<{ updated: SocialPlatform[]; errors: string[] }> {
    if (this.refreshing) throw new Error("A refresh is already running. Wait for it to finish.");
    this.refreshing = true;
    try {
      const results: SocialStats[] = [];
      const errors: string[] = [];
      for (const platform of SOCIAL_PLATFORMS) {
        const handle = p.handles[platform];
        if (!handle) continue;
        onStep(`Reading ${PLATFORM_LABEL[platform]} ${handle}… (about a minute)`);
        const r = await runStats(this.kitSettings(), platform, handle);
        if (r.stats) results.push(r.stats);
        if (r.error) errors.push(r.error);
      }
      if (results.length) {
        await this.app.vault.process(this.file(p.paths.analytics), (data) => applySocialStats(data, results));
        const newer = newerPostDate(p.lastSocialPostDate, results);
        if (newer && p.paths.marketing) await this.patch([{ path: p.paths.marketing, values: { last_social_post_date: newer } }]);
      }
      return { updated: results.map((r) => r.platform), errors };
    } finally {
      this.refreshing = false;
    }
  }

  async savePrefs(p: Partial<Prefs>): Promise<void> {
    Object.assign(this.prefs, p);
    await this.persistPrefs(this.prefs);
  }

  async tickLine(path: string, match: { line?: string; textStart?: string }, checked: boolean): Promise<Undo> {
    const f = this.file(path);
    let changed = false;
    await this.app.vault.process(f, (data) => {
      const next = setChecklistLine(data, match, checked);
      changed = next !== data;
      return next;
    });
    if (!changed) throw new Error("Couldn't find that line in the note any more. Open the note and tick it by hand.");
    // Undo flips only that one checkbox back, so edits made in the meantime are kept.
    const after = match.line !== undefined ? { line: setChecklistLine(match.line, { line: match.line }, checked) } : match;
    return async () => {
      let found = false;
      await this.app.vault.process(this.file(path), (data) => {
        const reverted = setChecklistLine(data, after, !checked);
        found = reverted !== data;
        return reverted;
      });
      if (!found) throw new Error("That line changed since, so it wasn't undone. Open the note to check it.");
    };
  }

  async setFlag(p: ProductSnapshot, doc: DocKey, key: string, value: boolean): Promise<Undo> {
    return this.patch([{ path: this.file(p.paths[doc]).path, values: { [key]: value ? "true" : "false", last_updated: this.today() } }]);
  }

  async setFields(p: ProductSnapshot, doc: DocKey, values: Record<string, string>): Promise<Undo> {
    const yaml = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, yamlValue(v)]));
    return this.patch([{ path: this.file(p.paths[doc]).path, values: { ...yaml, last_updated: this.today() } }]);
  }

  private today(): string {
    return toIsoDate(Date.now());
  }

  private file(path: string | null | undefined): TFile {
    const f = path ? this.app.vault.getAbstractFileByPath(path) : null;
    if (!(f instanceof TFile)) throw new Error(`Can't find ${path ?? "that note"}. Was it renamed?`);
    return f;
  }

  /** Applies patches to several files and returns an Undo that restores the exact previous lines. */
  private async patch(changes: { path: string; values: Patch }[]): Promise<Undo> {
    const before: { path: string; values: Patch }[] = [];
    for (const c of changes) {
      const f = this.file(c.path);
      await this.app.vault.process(f, (data) => {
        const prev = readFrontmatterRaw(data);
        before.push({ path: c.path, values: Object.fromEntries(Object.keys(c.values).map((k) => [k, prev[k] ?? ""])) });
        return setFrontmatterRaw(data, c.values);
      });
    }
    return async () => {
      for (const b of before) {
        await this.app.vault.process(this.file(b.path), (data) => setFrontmatterRaw(data, b.values));
      }
    };
  }

  openPath(path: string): void {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) {
      new Notice(`Can't find ${path}`);
      return;
    }
    void this.sidePane().openFile(f);
  }

  openDoc(p: ProductSnapshot, doc: DocKey, heading?: string): void {
    const path = p.paths[doc];
    const f = path ? this.app.vault.getAbstractFileByPath(path) : null;
    if (!(f instanceof TFile)) {
      new Notice(`${p.displayName} has no ${DOC_FILES[doc]} note.`);
      return;
    }
    let subpath = "";
    if (heading) {
      const h = this.app.metadataCache.getFileCache(f)?.headings?.find((x) => x.heading.toLowerCase().includes(heading.toLowerCase()));
      if (h) subpath = `#${h.heading}`;
    }
    const leaf = this.sidePane();
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
    void this.app.workspace.openLinkText(f.path + subpath, "", false);
  }

  /** Notes open in one reusable pane next to the dashboard instead of piling up new splits. */
  private sidePane(): WorkspaceLeaf {
    let alive = false;
    if (this.sideLeaf) this.app.workspace.iterateAllLeaves((l) => (alive ||= l === this.sideLeaf));
    if (!alive || !this.sideLeaf || this.sideLeaf === this.ownLeaf()) {
      this.app.workspace.setActiveLeaf(this.ownLeaf(), { focus: false });
      this.sideLeaf = this.app.workspace.getLeaf("split", "vertical");
    }
    return this.sideLeaf;
  }

  async startDay1(p: ProductSnapshot): Promise<Undo> {
    const data = this.getData();
    const others = data ? activeProducts(data.products).filter((x) => x.name !== p.name) : [];
    if (others.length) throw new Error(`${others.map((o) => o.displayName).join(", ")} is still active. One sprint at a time: finish its day-28 verdict first.`);
    const today = this.today();
    const values: Patch = { sprint_status: "building", cycle_start: today, gate_date: addDays(today, 27), last_updated: today };
    const paths = [p.hubPath, ...DOC_ORDER.map((k) => p.paths[k])].filter((x): x is string => !!x);
    return this.patch(paths.map((path) => ({ path, values })));
  }

  async postedToday(p: ProductSnapshot): Promise<Undo> {
    const today = this.today();
    return this.patch([{ path: this.file(p.paths.marketing).path, values: { last_social_post_date: today, last_updated: today } }]);
  }

  async setField(p: ProductSnapshot, doc: DocKey, key: string, value: string): Promise<Undo> {
    return this.patch([{ path: this.file(p.paths[doc]).path, values: { [key]: yamlValue(value), last_updated: this.today() } }]);
  }

  async createSprint(input: NewSprintInput, startNow: boolean): Promise<string> {
    const data = this.getData();
    if (!data) throw new Error("The dashboard hasn't loaded the vault yet.");
    const name = sanitizeName(input.name);
    if (!name) throw new Error("Give the product a name first.");
    const active = activeProducts(data.products);
    if (startNow && active.length) throw new Error(`${active[0].displayName} is still active. One sprint at a time.`);
    const folderPath = join(data.hqRoot, `02_Active_Sprints/${name}`);
    if (this.app.vault.getAbstractFileByPath(folderPath)) throw new Error(`02_Active_Sprints/${name} already exists.`);

    // Read every template first, so a missing one fails before anything is created.
    const templates: Partial<Record<DocKey, string>> = {};
    for (const k of DOC_ORDER) {
      const tpl = this.app.vault.getAbstractFileByPath(join(data.hqRoot, `01_Standard_Templates/${TEMPLATE_FILES[k]}`));
      if (!(tpl instanceof TFile)) throw new Error(`Template ${TEMPLATE_FILES[k]} is missing from 01_Standard_Templates.`);
      templates[k] = await this.app.vault.read(tpl);
    }

    const today = this.today();
    await this.app.vault.createFolder(folderPath);
    await this.app.vault.create(`${folderPath}/${name}_Hub.md`, buildHubNote(input, today, startNow, active[0]?.displayName ?? null));
    for (const k of DOC_ORDER) {
      await this.app.vault.create(`${folderPath}/${DOC_FILES[k]}.md`, fillTemplate(k, templates[k] as string, input, today, startNow));
    }
    return name;
  }

  async copy(text: string): Promise<void> {
    await navigator.clipboard.writeText(text);
  }
}
