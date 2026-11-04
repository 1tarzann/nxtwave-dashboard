// What the UI needs from the outside world. Obsidian implements it for real (src/obsidian/host.ts);
// the browser preview implements it with fake data.

import { NewSprintInput } from "../data/templates";
import { DocKey, ProductSnapshot } from "../data/types";

export type Undo = () => Promise<void>;

export interface Host {
  version: string;
  openDoc(p: ProductSnapshot, doc: DocKey, heading?: string): void;
  openPath(path: string): void;
  /** Sets building + cycle_start=today + gate_date=+27 in all 6 files. Throws if another sprint is active. */
  startDay1(p: ProductSnapshot): Promise<Undo>;
  postedToday(p: ProductSnapshot): Promise<Undo>;
  setField(p: ProductSnapshot, doc: DocKey, key: string, value: string): Promise<Undo>;
  /** Returns the new folder name. */
  createSprint(input: NewSprintInput, startNow: boolean): Promise<string>;
  copy(text: string): Promise<void>;
}
