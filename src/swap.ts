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

export async function retry<T extends { ok: boolean }>(
  fn: () => Promise<T>,
  retries = 2,
  backoffMs = 3000,
): Promise<T> {
  let last = await fn();
  for (let i = 0; i < retries && !last.ok; i++) {
    await new Promise((r) => setTimeout(r, backoffMs * (i + 1)));
    last = await fn();
  }
  return last;
}
