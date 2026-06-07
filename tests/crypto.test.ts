import { describe, it, expect } from "vitest";
import CryptoJS from "crypto-js";
import nacl from "tweetnacl";
import { encodeBase64 } from "tweetnacl-util";
import { decryptSecret, pubFromSecret, signHash, verifySecret } from "../src/crypto.ts";

// Generate a wallet exactly like Kairo does: ed25519 keypair, secret stored as
// base64, AES-encrypted with the password.
function makeWallet(password: string) {
  const kp = nacl.sign.keyPair();
  const secretB64 = encodeBase64(kp.secretKey);
  const publicKey = encodeBase64(kp.publicKey);
  const cantonKey = CryptoJS.AES.encrypt(secretB64, password).toString();
  return { secretB64, publicKey, cantonKey };
}

describe("crypto", () => {
  it("decrypts cantonKey back to the secret", () => {
    const w = makeWallet("hunter2");
    expect(decryptSecret(w.cantonKey, "hunter2")).toBe(w.secretB64);
  });

  it("throws on wrong password", () => {
    const w = makeWallet("hunter2");
    expect(() => decryptSecret(w.cantonKey, "wrong")).toThrow();
  });

  it("derives the stored public key from the secret", () => {
    const w = makeWallet("pw");
    expect(pubFromSecret(w.secretB64)).toBe(w.publicKey);
  });

  it("verifySecret matches stored public key", () => {
    const w = makeWallet("pw");
    expect(verifySecret(w.secretB64, w.publicKey)).toBe(true);
    expect(verifySecret(w.secretB64, "AAAA")).toBe(false);
  });

  it("produces a valid signature verifiable with the public key", () => {
    const w = makeWallet("pw");
    const msg = encodeBase64(new Uint8Array([1, 2, 3, 4, 5]));
    const sig = signHash(msg, w.secretB64);
    const ok = nacl.sign.detached.verify(
      new Uint8Array([1, 2, 3, 4, 5]),
      Buffer.from(sig, "base64"),
      Buffer.from(w.publicKey, "base64"),
    );
    expect(ok).toBe(true);
  });
});
