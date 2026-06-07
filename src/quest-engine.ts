// Pure planner: given live quest progress (from API) + config, compute the
// remaining swap actions. Idempotent — completed quests yield no actions.
import type { Action, QuestActivity, Token } from "./types.ts";

export interface PlanCfg {
  swapAmountCC: number;
  pairSwapCC?: number; // tiny amount for pair quests (no minimum); defaults to 0.1
  roundTrip: boolean;
  // neutral pair used for generic "swap count" quests
  countPairFrom?: Token;
  countPairTo?: Token;
}

export function plan(quests: QuestActivity[], cfg: PlanCfg): Action[] {
  const actions: Action[] = [];
  const from: Token = cfg.countPairFrom ?? "Amulet";
  const to: Token = cfg.countPairTo ?? "CBTC";

  for (const q of quests) {
    if (q.status === "completed") continue;

    if (q.meta?.pair && q.meta.pair.length === 2) {
      const [a, b] = q.meta.pair as [Token, Token];
      // Pair quests have no minimum amount → tiny swap (pool-sized), no round-trip.
      actions.push({
        questId: q.id,
        from: a,
        to: b,
        amountCC: cfg.pairSwapCC ?? 0.1,
        roundTripBack: false,
        pair: true,
      });
      continue;
    }

    // swap-count style quest
    const remaining = Math.max(0, q.target - q.current);
    const amountCC = Math.max(cfg.swapAmountCC, Number(q.meta?.minAmount ?? 0));
    for (let i = 0; i < remaining; i++) {
      actions.push({ questId: q.id, from, to, amountCC, roundTripBack: cfg.roundTrip });
    }
  }

  return actions;
}
