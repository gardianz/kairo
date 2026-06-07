// Probe auth/session storage mechanism + trigger balance/quest APIs.
// Prints KEY NAMES and endpoint URLs only — never secret values.
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";

const OUT = "/home/gosjavar/bot-erdrop/kairo/discovery";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.connectOverCDP("http://localhost:9222");
const ctx = browser.contexts()[0];
const page = ctx.pages().find((p) => p.url().includes("kairo.ag")) ?? ctx.pages()[0];

// Cookies (names + domains only)
const cookies = await ctx.cookies();
console.log("COOKIES (name | domain | httpOnly | len):");
for (const c of cookies) {
  console.log(` - ${c.name} | ${c.domain} | httpOnly=${c.httpOnly} | len=${String(c.value).length}`);
}

// localStorage / sessionStorage KEY NAMES + value length (no values)
const storage = await page.evaluate(() => {
  const dump = (s) =>
    Object.keys(s).map((k) => ({ key: k, len: String(s.getItem(k) ?? "").length }));
  return { local: dump(localStorage), session: dump(sessionStorage) };
});
console.log("\nLOCALSTORAGE (key | len):");
storage.local.forEach((x) => console.log(` - ${x.key} | ${x.len}`));
console.log("\nSESSIONSTORAGE (key | len):");
storage.session.forEach((x) => console.log(` - ${x.key} | ${x.len}`));

// IndexedDB database names
const idb = await page.evaluate(async () => {
  if (!indexedDB.databases) return ["(databases() unsupported)"];
  const dbs = await indexedDB.databases();
  return dbs.map((d) => d.name);
});
console.log("\nINDEXEDDB databases:", JSON.stringify(idb));

// Capture API endpoints while visiting Balances + Activity
const seen = new Set();
ctx.on("response", (res) => {
  const u = res.url();
  if (/api|graphql|trade|quest|activity|balance|token|portfolio|swap|me\b|auth/i.test(u)) {
    seen.add(`${res.request().method()} ${res.status()} ${u.split("?")[0]}`);
  }
});

async function clickByText(t) {
  const el = page.getByText(t, { exact: false }).first();
  await el.click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(2500);
}
await clickByText("Balances");
await clickByText("Activity");
await page.waitForTimeout(2000);

console.log("\nAPI ENDPOINTS (method status path):");
[...seen].sort().forEach((e) => console.log(" - " + e));

writeFileSync(`${OUT}/endpoints.txt`, [...seen].sort().join("\n"));
await browser.close();
