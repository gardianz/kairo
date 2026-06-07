// Inspect IndexedDB "cantonNetwork" structure: db version, object stores,
// keyPaths, indexes, record counts. NO record VALUES printed (may hold key).
import { chromium } from "playwright";

const browser = await chromium.connectOverCDP("http://localhost:9222");
const ctx = browser.contexts()[0];
const page = ctx.pages().find((p) => p.url().includes("kairo.ag")) ?? ctx.pages()[0];

const struct = await page.evaluate(async () => {
  function openDb(name) {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(name);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  function count(store) {
    return new Promise((res) => {
      const r = store.count();
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(-1);
    });
  }
  const db = await openDb("cantonNetwork");
  const stores = [];
  for (const name of Array.from(db.objectStoreNames)) {
    const tx = db.transaction(name, "readonly");
    const os = tx.objectStore(name);
    stores.push({
      name,
      keyPath: os.keyPath,
      autoIncrement: os.autoIncrement,
      indexes: Array.from(os.indexNames),
      records: await count(os),
    });
  }
  return { version: db.version, name: db.name, stores };
});

console.log(JSON.stringify(struct, null, 2));
await browser.close();
