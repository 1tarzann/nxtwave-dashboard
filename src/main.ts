import { App, debounce, ItemView, Notice, Plugin, PluginSettingTab, Setting, TAbstractFile, WorkspaceLeaf } from "obsidian";
import { runDoctor, runLogin } from "./obsidian/kit";
import { applyMotionMode, MotionMode } from "./ui/motion";
import { toIsoDate } from "./data/dates";
import { DashboardData, Role } from "./data/types";
import { ObsidianHost } from "./obsidian/host";
import { findHqRoot, readDashboard } from "./obsidian/reader";
import { DashboardApp } from "./ui/app";
import { h } from "./ui/dom";

const VIEW_TYPE = "nxtwave-dashboard";

class DashboardView extends ItemView {
  private dash: DashboardApp | null = null;
  private data: DashboardData | null = null;
  private hq: string | null = null;
  private lastDay = toIsoDate(Date.now());

  constructor(leaf: WorkspaceLeaf, private plugin: NxtwaveDashboard) {
    super(leaf);
  }

  getViewType() {
    return VIEW_TYPE;
  }
  getDisplayText() {
    return "NXTWAVE Dashboard";
  }
  getIcon() {
    return "layout-dashboard";
  }

  async onOpen() {
    this.contentEl.empty();
    this.contentEl.addClass("nx-view-content");
    const s = this.plugin.settings;
    const prefs = { role: s.role, guideSeen: s.guideSeen };
    const host = new ObsidianHost(
      this.app,
      this.plugin.manifest.version,
      () => this.data,
      () => this.leaf,
      prefs,
      async (p) => {
        Object.assign(this.plugin.settings, p);
        await this.plugin.saveData(this.plugin.settings);
      },
      () => ({ kitPath: this.plugin.settings.kitPath, nodePath: this.plugin.settings.nodePath, minGapHours: this.plugin.settings.minGapHours }),
    );
    this.dash = new DashboardApp(this.contentEl, host);

    const reload = debounce(() => void this.reload(), 250, true);
    const inHq = (f: TAbstractFile | string) => {
      const path = typeof f === "string" ? f : f.path;
      return this.hq === null || this.hq === "" || path.startsWith(`${this.hq}/`);
    };
    this.registerEvent(this.app.metadataCache.on("changed", (f) => inHq(f) && reload()));
    this.registerEvent(this.app.metadataCache.on("resolved", () => !this.data && reload()));
    this.registerEvent(this.app.vault.on("create", (f) => inHq(f) && reload()));
    this.registerEvent(this.app.vault.on("delete", (f) => inHq(f) && reload()));
    this.registerEvent(this.app.vault.on("rename", (f, old) => (inHq(f) || inHq(old)) && reload()));
    // Day rollover at midnight.
    this.registerInterval(
      window.setInterval(() => {
        const d = toIsoDate(Date.now());
        if (d !== this.lastDay) {
          this.lastDay = d;
          void this.reload();
        }
      }, 60_000),
    );
    this.app.workspace.onLayoutReady(() => void this.reload());
  }

  async reload() {
    if (!this.dash) return;
    this.hq = findHqRoot(this.app);
    if (this.hq === null) {
      this.contentEl.querySelector(".nx-screen")?.replaceChildren(
        h("div", { class: "nx-empty nx-empty-big" }, "Couldn't find the HQ folder (a folder containing 02_Active_Sprints and 00_Global_System). Is the shared folder synced yet?"),
      );
      return;
    }
    this.data = await readDashboard(this.app, this.hq);
    this.dash.setData(this.data);
  }

  async rebuild() {
    await this.onClose();
    await this.onOpen();
  }

  focusDashboard() {
    this.dash?.focus();
  }

  async onClose() {
    this.dash?.destroy();
    this.dash = null;
  }
}

interface Settings {
  motion: MotionMode;
  role: Role;
  guideSeen: boolean;
  kitPath: string;
  nodePath: string;
  minGapHours: number;
}
const DEFAULTS: Settings = { motion: "system", role: "both", guideSeen: false, kitPath: "~/Developer/social-scrape-kit", nodePath: "", minGapHours: 6 };

class DashboardSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: NxtwaveDashboard) {
    super(app, plugin);
  }

  /** Social stats refresh (Instagram + TikTok) through the scrape kit. Manual only. */
  private kitSettings(containerEl: HTMLElement): void {
    const s = this.plugin.settings;
    const save = async () => {
      await this.plugin.saveData(s);
      this.plugin.refreshViews();
    };
    containerEl.createEl("h3", { text: "Social stats refresh (Instagram + TikTok)" });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "Uses the scrape kit on this computer. It only runs when someone presses “Refresh social stats” on a product page; nothing runs on a timer. Set this up on one computer only.",
    });
    new Setting(containerEl)
      .setName("Scrape kit folder")
      .setDesc("Where the social-scrape-kit folder is on this computer.")
      .addText((t) => t.setPlaceholder("~/Developer/social-scrape-kit").setValue(s.kitPath).onChange(async (v) => { s.kitPath = v.trim(); await save(); }));
    new Setting(containerEl)
      .setName("Node.js location (optional)")
      .setDesc("Leave empty to find it automatically.")
      .addText((t) => t.setPlaceholder("/opt/homebrew/bin/node").setValue(s.nodePath).onChange(async (v) => { s.nodePath = v.trim(); await save(); }));
    new Setting(containerEl)
      .setName("Warn if refreshed again within (hours)")
      .setDesc("Refreshing often makes the apps more likely to flag an account. The dashboard asks before refreshing sooner than this.")
      .addText((t) => t.setValue(String(s.minGapHours)).onChange(async (v) => { const n = Number(v); if (Number.isFinite(n) && n >= 0) { s.minGapHours = n; await save(); } }));
    new Setting(containerEl)
      .setName("Check setup")
      .setDesc("Checks that the kit, Node.js and its browser are ready.")
      .addButton((b) =>
        b.setButtonText("Check").onClick(async () => {
          b.setDisabled(true);
          new Notice((await runDoctor(s)) || "No answer from the kit.", 10000);
          b.setDisabled(false);
        }),
      );
    for (const platform of ["tiktok", "instagram"] as const) {
      const label = platform === "tiktok" ? "TikTok" : "Instagram";
      new Setting(containerEl)
        .setName(`Log in to ${label} (one time)`)
        .setDesc(`Opens a browser window: sign in to the product's ${label} account by hand (2FA is fine). It closes by itself once you're in. Claude never types logins.`)
        .addButton((b) =>
          b.setButtonText(`Log in to ${label}`).onClick(async () => {
            b.setDisabled(true);
            new Notice(`Sign in to ${label} in the window that opened.`, 8000);
            const err = await runLogin(s, platform);
            new Notice(err ?? `${label} login saved on this computer.`, 8000);
            b.setDisabled(false);
          }),
        );
    }
  }
  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl)
      .setName("Who uses this device?")
      .setDesc("The quest log shows this person's quests first. Each partner sets it on their own computer.")
      .addDropdown((d) =>
        d
          .addOptions({ both: "Both / not sure", dev: "Developer", marketing: "Marketer" })
          .setValue(this.plugin.settings.role)
          .onChange(async (v) => {
            this.plugin.settings.role = v as Role;
            await this.plugin.saveData(this.plugin.settings);
            this.plugin.refreshViews();
          }),
      );
    this.kitSettings(containerEl);
    new Setting(containerEl)
      .setName("Show the “How to read this page” card again")
      .addButton((b) =>
        b.setButtonText("Show it").onClick(async () => {
          this.plugin.settings.guideSeen = false;
          await this.plugin.saveData(this.plugin.settings);
          this.plugin.refreshViews();
        }),
      );
    new Setting(containerEl)
      .setName("Animations")
      .setDesc("Hover lifts, the square-to-hub zoom, count-ups and pulses. With reduced motion, check marks, toasts and colors still show, just without movement. This setting is per device.")
      .addDropdown((d) =>
        d
          .addOptions({ system: "Follow system (Reduce Motion)", on: "Always animate", off: "Reduced motion" })
          .setValue(this.plugin.settings.motion)
          .onChange(async (v) => {
            this.plugin.settings.motion = v as MotionMode;
            await this.plugin.saveData(this.plugin.settings);
            this.plugin.applyMotion();
          }),
      );
  }
}

export default class NxtwaveDashboard extends Plugin {
  settings: Settings = { ...DEFAULTS };
  private stopMotion: () => void = () => undefined;

  /** Re-open dashboards so a settings change (role, guide card) shows right away. */
  refreshViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) void (leaf.view as DashboardView).rebuild();
  }

  applyMotion() {
    this.stopMotion();
    this.stopMotion = applyMotionMode(this.settings.motion);
  }

  onunload() {
    this.stopMotion();
    document.body.classList.remove("nx-reduce-motion");
  }

  async onload() {
    this.settings = { ...DEFAULTS, ...((await this.loadData()) as Partial<Settings> | null) };
    this.applyMotion();
    this.addSettingTab(new DashboardSettingTab(this.app, this));
    this.registerView(VIEW_TYPE, (leaf) => new DashboardView(leaf, this));
    this.addRibbonIcon("layout-dashboard", "Open NXTWAVE Dashboard", () => void this.open());
    this.addCommand({ id: "open", name: "Open dashboard", callback: () => void this.open() });
  }

  async open() {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    const leaf = existing ?? this.app.workspace.getLeaf("tab");
    if (!existing) await leaf.setViewState({ type: VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(leaf);
    (leaf.view as DashboardView).focusDashboard?.();
  }
}
