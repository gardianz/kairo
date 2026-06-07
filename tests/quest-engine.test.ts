import { describe, it, expect } from "vitest";
import { plan } from "../src/quest-engine.ts";
import type { QuestActivity } from "../src/types.ts";

const cfg = { swapAmountCC: 10, roundTrip: true };

function q(p: Partial<QuestActivity>): QuestActivity {
  return {
    id: "x",
    label: "",
    status: "pending",
    current: 0,
    target: 1,
    unit: "swap",
    meta: {},
    ...p,
  };
}

describe("plan", () => {
  it("no actions when all completed", () => {
    const quests = [
      q({ id: "count", status: "completed", target: 5, current: 5 }),
      q({ id: "pair", status: "completed", meta: { pair: ["Amulet", "CBTC"] } }),
    ];
    expect(plan(quests, cfg)).toEqual([]);
  });

  it("plans remaining swaps for a count quest", () => {
    const quests = [
      q({ id: "count", target: 5, current: 2, unit: "swaps", meta: { minAmount: "10" } }),
    ];
    const a = plan(quests, cfg);
    expect(a).toHaveLength(3);
    expect(a[0]).toMatchObject({ questId: "count", from: "Amulet", to: "CBTC", amountCC: 10, roundTripBack: true });
  });

  it("respects minAmount higher than swapAmountCC", () => {
    const quests = [q({ id: "count", target: 1, current: 0, meta: { minAmount: "25" } })];
    expect(plan(quests, cfg)[0].amountCC).toBe(25);
  });

  it("plans a pair swap in the meta direction", () => {
    const quests = [q({ id: "pair", meta: { pair: ["Amulet", "USDCx"] } })];
    const a = plan(quests, cfg);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ from: "Amulet", to: "USDCx" });
  });

  it("honors roundTrip=false", () => {
    const quests = [q({ id: "count", target: 1, current: 0 })];
    expect(plan(quests, { swapAmountCC: 10, roundTrip: false })[0].roundTripBack).toBe(false);
  });
});
