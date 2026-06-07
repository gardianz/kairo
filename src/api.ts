// Thin client for the Kairo backend API (api.kairo.ag). Auth = Bearer authToken.
import type { Balance, QuestActivity, Token } from "./types.ts";

export interface PreparedSwap {
  preparedTransaction: string;
  preparedTransactionHash: string;
  hashingSchemeVersion: string;
  outputAmount: string;
}

export class KairoApi {
  constructor(
    private base: string,
    private getToken: () => string,
  ) {}

  private async req(path: string, init?: RequestInit): Promise<any> {
    const res = await fetch(this.base + path, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.getToken()}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
    const text = await res.text();
    let body: any;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    if (!res.ok) {
      const msg = body?.message ?? text;
      const err = new Error(`${res.status} ${path}: ${JSON.stringify(msg).slice(0, 200)}`);
      (err as any).status = res.status;
      throw err;
    }
    return body;
  }

  async getBalances(partyId: string): Promise<Balance[]> {
    const r = await this.req(`/swap/token-balance?partyId=${encodeURIComponent(partyId)}`);
    return (r?.data ?? []).map((b: any) => ({
      token: b.instrumentId.id as Token,
      unlocked: Number(b.unlocked),
      locked: Number(b.locked),
    }));
  }

  async getQuests(): Promise<QuestActivity[]> {
    const r = await this.req("/trader-analytics/daily-swap-activities");
    return (r?.data?.activities ?? []).map((a: any) => ({
      id: a.id,
      label: a.label,
      status: a.status,
      current: Number(a.progress?.current ?? 0),
      target: Number(a.progress?.target ?? 0),
      unit: a.progress?.unit ?? "",
      meta: a.meta ?? {},
    }));
  }

  // Today's swap totals (24h window) for this trader.
  async getSwapsSummary(): Promise<{ totalSwaps: number; volumeUsd: number }> {
    const r = await this.req("/trader-analytics/swaps-summary");
    const s = r?.data?.summary ?? {};
    return { totalSwaps: Number(s.totalSwaps ?? 0), volumeUsd: Number(s.tradeVolumeUsd ?? 0) };
  }

  async getQuote(inputTokenType: Token, outputTokenType: Token): Promise<string | null> {
    const r = await this.req(
      `/swap/market-quote-v2?inputTokenType=${inputTokenType}&outputTokenType=${outputTokenType}`,
    );
    return r?.data?.quote ?? null;
  }

  async prepareSwap(
    trader: string,
    inputAmount: string,
    inputTokenType: Token,
    outputTokenType: Token,
  ): Promise<PreparedSwap> {
    const r = await this.req("/swap/simple-escrow/prepare", {
      method: "POST",
      body: JSON.stringify({ trader, inputAmount, inputTokenType, outputTokenType }),
    });
    const g = r?.data?.data ?? r?.data;
    if (!g?.preparedTransactionHash) throw new Error("prepare: no preparedTransactionHash");
    return g;
  }

  async submitSwap(payload: {
    preparedTransaction: string;
    hashingSchemeVersion: string;
    inputTokenType: Token;
    outputTokenType: Token;
    inputAmount: string;
    trader: string;
    signature: string;
    outputAmount: string;
  }): Promise<{ updateId?: string; outputAmount?: string }> {
    const r = await this.req("/swap/simple-escrow/submit", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const d = r?.data?.data ?? r?.data;
    return { updateId: d?.updateId, outputAmount: d?.outputAmount };
  }

  // Mark a social-follow quest complete (no real follow needed).
  async setSocialFollow(platform: "x" | "telegram", follows = true): Promise<void> {
    await this.req(`/user/me/social-follow/${platform}`, {
      method: "PATCH",
      body: JSON.stringify({ follows }),
    });
  }

  async getSocialFollow(platform: "x" | "telegram"): Promise<boolean> {
    const r = await this.req(`/user/me/social-follow/${platform}`);
    return Boolean(r?.data?.follows ?? r?.data?.data?.follows);
  }

  // Refresh authToken using the refresh token. Returns new tokens.
  async refresh(refreshToken: string): Promise<{ token: string; refreshToken: string }> {
    const res = await fetch(this.base + "/auth/refresh-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh: refreshToken }),
    });
    if (!res.ok) throw new Error(`refresh-token failed: ${res.status}`);
    const body = await res.json();
    const d = body?.data?.data ?? body?.data;
    return { token: d.token, refreshToken: d.refreshToken };
  }
}
