// What the UI needs from the outside world. Obsidian implements it for real (src/obsidian/host.ts);
// the browser preview implements it with fake data.

import { NewSprintInput } from "../data/templates";
import { SocialPlatform } from "../data/social";
import type { TableOp } from "../data/tableEdit";
import { DocKey, ProductSnapshot, Role } from "../data/types";

export type Undo = () => Promise<void>;

/** A saved table or marker edit: its Undo, plus a check about 2 s later that the note still holds it. */
export interface EditDone {
  undo: Undo;
  /**
   * Resolves about 2 s after the save: null when the note still holds the edit, else a plain-words warning
   * (Relay merged a partner's change into the same cells). Never rejects.
   */
  settled: Promise<string | null>;
  /** The op that undoes the edit (what Undo applies): it names the line the edit wrote, e.g. the number a new video got. */
  inverse?: TableOp;
}

export interface Prefs {
  /** Who uses this device: sets the default quest filter. */
  role: Role;
  /** The one-time "How to read this page" card was dismissed. */
  guideSeen: boolean;
}

export interface Host {
  version: string;
  prefs: Prefs;
  savePrefs(p: Partial<Prefs>): Promise<void>;
  /** Ticks or unticks one checklist line in a note (exact line, or the start of the item text). */
  tickLine(path: string, match: { line?: string; textStart?: string }, checked: boolean): Promise<Undo>;
  /** Sets a yes/no field like signed_off_dev. */
  setFlag(p: ProductSnapshot, doc: DocKey, key: string, value: boolean): Promise<Undo>;
  /** Sets several text fields in one note (e.g. all social handles). */
  setFields(p: ProductSnapshot, doc: DocKey, values: Record<string, string>): Promise<Undo>;
  openDoc(p: ProductSnapshot, doc: DocKey, heading?: string): void;
  openPath(path: string): void;
  /** Sets building + cycle_start=today + gate_date=+27 in all 6 files. Throws if another sprint is active. */
  startDay1(p: ProductSnapshot): Promise<Undo>;
  postedToday(p: ProductSnapshot): Promise<Undo>;
  setField(p: ProductSnapshot, doc: DocKey, key: string, value: string): Promise<Undo>;
  /** Is the scrape kit usable on this device? `reason` explains why not, in plain words. */
  socialKit(): { ok: boolean; reason: string; minGapHours: number };
  /**
   * Runs the scrape kit once for this product's TikTok + Instagram handles, then writes the numbers
   * into Analytics and Gate. Only ever called from a button press.
   */
  refreshSocial(p: ProductSnapshot, onStep: (message: string) => void): Promise<{ updated: SocialPlatform[]; errors: string[] }>;
  /** Returns the new folder name. */
  createSprint(input: NewSprintInput, startNow: boolean): Promise<string>;
  copy(text: string): Promise<void>;
  /**
   * Applies one TableOp (data/tableEdit) to one product note in a single atomic write. Content edits (set, insert,
   * delete, restore) also set last_updated to today; marker edits don't. Writes to the same note run one at a time.
   * Throws ConflictError, TableNotFoundError or RowNotFoundError and writes nothing when the note no longer holds
   * what the user saw. The Undo applies the inverse op the same way (it can throw ConflictError too).
   */
  editTable(p: ProductSnapshot, doc: DocKey, op: TableOp): Promise<EditDone>;
}
