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
}
