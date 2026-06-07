// Complete daily quests across all accounts concurrently, with a live dashboard.
import type { Config } from "./config.ts";
import type { ResolvedAccount } from "./accounts.ts";
import type { RunSummary } from "./types.ts";
import { Dashboard } from "./dashboard.ts";
import { runAccount, type CancelToken } from "./runner.ts";
import { runPool } from "./pool.ts";
import { report } from "./reporter.ts";

export async function completeAllQuests(
  cfg: Config,
  accounts: ResolvedAccount[],
  opts: { signal?: CancelToken; showDashboard?: boolean } = {},
): Promise<RunSummary[]> {
  const proxied = accounts.filter((a) => a.proxy).length;
  const dash =
    opts.showDashboard === false
      ? null
      : new Dashboard("Auto Task", accounts.map((a) => a.name), {
          swapAmt: cfg.swapAmountCC,
          proxied,
          nextRunCron: cfg.scheduleCron,
        });
  dash?.start();

  const byName = new Map(accounts.map((a) => [a.name, a]));
  const run1 = (acc: ResolvedAccount) =>
    runAccount(
      cfg,
      acc,
      {
        acct: (u) => dash?.setAcct(acc.name, u),
        log: (msg, kind) => dash?.addLog(acc.name, msg, kind),
      },
      opts.signal,
    );

  const summaries = await runPool(accounts, cfg.maxConcurrent, run1);

  // Optional: re-attempt accounts whose only remaining quests were skipped for
  // DEX liquidity, in case the pool refilled. Each retry may lock CC.
  if (cfg.autoRecheckMinutes > 0) {
    for (let round = 0; round < cfg.autoRecheckMax && !opts.signal?.cancelled; round++) {
      const retryNames = summaries
        .filter((s) => s.liquiditySkipped.length > 0 && s.questsRemaining.length > 0)
        .map((s) => s.account);
      if (retryNames.length === 0) break;
      for (const name of retryNames) dash?.addLog(name, `recheck dalam ${cfg.autoRecheckMinutes} menit`, "info");
      await new Promise((r) => setTimeout(r, cfg.autoRecheckMinutes * 60_000));
      if (opts.signal?.cancelled) break;
      const retried = await runPool(
        retryNames.map((n) => byName.get(n)!),
        cfg.maxConcurrent,
        run1,
      );
      for (const s of retried) {
        const i = summaries.findIndex((x) => x.account === s.account);
        if (i >= 0) summaries[i] = s;
      }
    }
  }

  dash?.stop();
  for (const s of summaries) await report(cfg, s); // file log + telegram
  return summaries;
}
