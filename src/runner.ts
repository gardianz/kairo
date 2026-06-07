// Run one account: read live quests + balance, plan remaining actions, execute
// swaps under safety guards, then report.
import type { Config } from "./config.ts";
import type { Balance, QuestActivity, RunSummary, Token } from "./types.ts";
import { cardBal, questView } from "./types.ts";
import type { ResolvedAccount } from "./accounts.ts";
import type { AcctView, Kind } from "./dashboard.ts";
import { Session } from "./session.ts";
import { plan } from "./quest-engine.ts";
import { checkAction, type RunCounters } from "./safety.ts";
import { executeSwap, executePairSwap, retry, isNonRetryable, parseLiquidity } from "./swap.ts";
import { logger } from "./reporter.ts";

export interface AccountHooks {
  acct?: (u: Partial<AcctView>) => void;
  log?: (msg: string, kind: Kind) => void;
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
  const up = (u: Partial<AcctView>) => hooks.acct?.(u);
  const log = (msg: string, kind: Kind = "info") => hooks.log?.(msg, kind);
  const lbl = (t: Token) => (t === "Amulet" ? "CC" : t); // friendly token name in messages
  const balView = (b: Balance[]) => ({
    cc: cardBal(b, "Amulet"),
    uxBal: cardBal(b, "USDCx"),
    cbBal: cardBal(b, "CBTC"),
  });
  let swOk = 0,
    swFail = 0;
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
    liquiditySkipped: [],
  };

  up({ state: "busy", status: "memuat sesi", party: acc.bundle.partyId?.slice(-6) ?? "" });
  if (acc.proxy) {
    const host = acc.proxy.replace(/^https?:\/\/([^@]*@)?/i, "").split("/")[0];
    log(`memakai proxy ${host}`, "proxy");
  }
  let session: Session;
  try {
    session = Session.create(cfg.apiBase, acc.bundle, acc.password, acc.persist, acc.proxy);
    summary.partyId = session.partyId;
    up({ party: session.partyId.slice(-6), status: "menyegarkan token login" });
    await session.ensureFresh();
  } catch (err) {
    summary.aborted = err instanceof Error ? err.message : String(err);
    summary.finishedAt = new Date().toISOString();
    up({ state: "error", status: `gagal login: ${summary.aborted}` });
    log(`gagal login: ${summary.aborted}`, "error");
    return summary;
  }

  const counters: RunCounters = { spentCC: 0, swapCount: 0 };
  let quests: QuestActivity[] = [];
  try {
    // Onboarding follow quests: just PATCH follows=true (no real follow needed).
    for (const platform of ["x", "telegram"] as const) {
      if (!cfg.socialFollow[platform]) continue;
      try {
        await session.api.setSocialFollow(platform, true);
        log(`klaim follow ${platform === "x" ? "X (Twitter)" : "Telegram"} ✓`, "done");
      } catch (err) {
        summary.errors.push(`follow ${platform}: ${err instanceof Error ? err.message : err}`);
      }
    }

    up({ status: "membaca quest & saldo" });
    quests = await session.api.getQuests();
    let balances = await session.api.getBalances(session.partyId);
    let consecutiveFails = 0;
    const skipQuests = new Set<string>(); // quests that can't complete now (e.g. no liquidity)
    const liqAttempts = new Map<string, number>(); // per-quest liquidity retry counter
    const qv = questView(quests);
    up({ ...qv, ...balView(balances), status: "memproses quest" });
    log(
      `saldo CC ${cardBal(balances, "Amulet")} · quest ${quests.filter((q) => q.status === "completed").length}/${quests.length} selesai`,
      "balance",
    );

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
      const remaining = plan(quests, {
        swapAmountCC: cfg.swapAmountCC,
        pairSwapCC: cfg.pairSwapCC,
        roundTrip: cfg.roundTrip,
      }).filter((a) => !skipQuests.has(a.questId));
      if (remaining.length === 0) break; // all quests done (or rest un-completable) -> stop
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
          up({ state: "wait", status: `menunggu ${lbl(action.from)} cair (butuh ${need})` });
          log(`menunggu escrow cair — butuh ${need} ${lbl(action.from)}`, "info");
          balances = await waitForUnlock(session, action.from, need, cfg, (u) =>
            up({ status: `menunggu ${lbl(action.from)} cair: ${u.toFixed(2)}/${need}` }),
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

      up({ state: "busy", status: `swap ${lbl(action.from)} → ${lbl(action.to)} ${action.amountCC} CC` });
      summary.swapsAttempted += 1;
      const res = action.pair
        ? await executePairSwap(session, action.from, action.to, action.amountCC)
        : await retry(() => executeSwap(session, action.from, action.to, action.amountCC));
      counters.swapCount += 1;
      counters.spentCC += action.amountCC;
      summary.spentCC = counters.spentCC;
      if (res.ok) {
        summary.swapsSucceeded += 1;
        swOk += 1;
        consecutiveFails = 0;
        log(`swap ${lbl(action.from)} → ${lbl(action.to)} ${action.amountCC} CC berhasil`, "swap");
        if (action.roundTripBack && res.outputAmount) {
          await new Promise((r) => setTimeout(r, cfg.swapDelayMs));
          const back = await retry(() =>
            executeSwap(session, action.to, action.from, Number(res.outputAmount)),
          );
          counters.swapCount += 1;
          if (back.ok) {
            swOk += 1;
            log(`swap balik ${lbl(action.to)} → ${lbl(action.from)} berhasil`, "swap");
          } else {
            swFail += 1;
            summary.errors.push(`back ${action.to}->${action.from}: ${back.error}`);
            log(`swap balik ${lbl(action.to)} → ${lbl(action.from)} gagal`, "error");
          }
        }
      } else {
        swFail += 1;
        summary.errors.push(`${action.from}->${action.to}: ${res.error}`);
        if (isNonRetryable(res.error)) {
          consecutiveFails = 0; // liquidity is not a real failure
          const liq = parseLiquidity(res.error);
          const detail = liq
            ? `pool ${lbl(action.to)} ${liq.available} < butuh ${liq.required}`
            : `liquiditas ${lbl(action.to)} kurang`;
          const attempts = (liqAttempts.get(action.questId) ?? 0) + 1;
          liqAttempts.set(action.questId, attempts);
          const capped = cfg.liquidityMaxAttempts > 0 && attempts >= cfg.liquidityMaxAttempts;
          if (cfg.liquidityRetry && !capped) {
            // Keep trying until the pool refills. Escrow unlock (next iteration's
            // waitForUnlock) paces retries; add a small extra wait too.
            up({ state: "wait", status: `${detail} — coba lagi (percobaan ${attempts})` });
            log(`${detail} — tunggu ${cfg.liquidityRetryMinutes} mnt, coba lagi (percobaan ${attempts})`, "info");
            if (cfg.liquidityRetryMinutes > 0)
              await new Promise((r) => setTimeout(r, cfg.liquidityRetryMinutes * 60_000));
            // do NOT skip — loop re-plans the same quest and retries
          } else {
            skipQuests.add(action.questId);
            log(`swap ${lbl(action.from)} → ${lbl(action.to)} dilewati: ${detail}`, "error");
          }
        } else {
          consecutiveFails += 1;
          log(`swap ${lbl(action.from)} → ${lbl(action.to)} gagal: ${String(res.error).slice(0, 30)}`, "error");
        }
      }

      await new Promise((r) => setTimeout(r, cfg.swapDelayMs));
      balances = await session.api.getBalances(session.partyId);
      quests = await session.api.getQuests(); // re-read progress for next iteration
      up({ ...questView(quests), ...balView(balances), swOk, swFail });
    }

    quests = await session.api.getQuests();
    summary.questsCompleted = quests.filter((q) => q.status === "completed").map((q) => q.id);
    summary.questsRemaining = quests.filter((q) => q.status !== "completed").map((q) => q.id);
    summary.liquiditySkipped = [...skipQuests];
    if (summary.questsRemaining.length > 0) up({ status: "menukar sisa token ke CC" });

    // Consolidate: swap any leftover non-CC tokens back to CC (Amulet).
    if (cfg.consolidateToCC && (!cfg.consolidateOnlyWhenQuestsDone || summary.questsRemaining.length === 0)) {
      balances = await session.api.getBalances(session.partyId);
      for (const b of balances) {
        if (b.token === "Amulet" || b.unlocked <= cfg.dustMinUnlocked) continue;
        const res = await retry(() => executeSwap(session, b.token, "Amulet", b.unlocked));
        if (res.ok) {
          summary.swapsSucceeded += 1;
          swOk += 1;
        } else summary.errors.push(`consolidate ${b.token}->Amulet: ${res.error}`);
        summary.swapsAttempted += 1;
        await new Promise((r) => setTimeout(r, cfg.swapDelayMs));
      }
      balances = await session.api.getBalances(session.partyId);
      up({ ...balView(balances), swOk, swFail });
      log(`tukar sisa token ke CC selesai (saldo CC ${cardBal(balances, "Amulet")})`, "done");
    }
  } catch (err) {
    summary.errors.push(err instanceof Error ? err.message : String(err));
  }

  summary.finishedAt = new Date().toISOString();
  const allDone = summary.questsRemaining.length === 0 && !summary.aborted;
  log(
    allDone ? "semua quest selesai — menunggu jadwal berikutnya" : summary.aborted ?? "selesai dengan kendala",
    allDone ? "done" : "error",
  );
  up({
    state: allDone ? "done" : "error",
    ...questView(quests),
    swOk,
    swFail,
    status: allDone ? "semua quest selesai — menunggu jadwal" : summary.aborted ?? "selesai dengan kendala",
  });
  return summary;
}
