let bundle = null;

const $ = (id) => document.getElementById(id);
const status = (msg, cls = "") => {
  const el = $("status");
  el.textContent = msg;
  el.className = cls;
};

// Runs INSIDE the kairo.ag tab: read localStorage + IndexedDB cantonNetwork.
async function readSession() {
  const LS = ["authToken", "refreshToken", "publicKey", "partyId", "user"];
  const localStorageData = {};
  for (const k of LS) localStorageData[k] = localStorage.getItem(k);

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

  const idb = { version: 1, stores: {} };
  const db = await openDb("cantonNetwork");
  idb.version = db.version;
  for (const name of Array.from(db.objectStoreNames)) {
    idb.stores[name] = await getAll(db.transaction(name, "readonly").objectStore(name));
  }
  db.close();

  return {
    partyId: localStorageData.partyId,
    localStorage: localStorageData,
    indexedDB: { cantonNetwork: idb },
  };
}

$("grab").addEventListener("click", async () => {
  status("reading tab…");
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.includes("kairo.ag")) {
    status("Open a kairo.ag tab first.", "err");
    return;
  }
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: readSession,
    });
    if (!result?.localStorage?.authToken) {
      status("No session found — are you logged in?", "err");
      return;
    }
    bundle = result;
    $("party").textContent = "party: " + (result.partyId || "").slice(0, 18) + "…";
    for (const id of ["save", "copy", "download", "copyacc"]) $(id).disabled = false;
    status("✅ session grabbed. Set name + password, then Save.", "ok");
  } catch (e) {
    status("grab failed: " + e.message, "err");
  }
});

$("copy").addEventListener("click", async () => {
  await navigator.clipboard.writeText(JSON.stringify(bundle));
  status("✅ bundle copied to clipboard", "ok");
});

// Copy a full {name,password,bundle} entry ready to paste into accounts.json.
$("copyacc").addEventListener("click", async () => {
  const name = $("name").value.trim();
  const password = $("password").value;
  if (!name || !password) {
    status("set name + password first", "err");
    return;
  }
  await navigator.clipboard.writeText(JSON.stringify({ name, password, bundle }, null, 2));
  status("✅ account JSON copied. Paste it into accounts.json array on your VPS.", "ok");
  $("password").value = "";
});

$("download").addEventListener("click", () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `kairo-session-${(bundle.partyId || "acc").replace(/[^a-z0-9]/gi, "").slice(0, 16)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  status("✅ downloaded", "ok");
});

$("save").addEventListener("click", async () => {
  const name = $("name").value.trim();
  const password = $("password").value;
  const endpoint = $("endpoint").value.trim().replace(/\/$/, "");
  if (!name || !password) {
    status("name + password required", "err");
    return;
  }
  status("sending to bot…");
  try {
    const res = await fetch(endpoint + "/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, password, bundle }),
    });
    const body = await res.json();
    if (!res.ok || !body.ok) {
      status("bot error: " + (body.error || res.status), "err");
      return;
    }
    status(`✅ saved account "${name}". Run the bot in your terminal.`, "ok");
    $("password").value = "";
  } catch (e) {
    status("cannot reach bot receiver. Run: npm run receiver\n" + e.message, "err");
  }
});
