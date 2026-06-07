// Run one account: read live quests + balance, plan remaining actions, execute
// swaps under safety guards, then report.
import type { Config } from "./config.ts";
import type { Balance, RunSummary, Token } from "./types.ts";
import { formatBalances, TOKEN_LABEL } from "./types.ts";
import type { ResolvedAccount } from "./accounts.ts";
import type { Row } from "./dashboard.ts";
import { Session } from "./session.ts";
import { plan } from "./quest-engine.ts";
import { checkAction, type RunCounters } from "./safety.ts";
import { executeSwap, retry } from "./swap.ts";
import { logger } from "./reporter.ts";

export interface AccountHooks {
  update?: (u: Partial<Row>) => void;
}

// Cooperative cancellation token (set cancelled=true to stop a running job).
export interface CancelToken {
  cancelled: boolean;
}

function ccBalanceOf(balances: { token: Token; unlocked: number }[]): number {
  return unlockedOf(balances, "Amulet");
}

function unlockedOf(balances: { token: Token; unlocked: number }[], token: Token): number {
  return balances.find((b) => b.token === token)?.unlocked ?? 0;
}

// Poll balances until `token` has >= `need` unlocked, or timeout. Returns latest.
async function waitForUnlock(
  session: Session,
  token: Token,
  need: number,
  cfg: Config,
  onWait?: (unlocked: number) => void,
): Promise<Balance[]> {
  const deadline = Date.now() + cfg.unlockMaxWaitMs;
  let balances = await session.api.getBalances(session.partyId);
  while (unlockedOf(balances, token) < need && Date.now() < deadline) {
    const u = unlockedOf(balances, token);
    logger.info({ token, unlocked: u, need }, "waiting for escrow unlock");
    onWait?.(u);
    await new Promise((r) => setTimeout(r, cfg.unlockPollMs));
    balances = await session.api.getBalances(session.partyId);
  }
  return balances;
}

