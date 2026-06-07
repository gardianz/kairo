// Health check: verify each account's session logs in, and show balance + quest
// status. No swaps. Used by `npm run run:once` and menu option "check".
import type { Config } from "./config.ts";
import type { ResolvedAccount } from "./accounts.ts";
import { Session } from "./session.ts";
import { Dashboard } from "./dashboard.ts";
import { runPool } from "./pool.ts";
import { cardBal, formatBalances, questView, TOKEN_LABEL } from "./types.ts";

export interface CheckResult {
  name: string;
  ok: boolean;
  partyTail: string;
  bal: string;
  quests: string;
  swaps: number;
  error?: string;
}

export async function checkAccounts(
  cfg: Config,
  accounts: ResolvedAccount[],
  opts: { showDashboard?: boolean } = {},
): Promise<CheckResult[]> {
  const proxied = accounts.filter((a) => a.proxy).length;
  const dash =
    opts.showDashboard === false
      ? null
      : new Dashboard("Account Check", accounts.map((a) => a.name), { swapAmt: cfg.swapAmountCC, proxied });
  dash?.start();

  const results = await runPool(accounts, cfg.maxConcurrent, async (acc) => {
    const r: CheckResult = { name: acc.name, ok: false, partyTail: "", bal: "-", quests: "-", swaps: 0 };
    if (acc.proxy) {
      const host = acc.proxy.replace(/^https?:\/\/([^@]*@)?/i, "").split("/")[0];
      dash?.addLog(acc.name, `proxy ${host}`, "proxy");
    }
    dash?.setAcct(acc.name, { state: "busy", status: "logging in", party: acc.bundle.partyId?.slice(-6) ?? "" });
    try {
      const session = Session.create(cfg.apiBase, acc.bundle, acc.password, acc.persist, acc.proxy);
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
      r.swaps = swaps.totalSwaps;
      r.ok = true;
      const qv = questView(quests);
      dash?.setAcct(acc.name, {
        state: "done",
        party: r.partyTail,
        ...qv,
        cc: cardBal(balances, "Amulet"),
        uxBal: cardBal(balances, "USDCx"),
        cbBal: cardBal(balances, "CBTC"),
        swOk: swaps.totalSwaps,
        status: `online ✓ · ${done}/${quests.length} quests · $${swaps.volumeUsd.toFixed(2)} 24h`,
      });
      dash?.addLog(acc.name, `balance CC ${cardBal(balances, "Amulet")} · quest ${r.quests}`, "balance");
    } catch (err) {
      r.error = err instanceof Error ? err.message : String(err);
      dash?.setAcct(acc.name, { state: "error", status: `login failed: ${r.error.slice(0, 30)}` });
      dash?.addLog(acc.name, `error ${r.error.slice(0, 36)}`, "error");
    }
    return r;
  });

  dash?.stop();
  return results;
}
