// Reads the vault into DashboardData using Obsidian's metadata cache (frontmatter) and cachedRead (bodies).

import { App, TFile, TFolder } from "obsidian";
import { toIsoDate } from "../data/dates";
import { parseChecklistNote } from "../data/company";
import { buildSnapshot } from "../data/snapshot";
import { parseThresholds } from "../data/thresholds";
import { DashboardData, DOC_FILES, DOC_ORDER, DocKey, IdeaNote, LinkRef, RawDoc } from "../data/types";

/** Finds the HQ folder: the one holding both 02_Active_Sprints and 00_Global_System. Works whatever the vault root is. */
export function findHqRoot(app: App): string | null {
  const root = app.vault.getRoot();
  if (root.children.some((c) => c instanceof TFolder && c.name === "02_Active_Sprints")) return "";
  const folders = app.vault.getAllLoadedFiles().filter((f): f is TFolder => f instanceof TFolder && f.name === "02_Active_Sprints");
  for (const f of folders) {
    const parent = f.parent;
    if (parent && parent.children.some((c) => c instanceof TFolder && c.name === "00_Global_System")) return parent.path === "/" ? "" : parent.path;
  }
  return null;
}

export const join = (hq: string, rel: string) => (hq ? `${hq}/${rel}` : rel);

async function raw(app: App, file: TFile): Promise<RawDoc> {
  return {
    path: file.path,
    frontmatter: (app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown>) ?? {},
    body: await app.vault.cachedRead(file),
    mtime: file.stat.mtime,
  };
}

function mdChildren(folder: TFolder | null): TFile[] {
  return (folder?.children ?? []).filter((c): c is TFile => c instanceof TFile && c.extension === "md");
}

export async function readDashboard(app: App, hq: string, today = toIsoDate(Date.now())): Promise<DashboardData> {
  const folder = (p: string) => {
    const f = app.vault.getAbstractFileByPath(join(hq, p));
    return f instanceof TFolder ? f : null;
  };

  const sprintsFolder = folder("02_Active_Sprints");
  const productFolders = (sprintsFolder?.children ?? []).filter((c): c is TFolder => c instanceof TFolder);
  const products = await Promise.all(
    productFolders.map(async (pf) => {
      const files = mdChildren(pf);
      const docs: Partial<Record<DocKey, RawDoc>> = {};
      for (const k of DOC_ORDER) {
        const f = files.find((x) => x.basename === DOC_FILES[k]);
        if (f) docs[k] = await raw(app, f);
      }
      const hubFile = files.find((x) => x.basename === `${pf.name}_Hub`) ?? files.find((x) => app.metadataCache.getFileCache(x)?.frontmatter?.doc_type === "product_hub");
      const hub = hubFile ? await raw(app, hubFile) : null;
      return buildSnapshot(pf.name, pf.path, docs, hub);
    }),
  );
  products.sort((a, b) => a.name.localeCompare(b.name));

  const lf = app.vault.getAbstractFileByPath(join(hq, "00_Global_System/Launch_Framework.md"));
  const thresholds = parseThresholds(lf instanceof TFile ? (app.metadataCache.getFileCache(lf)?.frontmatter as Record<string, unknown>) : null);

  const sub = (p: string) => (folder(p)?.children ?? []).filter((c) => c instanceof TFolder || (c instanceof TFile && c.extension === "md")).map((c) => (c instanceof TFile ? c.basename : c.name));
  const archive = { scaled: sub("99_Vault_Archive/Scaled_Winners"), killed: sub("99_Vault_Archive/Killed_MVPs") };

  const stages: [IdeaNote["stage"], string][] = [
    ["brainstorm", "05_Idea_Pipeline/1_Brainstorm"],
    ["drafts", "05_Idea_Pipeline/2_Rough_Drafts"],
    ["accepted", "05_Idea_Pipeline/3_Accepted"],
  ];
  const ideas: IdeaNote[] = stages.flatMap(([stage, p]) =>
    mdChildren(folder(p)).map((f) => ({ path: f.path, title: f.basename, stage, mtime: f.stat.mtime })),
  );

  const categories: LinkRef[] = mdChildren(folder("04_Company_Ops/Categories")).map((f) => ({
    path: `04_Company_Ops/Categories/${f.basename}`,
    title: f.basename.replace(/_/g, " "),
  }));

  const note = async (rel: string) => {
    const f = app.vault.getAbstractFileByPath(join(hq, rel));
    return f instanceof TFile ? { path: f.path, body: await app.vault.cachedRead(f) } : null;
  };
  const setupNote = await note("SETUP_CHECKLIST.md");
  const bmNote = await note("04_Company_Ops/NXTWAVE_Business_Model.md");
  const setup = setupNote ? parseChecklistNote(setupNote.body, setupNote.path) : [];
  const businessModel = bmNote ? parseChecklistNote(bmNote.body, bmNote.path, "Current status") : [];

  return { hqRoot: hq, today, products, thresholds, archive, ideas, categories, setup, businessModel };
}
