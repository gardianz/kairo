import { describe, it, expect } from "vitest";
import { checkAction } from "../src/safety.ts";
import type { Action } from "../src/types.ts";

const cfg = { dailySpendCapCC: 100, minBalanceFloorCC: 50, maxSwapsPerRun: 12 };
const action: Action = { questId: "q", from: "Amulet", to: "CBTC", amountCC: 10, roundTripBack: false };

describe("checkAction", () => {
  it("allows a normal action", () => {
    expect(checkAction(cfg, 1000, action, { spentCC: 0, swapCount: 0 })).toEqual({ ok: true });
  });
  it("blocks over daily cap", () => {
    expect(checkAction(cfg, 1000, action, { spentCC: 95, swapCount: 0 }).ok).toBe(false);
  });
  it("blocks below CC floor", () => {
    expect(checkAction(cfg, 55, action, { spentCC: 0, swapCount: 0 }).ok).toBe(false);
  });
  it("blocks over max swaps", () => {
    expect(checkAction(cfg, 1000, action, { spentCC: 0, swapCount: 12 }).ok).toBe(false);
  });
  it("ignores floor when source is not CC", () => {
    const back: Action = { ...action, from: "CBTC", to: "Amulet" };
    expect(checkAction(cfg, 0, back, { spentCC: 0, swapCount: 0 }).ok).toBe(true);
  });
});
