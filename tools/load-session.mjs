// Load a Kairo session bundle into a fresh browser profile and verify it is
// authenticated WITHOUT Google login. Proves the multi-account mechanism.
//
// Usage: node tools/load-session.mjs <bundle.json> <userDataDir> [--headed]
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const [, , bundlePath, userDataDir, ...rest] = process.argv;
if (!bundlePath || !userDataDir) {
  console.error("usage: load-session.mjs <bundle.json> <userDataDir> [--headed]");
  process.exit(1);
}
const headed = rest.includes("--headed");
const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));

const ctx = await chromium.launchPersistentContext(userDataDir, {
  headless: !headed,
  executablePath: process.env.CHROME_EXEC || undefined,
  args: ["--no-sandbox"],
});
const page = ctx.pages()[0] ?? (await ctx.newPage());

// 1. Load origin so localStorage/IndexedDB are addressable.
await page.goto("https://kairo.ag/", { waitUntil: "domcontentloaded" });

// 2. Inject localStorage + restore IndexedDB cantonNetwork.
await page.evaluate(async (b) => {
  for (const [k, v] of Object.entries(b.localStorage)) {
    if (v != null) localStorage.setItem(k, v);
  }
  const idb = b.indexedDB?.cantonNetwork;
  if (idb) {
    await new Promise((resolve, reject) => {
      const req = indexedDB.open("cantonNetwork", idb.version || 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const storeName of Object.keys(idb.stores)) {
          if (!db.objectStoreNames.contains(storeName)) {
            db.createObjectStore(storeName, { keyPath: "id", autoIncrement: true });
          }
        }
      };
      req.onsuccess = async () => {
        const db = req.result;
        const names = Object.keys(idb.stores);
        const tx = db.transaction(names, "readwrite");
        for (const storeName of names) {
          const os = tx.objectStore(storeName);
          for (const rec of idb.stores[storeName]) os.put(rec);
        }
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
  }
}, bundle);

// 3. Reload into dashboard with session present.
await page.goto("https://kairo.ag/dashboard", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);

// 4. Verify: call an authed API from inside the page + check URL.
const check = await page.evaluate(async () => {
  const at = localStorage.getItem("authToken");
  const partyId = localStorage.getItem("partyId");
  let apiStatus = null;
  try {
    const r = await fetch("https://api.kairo.ag/trader-analytics/daily-swap-activities", {
      headers: { Authorization: `Bearer ${at}` },
    });
    apiStatus = r.status;
  } catch (e) {
    apiStatus = String(e);
  }
  return { url: location.href, hasParty: Boolean(partyId), partyTail: partyId?.slice(-6), apiStatus };
});

console.log("RESULT:", JSON.stringify(check, null, 2));
console.log(
  check.url.includes("dashboard") && check.apiStatus === 200
    ? "✅ AUTHENTICATED without Google"
    : "❌ not authenticated",
);
await ctx.close();
