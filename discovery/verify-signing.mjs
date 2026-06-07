// Verify reproduced wallet signing WITHOUT exposing secrets.
// Reads cantonKey (IndexedDB) + publicKey (localStorage) from the live CDP
// session, reads wallet password from secret/pw.txt (you create it), then
// checks: derived pubkey == stored pubkey. Prints only MATCH / NO MATCH.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import pkg from "crypto-js";
import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";

const { AES, enc } = pkg;
const { decodeBase64, encodeBase64 } = naclUtil;

// gt: decrypt cantonKey with password -> secret (base64 string)
const gt = (cantonKey, password) => {
  const out = AES.decrypt(cantonKey, password).toString(enc.Utf8);
  if (!out) throw new Error("Invalid key or secret.");
  return out;
};
// derive pubkey (base64) from secret (base64) — matches bundle FB()
const pubFromSecret = (secretB64) =>
  encodeBase64(nacl.sign.keyPair.fromSecretKey(decodeBase64(secretB64)).publicKey);
// Vt: sign base64 hash with base64 secret -> base64 signature
export const signHash = (hashB64, secretB64) =>
  encodeBase64(nacl.sign.detached(decodeBase64(hashB64), decodeBase64(secretB64)));

const password = readFileSync(
  process.env.PW_FILE || "/home/gosjavar/bot-erdrop/kairo/secret/pw.txt",
  "utf8",
).trim();

const browser = await chromium.connectOverCDP("http://localhost:9222");
const ctx = browser.contexts()[0];
const page = ctx.pages().find((p) => p.url().includes("kairo.ag")) ?? ctx.pages()[0];

const wallet = await page.evaluate(async () => {
  const openDb = (n) =>
    new Promise((res, rej) => {
      const r = indexedDB.open(n);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  const getAll = (s) =>
    new Promise((res, rej) => {
      const r = s.getAll();
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  const db = await openDb("cantonNetwork");
  const tx = db.transaction("storeCanton", "readonly");
  const recs = await getAll(tx.objectStore("storeCanton"));
  const rec = recs[0] || {};
  return {
    cantonKey: rec.cantonKey,
    recKeys: Object.keys(rec),
    publicKey: localStorage.getItem("publicKey"),
  };
});

console.log("wallet record fields:", JSON.stringify(wallet.recKeys));
console.log("stored publicKey len:", (wallet.publicKey || "").length);

try {
  const secret = gt(wallet.cantonKey, password);
  const derived = pubFromSecret(secret);
  const match = derived === wallet.publicKey;
  console.log("secret decrypted len:", secret.length);
  console.log("derived pubkey == stored pubkey:", match ? "✅ MATCH" : "❌ NO MATCH");
  console.log(match ? "SIGNING REPRO CORRECT" : "SIGNING REPRO WRONG");
} catch (e) {
  console.log("❌ decrypt failed:", e.message, "(wrong password?)");
}
await browser.close();
