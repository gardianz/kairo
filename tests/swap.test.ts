import { describe, it, expect } from "vitest";
import { isNonRetryable, parseLiquidity, retry } from "../src/swap.ts";

describe("parseLiquidity", () => {
  it("extracts required + available from the error", () => {
    const e = '400 /swap/simple-escrow/submit: "Insufficient holdings. Required: 1.8151329973, available: 0.0369996495"';
    expect(parseLiquidity(e)).toEqual({ required: 1.8151329973, available: 0.0369996495 });
  });
  it("returns null when no numbers", () => {
    expect(parseLiquidity("network timeout")).toBeNull();
    expect(parseLiquidity(undefined)).toBeNull();
  });
});

describe("isNonRetryable", () => {
  it("flags liquidity / holdings errors", () => {
    expect(isNonRetryable("400 submit: Insufficient holdings. Required: 1.8, available: 0.03")).toBe(true);
    expect(isNonRetryable("INSUFFICIENT_SWAP_HOLDINGS")).toBe(true);
    expect(isNonRetryable("network timeout")).toBe(false);
    expect(isNonRetryable(undefined)).toBe(false);
  });
});

describe("retry", () => {
  it("retries transient failures then succeeds", async () => {
    let n = 0;
    const r = await retry(async () => ({ ok: ++n >= 2, error: n < 2 ? "timeout" : undefined }), 3, 1);
    expect(r.ok).toBe(true);
    expect(n).toBe(2);
  });

  it("does NOT retry a non-retryable error", async () => {
    let n = 0;
    const r = await retry(async () => ({ ok: false, error: "Insufficient holdings", count: ++n }), 3, 1);
    expect(r.ok).toBe(false);
    expect(n).toBe(1); // only one attempt
  });
});
