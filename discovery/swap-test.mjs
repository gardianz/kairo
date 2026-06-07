// Full pure-API swap test: quote -> prepare -> sign -> submit. Spends 10 CC.
// Reads auth + wallet from live CDP session (in-memory), password from secret/pw.txt.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import pkg from "crypto-js";
import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";

const { AES, enc } = pkg;
const { decodeBase64, encodeBase64 } = naclUtil;

const gt = (cantonKey, password) => {
  const out = AES.decrypt(cantonKey, password).toString(enc.Utf8);
  if (!out) throw new Error("Invalid key or secret.");
  return out;
};
const signHash = (hashB64, secretB64) =>
  encodeBase64(nacl.sign.detached(decodeBase64(hashB64), decodeBase64(secretB64)));

const password = readFileSync("/home/gosjavar/bot-erdrop/kairo/secret/pw.txt", "utf8").trim();

const browser = await chromium.connectOverCDP("http://localhost:9222");
const ctx = browser.contexts()[0];
const page = ctx.pages().find((p) => p.url().includes("kairo.ag")) ?? ctx.pages()[0];

const sess = await page.evaluate(async () => {
  const openDb = (n) => new Promise((res, rej) => { const r = indexedDB.open(n); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const getAll = (s) => new Promise((res, rej) => { const r = s.getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const db = await openDb("cantonNetwork");
  const recs = await getAll(db.transaction("storeCanton", "readonly").objectStore("storeCanton"));
  return {
    authToken: localStorage.getItem("authToken"),
    partyId: localStorage.getItem("partyId"),
    cantonKey: recs[0]?.cantonKey,
  };
});

const secret = gt(sess.cantonKey, password);
const API = "https://api.kairo.ag";
const H = { Authorization: `Bearer ${sess.authToken}`, "Content-Type": "application/json" };

const IN = "Amulet", OUT = "CBTC", AMOUNT = "10";

async function j(label, p, opts) {
  const r = await fetch(API + p, opts);
  const t = await r.text();
  let body; try { body = JSON.parse(t); } catch { body = t; }
  console.log(`\n[${label}] ${opts?.method || "GET"} ${p} -> ${r.status}`);
  console.log(JSON.stringify(body).slice(0, 600));
  return { status: r.status, body };
}

// 1. quote
await j("quote", `/swap/market-quote-v2?inputTokenType=${IN}&outputTokenType=${OUT}`, { headers: H });

// 2. prepare
const prep = await j("prepare", "/swap/simple-escrow/prepare", {
  method: "POST", headers: H,
  body: JSON.stringify({ trader: sess.partyId, inputAmount: AMOUNT, inputTokenType: IN, outputTokenType: OUT }),
});
const g = prep.body?.data?.data ?? prep.body?.data;
if (!g?.preparedTransactionHash) { console.log("\nNO preparedTransactionHash -> stop"); await browser.close(); process.exit(1); }

// 3. sign
const signature = signHash(g.preparedTransactionHash, secret);
console.log("\n[sign] signature len:", signature.length);

// 4. submit
await j("submit", "/swap/simple-escrow/submit", {
  method: "POST", headers: H,
  body: JSON.stringify({
    preparedTransaction: g.preparedTransaction,
    hashingSchemeVersion: g.hashingSchemeVersion,
    inputTokenType: IN, outputTokenType: OUT,
    inputAmount: AMOUNT, trader: sess.partyId,
    signature, outputAmount: g.outputAmount,
  }),
});

// 5. balance after
await new Promise((r) => setTimeout(r, 4000));
await j("balance", `/swap/token-balance?partyId=${encodeURIComponent(sess.partyId)}`, { headers: H });
// 6. quest progress
await j("quests", "/trader-analytics/daily-swap-activities", { headers: H });

await browser.close();
