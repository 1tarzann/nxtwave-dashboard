import { ItemView, Plugin, WorkspaceLeaf } from "obsidian";

const VIEW_TYPE = "nxtwave-dashboard";

class PlaceholderView extends ItemView {
  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return "NXTWAVE Dashboard"; }
  getIcon() { return "layout-dashboard"; }
  async onOpen() {
    const root = this.contentEl;
    root.empty();
    root.createEl("h2", { text: "NXTWAVE Dashboard is installed" });
    root.createEl("p", { text: `Version ${(this.app as any).plugins?.manifests?.["nxtwave-dashboard"]?.version ?? ""}. BRAT will pull the full dashboard in the next update.` });
  }
}

export default class NxtwaveDashboard extends Plugin {
  async onload() {
    this.registerView(VIEW_TYPE, (leaf: WorkspaceLeaf) => new PlaceholderView(leaf));
    this.addRibbonIcon("layout-dashboard", "Open NXTWAVE Dashboard", () => this.open());
    this.addCommand({ id: "open", name: "Open dashboard", callback: () => this.open() });
  }
  async open() {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    const leaf = existing ?? this.app.workspace.getLeaf("tab");
    if (!existing) await leaf.setViewState({ type: VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }
}
