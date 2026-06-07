// Use the live authenticated page to call read APIs + capture all api.kairo.ag
// traffic while navigating tabs. Dumps response bodies (user's own balance/quest
// data — not secrets) to discovery/bodies/. Token never printed.
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";

const OUT = "/home/gosjavar/bot-erdrop/kairo/discovery";
const BODIES = `${OUT}/bodies`;
mkdirSync(BODIES, { recursive: true });

const browser = await chromium.connectOverCDP("http://localhost:9222");
const ctx = browser.contexts()[0];
const page = ctx.pages().find((p) => p.url().includes("kairo.ag")) ?? ctx.pages()[0];

let n = 0;
const seen = new Set();
ctx.on("response", async (res) => {
  const u = res.url();
  if (!u.includes("api.kairo.ag")) return;
  const path = u.split("?")[0].replace("https://api.kairo.ag/", "");
  const tag = `${res.request().method()} ${path}`;
  seen.add(`${tag} -> ${res.status()}`);
  try {
    const body = await res.text();
    n += 1;
    const safe = path.replace(/\//g, "_");
    writeFileSync(`${BODIES}/${n}_${safe}.json`, body);
  } catch {}
});

// Navigate all tabs to trigger every read endpoint
async function clickTab(t) {
  await page.getByText(t, { exact: false }).first().click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(2500);
}
await page.goto("https://kairo.ag/dashboard", { waitUntil: "domcontentloaded" }).catch(() => {});
await page.waitForTimeout(2000);
for (const t of ["Balances", "Activity", "Offers", "Transfer", "Swap"]) await clickTab(t);

// Direct fetch of known read endpoints from inside the page (uses its own auth)
const direct = await page.evaluate(async () => {
  const at = localStorage.getItem("authToken");
  const base = "https://api.kairo.ag";
  const paths = [
    "/trader-analytics/daily-swap-activities",
    "/trader-analytics/swaps-summary",
    "/swap/token-prices",
    "/user/me",
  ];
  const out = {};
  for (const p of paths) {
    try {
      const r = await fetch(base + p, { headers: { Authorization: `Bearer ${at}` } });
      out[p] = { status: r.status, body: await r.text() };
    } catch (e) {
      out[p] = { error: String(e) };
    }
  }
  return out;
});

for (const [p, v] of Object.entries(direct)) {
  const safe = p.replace(/\//g, "_");
  writeFileSync(`${BODIES}/direct${safe}.json`, JSON.stringify(v, null, 1));
}

console.log("=== api.kairo.ag endpoints seen ===");
[...seen].sort().forEach((e) => console.log(" - " + e));
console.log("\n=== direct fetch statuses ===");
for (const [p, v] of Object.entries(direct)) console.log(` - ${p}: ${v.status ?? v.error}`);
console.log("\nbodies saved to discovery/bodies/");

await browser.close();
