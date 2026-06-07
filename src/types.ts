// Token tokenId values used by Kairo API. CC is internally "Amulet".
export type Token = "Amulet" | "CBTC" | "USDCx";

// Human label -> tokenId map (UI shows CC for Amulet).
export const TOKEN_LABEL: Record<Token, string> = {
  Amulet: "CC",
  CBTC: "CBTC",
  USDCx: "USDCx",
};

export interface Balance {
  token: Token;
  unlocked: number;
  locked: number;
}

// Trim a number to a short readable string (more decimals for tiny values).
function fmtAmt(n: number): string {
  if (n === 0) return "0";
  if (n >= 1) return n.toFixed(2).replace(/\.?0+$/, "");
  return n.toPrecision(3).replace(/0+$/, "").replace(/\.$/, "");
}

// "CC 9(+20L) CBTC 0.0000270 USDCx 1.5" — every token with any balance, locked shown as (+xL).
export function formatBalances(balances: Balance[], label: (t: Token) => string): string {
  const parts: string[] = [];
  for (const b of balances) {
    if (b.unlocked === 0 && b.locked === 0) continue;
    let s = `${label(b.token)} ${fmtAmt(b.unlocked)}`;
    if (b.locked > 0) s += `(+${fmtAmt(b.locked)}L)`;
    parts.push(s);
  }
  return parts.join("  ") || "empty";
}

// Card-style amount: always plain decimal (no scientific), trailing zeros trimmed.
// e.g. 9.0032 -> "9.0032", 0.0000132 -> "0.0000132".
export function fmtCardAmt(n: number): string {
  if (n === 0) return "0";
  const s = n >= 1 ? n.toFixed(4) : n.toFixed(12);
  return s.replace(/0+$/, "").replace(/\.$/, "");
}

// One token's balance for a card: "12.71(+2L)" / "7.25e-6".
export function cardBal(balances: Balance[], token: Token): string {
  const b = balances.find((x) => x.token === token);
  if (!b) return "0";
  let s = fmtCardAmt(b.unlocked);
  if (b.locked > 0) s += `(+${fmtCardAmt(b.locked)}L)`;
  return s;
}

// Map live quests to the card's CNT / CB / UX view.
export function questView(quests: QuestActivity[]): { cnt: string; cb: "Y" | "N"; ux: "Y" | "N" } {
  const count = quests.find((q) => /count|min_swap/i.test(q.id));
  const cbtc = quests.find((q) => /cbtc/i.test(q.id));
  const usdcx = quests.find((q) => /usdcx/i.test(q.id));
  return {
    cnt: count ? `${count.current}/${count.target}` : "-",
    cb: cbtc?.status === "completed" ? "Y" : "N",
    ux: usdcx?.status === "completed" ? "Y" : "N",
  };
}

// One daily quest activity as returned by the API.
export interface QuestActivity {
  id: string;
  label: string;
  status: "pending" | "completed";
  current: number;
  target: number;
  unit: string;
  meta: { minAmount?: string; token?: string; pair?: [string, string] };
}

// A planned swap action.
export interface Action {
  questId: string;
  from: Token;
  to: Token;
  amountCC: number; // CC-equivalent value, for caps/thresholds
  roundTripBack: boolean;
  pair?: boolean; // pair quest: tiny pool-sized swap, no minimum amount
}

// Result of one swap submission.
export interface SwapResult {
  ok: boolean;
  from: Token;
  to: Token;
  inputAmount: string;
  outputAmount?: string;
  updateId?: string;
  error?: string;
}

// Session bundle exported from a logged-in browser (tools/export-session.js).
export interface SessionBundle {
  partyId: string;
  localStorage: {
    authToken: string;
    refreshToken: string;
    publicKey: string;
    partyId: string;
    user: string;
  };
  indexedDB: {
    cantonNetwork: {
      version: number;
      stores: { storeCanton: Array<{ id?: number; cantonKey: string }> };
    };
  };
}

export interface RunSummary {
  account: string;
  partyId: string;
  startedAt: string;
  finishedAt: string;
  swapsAttempted: number;
  swapsSucceeded: number;
  questsCompleted: string[];
  questsRemaining: string[];
  spentCC: number;
  aborted?: string;
  errors: string[];
  liquiditySkipped: string[]; // quest ids skipped this run due to DEX liquidity
}
