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
  const dash = opts.showDashboard === false ? null : new Dashboard("Complete daily quests", accounts.map((a) => a.name));
  dash?.start();

  const summaries = await runPool(accounts, cfg.maxConcurrent, (acc) =>
    runAccount(cfg, acc, { update: (u) => dash?.set(acc.name, u) }, opts.signal),
  );

  dash?.stop();
  for (const s of summaries) await report(cfg, s); // file log + telegram
  return summaries;
}
