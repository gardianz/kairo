// Tiny persisted state: which quests each account skipped for DEX liquidity on
// the previous run. Lets us detect "pool refilled -> quest finally completed"
// across separate runs and alert once.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const FILE = "state/recovery.json";

type SkipMap = Record<string, string[]>; // account -> quest ids skipped last run

export function loadSkipMap(): SkipMap {
  try {
    return JSON.parse(readFileSync(FILE, "utf8")) as SkipMap;
  } catch {
    return {};
  }
}

export function saveSkipMap(map: SkipMap): void {
  try {
    mkdirSync("state", { recursive: true });
    writeFileSync(FILE, JSON.stringify(map, null, 2));
  } catch {
    /* non-fatal */
  }
}
