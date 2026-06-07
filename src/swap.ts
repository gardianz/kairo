// Execute a single swap via the pure-API flow: quote -> prepare -> sign -> submit.
import type { Session } from "./session.ts";
import type { SwapResult, Token } from "./types.ts";

export async function executeSwap(
  session: Session,
  from: Token,
  to: Token,
  amountCC: number,
): Promise<SwapResult> {
  const inputAmount = String(amountCC);
  try {
    await session.ensureFresh();
    const prep = await session.api.prepareSwap(session.partyId, inputAmount, from, to);
    const signature = session.sign(prep.preparedTransactionHash);
    const res = await session.api.submitSwap({
      preparedTransaction: prep.preparedTransaction,
      hashingSchemeVersion: prep.hashingSchemeVersion,
      inputTokenType: from,
      outputTokenType: to,
      inputAmount,
      trader: session.partyId,
      signature,
      outputAmount: prep.outputAmount,
    });
    return {
      ok: true,
      from,
      to,
      inputAmount,
      outputAmount: res.outputAmount ?? prep.outputAmount,
      updateId: res.updateId,
    };
  } catch (err) {
    return {
      ok: false,
      from,
      to,
      inputAmount,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// Errors that won't fix on retry — retrying only locks more funds in escrows.
// e.g. liquidity shortage on the DEX side ("Insufficient holdings ...").
export function isNonRetryable(error?: string): boolean {
  if (!error) return false;
  return /insufficient holdings|insufficient_swap_holdings|liquidity/i.test(error);
}

// Pull pool numbers from a liquidity error: "Required: 1.815, available: 0.037".
export function parseLiquidity(error?: string): { required: number; available: number } | null {
  if (!error) return null;
  const m = error.match(/required:\s*([\d.]+).*?available:\s*([\d.]+)/i);
  return m ? { required: Number(m[1]), available: Number(m[2]) } : null;
}

// Complete a pair quest cheaply: pair quests have NO minimum amount, so a tiny
// swap that fits the (possibly dry) pool checks the quest off. Probe small, and
// if the pool is too small, size the swap to ~70% of available liquidity.
export async function executePairSwap(
  session: Session,
  from: Token,
  to: Token,
  tryCC: number,
): Promise<SwapResult> {
  const first = await executeSwap(session, from, to, tryCC);
  if (first.ok || !isNonRetryable(first.error)) return first;
  // pool too small for tryCC — read available and size down
  const liq = parseLiquidity(first.error);
  if (!liq || liq.available <= 0) return first;
  const quote = Number(await session.api.getQuote(from, to)); // `from` per `to`
  if (!quote || !isFinite(quote)) return first;
  const sized = Number((liq.available * quote * 0.7).toFixed(6)); // CC to spend
  if (sized <= 0) return first;
  return executeSwap(session, from, to, sized);
}

export async function retry<T extends { ok: boolean; error?: string }>(
  fn: () => Promise<T>,
  retries = 2,
  backoffMs = 3000,
): Promise<T> {
  let last = await fn();
  for (let i = 0; i < retries && !last.ok; i++) {
    if (isNonRetryable(last.error)) break; // don't burn another escrow lock
    await new Promise((r) => setTimeout(r, backoffMs * (i + 1)));
    last = await fn();
  }
  return last;
}
