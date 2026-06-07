// Pure safety guard: enforce daily spend cap, min CC balance floor, max swaps.
import type { Action } from "./types.ts";

export interface SafetyCfg {
  dailySpendCapCC: number;
  minBalanceFloorCC: number;
  maxSwapsPerRun: number;
}

export interface RunCounters {
  spentCC: number;
  swapCount: number;
}

export type SafetyResult = { ok: true } | { ok: false; reason: string };

export function checkAction(
  cfg: SafetyCfg,
  ccBalance: number,
  action: Action,
  counters: RunCounters,
): SafetyResult {
  if (counters.swapCount >= cfg.maxSwapsPerRun) {
    return { ok: false, reason: `maxSwapsPerRun (${cfg.maxSwapsPerRun}) reached` };
  }
  if (counters.spentCC + action.amountCC > cfg.dailySpendCapCC) {
    return { ok: false, reason: `dailySpendCapCC (${cfg.dailySpendCapCC}) exceeded` };
  }
  if (action.from === "Amulet" && ccBalance - action.amountCC < cfg.minBalanceFloorCC) {
    return { ok: false, reason: `CC balance would drop below floor (${cfg.minBalanceFloorCC})` };
  }
  return { ok: true };
}
