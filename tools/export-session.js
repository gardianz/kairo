/*
 * Kairo session exporter — run in the DevTools Console of a browser tab that is
 * ALREADY LOGGED IN to https://kairo.ag (you must be on a kairo.ag page).
 *
 * It bundles the localStorage auth fields + the IndexedDB "cantonNetwork"
 * wallet record and downloads them as a JSON file. Paste NOTHING into chat —
 * the file contains your private key + tokens. Move it into the bot's
 * sessions/ folder yourself.
 *
 * Usage:
 *   1. Open https://kairo.ag/dashboard (logged in).
 *   2. F12 -> Console.
 *   3. Paste this whole file, press Enter.
 *   4. A file "kairo-session-<partyId>.json" downloads. Move it to sessions/.
 */
(async () => {
  if (!location.hostname.endsWith("kairo.ag")) {
    console.error("Run this on a kairo.ag tab while logged in.");
    return;
  }

  const LS_KEYS = ["authToken", "refreshToken", "publicKey", "partyId", "user"];
  const localStorageData = {};
  for (const k of LS_KEYS) localStorageData[k] = localStorage.getItem(k);

  function openDb(name) {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(name);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  function getAll(store) {
    return new Promise((resolve, reject) => {
      const r = store.getAll();
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }

  const idb = {};
  try {
    const db = await openDb("cantonNetwork");
    idb.version = db.version;
    idb.stores = {};
    for (const name of Array.from(db.objectStoreNames)) {
      const tx = db.transaction(name, "readonly");
      idb.stores[name] = await getAll(tx.objectStore(name));
    }
    db.close();
  } catch (e) {
    console.error("IndexedDB read failed:", e);
  }

  const bundle = {
    exportedAt: new Date().toISOString(),
    origin: location.origin,
    partyId: localStorageData.partyId,
    localStorage: localStorageData,
    indexedDB: { cantonNetwork: idb },
  };

  const oneLine = JSON.stringify(bundle);

  // Copy the bundle to the clipboard (DevTools `copy()` helper) so you can paste
  // it straight into the add-account wizard. No file juggling.
  try {
    copy(oneLine);
    console.log(
      "%c✅ Session copied to clipboard. Paste it into the add-account wizard.",
      "color:lime;font-weight:bold;font-size:14px",
    );
  } catch {
    console.log("%cCopy the line below manually:", "color:orange;font-weight:bold");
    console.log(oneLine);
  }

  // Also offer a file download as a fallback.
  const partyShort = (localStorageData.partyId || "account").replace(/[^a-zA-Z0-9]/g, "").slice(0, 24);
  const url = URL.createObjectURL(new Blob([oneLine], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `kairo-session-${partyShort}.json`;
  a.textContent = "download session file";
  console.log("(fallback) file also downloading:", a.download);
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
})();
