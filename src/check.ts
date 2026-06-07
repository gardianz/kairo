// Health check: verify each account's session logs in, and show balance + quest
// status. No swaps. Used by `npm run run:once` and menu option "check".
import type { Config } from "./config.ts";
import type { ResolvedAccount } from "./accounts.ts";
import { Session } from "./session.ts";
import { Dashboard } from "./dashboard.ts";
import { runPool } from "./pool.ts";
import { formatBalances, TOKEN_LABEL } from "./types.ts";

export interface CheckResult {
  name: string;
  ok: boolean;
  partyTail: string;
  bal: string;
  quests: string;
  error?: string;
}

export async function checkAccounts(
  cfg: Config,
  accounts: ResolvedAccount[],
  opts: { showDashboard?: boolean } = {},
): Promise<CheckResult[]> {
  const dash = opts.showDashboard === false ? null : new Dashboard("Account check", accounts.map((a) => a.name));
  dash?.start();

  const results = await runPool(accounts, cfg.maxConcurrent, async (acc) => {
    const r: CheckResult = { name: acc.name, ok: false, partyTail: "", bal: "-", quests: "-" };
    dash?.set(acc.name, { state: "busy", phase: "logging in", party: acc.bundle.partyId?.slice(-6) ?? "" });
    try {
      const session = Session.create(cfg.apiBase, acc.bundle, acc.password, acc.persist);
      r.partyTail = session.partyId.slice(-6);
      await session.ensureFresh();
      const [balances, quests, swaps] = await Promise.all([
        session.api.getBalances(session.partyId),
        session.api.getQuests(),
        session.api.getSwapsSummary(),
      ]);
      r.bal = formatBalances(balances, (t) => TOKEN_LABEL[t]);
      const done = quests.filter((q) => q.status === "completed").length;
      r.quests = `${done}/${quests.length}`;
      r.ok = true;
      dash?.set(acc.name, {
        state: "done",
        party: r.partyTail,
        phase: `online ✓  ($${swaps.volumeUsd.toFixed(2)} vol 24h)`,
        bal: r.bal,
        quests: r.quests,
        swaps: swaps.totalSwaps,
      });
    } catch (err) {
      r.error = err instanceof Error ? err.message : String(err);
      dash?.set(acc.name, { state: "error", phase: "login failed", note: r.error.slice(0, 28) });
    }
    return r;
  });

  dash?.stop();
  return results;
}
