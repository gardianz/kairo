// An authenticated Kairo account session: holds tokens + decrypted signing key,
// auto-refreshes the authToken, and exposes a KairoApi + signing.
import type { SessionBundle } from "./types.ts";
import { decryptSecret, signHash, verifySecret } from "./crypto.ts";
import { KairoApi } from "./api.ts";
import { makeDispatcher } from "./proxy.ts";

function jwtExp(token: string): number {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64").toString("utf8"));
    return Number(payload.exp ?? 0);
  } catch {
    return 0;
  }
}

export type PersistFn = (bundle: SessionBundle) => void;

export class Session {
  readonly partyId: string;
  readonly api: KairoApi;
  private bundle: SessionBundle;
  private authToken: string;
  private refreshToken: string;
  private readonly secret: string;
  private readonly persist?: PersistFn;

  private constructor(
    apiBase: string,
    bundle: SessionBundle,
    secret: string,
    persist?: PersistFn,
    proxy?: string,
  ) {
    this.bundle = bundle;
    this.partyId = bundle.partyId || bundle.localStorage.partyId;
    this.authToken = bundle.localStorage.authToken;
    this.refreshToken = bundle.localStorage.refreshToken;
    this.secret = secret;
    this.persist = persist;
    this.api = new KairoApi(apiBase, () => this.authToken, makeDispatcher(proxy));
  }

  // Build from an in-memory bundle + password (verifies before returning).
  static create(
    apiBase: string,
    bundle: SessionBundle,
    password: string,
    persist?: PersistFn,
    proxy?: string,
  ): Session {
    const cantonKey = bundle.indexedDB?.cantonNetwork?.stores?.storeCanton?.[0]?.cantonKey;
    if (!cantonKey) throw new Error("bundle missing cantonKey");
    const secret = decryptSecret(cantonKey, password);
    if (!verifySecret(secret, bundle.localStorage.publicKey)) {
      throw new Error("derived pubkey != stored publicKey (bad password/bundle)");
    }
    return new Session(apiBase, bundle, secret, persist, proxy);
  }

  sign(preparedTransactionHash: string): string {
    return signHash(preparedTransactionHash, this.secret);
  }

  // Ensure the authToken is valid for at least `marginSec` more seconds.
  async ensureFresh(marginSec = 120): Promise<void> {
    if (jwtExp(this.authToken) - Date.now() / 1000 > marginSec) return;
    const next = await this.api.refresh(this.refreshToken);
    this.authToken = next.token;
    this.refreshToken = next.refreshToken;
    this.bundle.localStorage.authToken = next.token;
    this.bundle.localStorage.refreshToken = next.refreshToken;
    try {
      this.persist?.(this.bundle);
    } catch {
      /* non-fatal: in-memory tokens still valid this run */
    }
  }
}