export async function runAccount(
  cfg: Config,
  acc: ResolvedAccount,
  hooks: AccountHooks = {},
  signal?: CancelToken,
): Promise<RunSummary> {
  const up = (u: Partial<Row>) => hooks.update?.(u);
  const questStr = (qs: { status: string }[]) =>
    `${qs.filter((q) => q.status === "completed").length}/${qs.length}`;
  const startedAt = new Date().toISOString();
  const summary: RunSummary = {
    account: acc.name,
    partyId: "",
    startedAt,
    finishedAt: startedAt,
    swapsAttempted: 0,
    swapsSucceeded: 0,
    questsCompleted: [],
    questsRemaining: [],
    spentCC: 0,
    errors: [],
  };

  up({ state: "busy", phase: "loading session", party: acc.bundle.partyId?.slice(-6) ?? "" });
  let session: Session;
  try {
    session = Session.create(cfg.apiBase, acc.bundle, acc.password, acc.persist);
    summary.partyId = session.partyId;
    up({ party: session.partyId.slice(-6), phase: "refreshing token" });
    await session.ensureFresh();
  } catch (err) {
    summary.aborted = err instanceof Error ? err.message : String(err);
    summary.finishedAt = new Date().toISOString();
    up({ state: "error", phase: "auth failed", note: summary.aborted });
    return summary;
  }

  const counters: RunCounters = { spentCC: 0, swapCount: 0 };
  try {
    // Onboarding follow quests: just PATCH follows=true (no real follow needed).
    for (const platform of ["x", "telegram"] as const) {
      if (!cfg.socialFollow[platform]) continue;
      try {
        await session.api.setSocialFollow(platform, true);
        logger.info({ account: acc.name, platform }, "social follow marked");
      } catch (err) {
        summary.errors.push(`follow ${platform}: ${err instanceof Error ? err.message : err}`);
      }
    }

    up({ phase: "follow quests" });
    let quests = await session.api.getQuests();
    let balances = await session.api.getBalances(session.partyId);
    let consecutiveFails = 0;
    up({ quests: questStr(quests), bal: formatBalances(balances, (t) => TOKEN_LABEL[t]), phase: "working" });

    // Quest-driven loop: re-read progress each iteration, do ONE swap toward the
    // next remaining quest, repeat until all quests done (plan() returns []), a
    // guard trips, or too many swaps/failures. This keeps swapping while a quest
    // is unfinished and stops as soon as it completes (handles back-swaps that
    // count, and re-tries quests left short by failed swaps).
    while (true) {
      if (signal?.cancelled) {
        summary.aborted = "stopped by user";
        break;
      }
      const remaining = plan(quests, { swapAmountCC: cfg.swapAmountCC, roundTrip: cfg.roundTrip });
      if (remaining.length === 0) break; // all quests done -> stop
      const action = remaining[0];

      if (consecutiveFails >= 3) {
        summary.aborted = "3 consecutive swap failures";
        break;
      }

      // Wait for escrow to release FIRST: Kairo rejects a swap unless unlocked
      // balance covers amount + fee buffer, and freshly-swapped CC locks ~1 round.
      const need = action.from === "Amulet" ? action.amountCC + cfg.swapReserveCC : action.amountCC;
      if (unlockedOf(balances, action.from) < need) {
        if (cfg.waitForUnlock) {
          up({ state: "wait", phase: "wait escrow unlock", note: `need ${need} ${action.from}` });
          balances = await waitForUnlock(session, action.from, need, cfg, (u) =>
            up({ note: `unlocked ${u.toFixed(2)}/${need}` }),
          );
        }
        if (unlockedOf(balances, action.from) < need) {
          summary.errors.push(
            `${action.from}->${action.to}: unlocked ${action.from}=${unlockedOf(balances, action.from)} < ${need} (escrow locked)`,
          );
          summary.aborted = "insufficient unlocked balance";
          break;
        }
      }

      // Safety guards (max swaps, daily cap, CC floor) on the refreshed balance.
      const guard = checkAction(cfg, ccBalanceOf(balances), action, counters);
      if (!guard.ok) {
        summary.aborted = guard.reason;
        break;
      }

      up({
        state: "busy",
        phase: `swap ${action.from}→${action.to}`,
        note: `${action.amountCC} CC`,
        swaps: counters.swapCount,
      });
      summary.swapsAttempted += 1;
      const res = await retry(() => executeSwap(session, action.from, action.to, action.amountCC));
      counters.swapCount += 1;
      counters.spentCC += action.amountCC;
      summary.spentCC = counters.spentCC;
      if (res.ok) {
        summary.swapsSucceeded += 1;
        consecutiveFails = 0;
        if (action.roundTripBack && res.outputAmount) {
          await new Promise((r) => setTimeout(r, cfg.swapDelayMs));
          const back = await retry(() =>
            executeSwap(session, action.to, action.from, Number(res.outputAmount)),
          );
          counters.swapCount += 1;
          if (!back.ok) summary.errors.push(`back ${action.to}->${action.from}: ${back.error}`);
        }
      } else {
        consecutiveFails += 1;
        summary.errors.push(`${action.from}->${action.to}: ${res.error}`);
      }

      await new Promise((r) => setTimeout(r, cfg.swapDelayMs));
      balances = await session.api.getBalances(session.partyId);
      quests = await session.api.getQuests(); // re-read progress for next iteration
      up({ quests: questStr(quests), bal: formatBalances(balances, (t) => TOKEN_LABEL[t]), swaps: counters.swapCount });
    }

    quests = await session.api.getQuests();
    summary.questsCompleted = quests.filter((q) => q.status === "completed").map((q) => q.id);
    summary.questsRemaining = quests.filter((q) => q.status !== "completed").map((q) => q.id);
    if (summary.questsRemaining.length > 0) up({ phase: "consolidating" });

    // Consolidate: swap any leftover non-CC tokens back to CC (Amulet).
    if (cfg.consolidateToCC && (!cfg.consolidateOnlyWhenQuestsDone || summary.questsRemaining.length === 0)) {
      balances = await session.api.getBalances(session.partyId);
      for (const b of balances) {
        if (b.token === "Amulet" || b.unlocked <= cfg.dustMinUnlocked) continue;
        logger.info({ account: acc.name, token: b.token, amount: b.unlocked }, "consolidating to CC");
        const res = await retry(() => executeSwap(session, b.token, "Amulet", b.unlocked));
        if (res.ok) summary.swapsSucceeded += 1;
        else summary.errors.push(`consolidate ${b.token}->Amulet: ${res.error}`);
        summary.swapsAttempted += 1;
        await new Promise((r) => setTimeout(r, cfg.swapDelayMs));
      }
    }
  } catch (err) {
    summary.errors.push(err instanceof Error ? err.message : String(err));
  }

  summary.finishedAt = new Date().toISOString();
  const allDone = summary.questsRemaining.length === 0 && !summary.aborted;
  up({
    state: allDone ? "done" : "error",
    quests: `${summary.questsCompleted.length}/${summary.questsCompleted.length + summary.questsRemaining.length}`,
    swaps: counters.swapCount,
    phase: summary.aborted ?? (allDone ? "all quests done" : "finished with issues"),
    note: summary.errors.length ? summary.errors[summary.errors.length - 1].slice(0, 24) : "",
  });
  return summary;
}
