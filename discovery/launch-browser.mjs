// Launch headed persistent Chromium with CDP debugging for live inspection.
// Logs JSON network responses to discovery/ for selector/endpoint discovery.
import { chromium } from "playwright";
import { mkdirSync, appendFileSync, writeFileSync } from "node:fs";

const ROOT = "/home/gosjavar/bot-erdrop/kairo";
const USER_DATA = `${ROOT}/user-data`;
const OUT = `${ROOT}/discovery`;
const NETLOG = `${OUT}/network.jsonl`;
const BODIES = `${OUT}/bodies`;

mkdirSync(BODIES, { recursive: true });
writeFileSync(NETLOG, "");

const ctx = await chromium.launchPersistentContext(USER_DATA, {
  headless: false,
  executablePath: process.env.CHROME_EXEC || undefined,
  viewport: null,
  args: ["--remote-debugging-port=9222"],
});

const page = ctx.pages()[0] ?? (await ctx.newPage());

let n = 0;
ctx.on("response", async (res) => {
  const url = res.url();
  const ct = res.headers()["content-type"] ?? "";
  if (!ct.includes("application/json")) return;
  let bodyFile = "";
  try {
    const body = await res.text();
    if (/api|graphql|trade|quest|activity|balance|token|wallet|portfolio|swap/i.test(url)) {
      n += 1;
      bodyFile = `${BODIES}/resp-${n}.json`;
      writeFileSync(bodyFile, body);
    }
  } catch {
    /* ignore */
  }
  appendFileSync(
    NETLOG,
    JSON.stringify({
      t: new Date().toISOString(),
      method: res.request().method(),
      status: res.status(),
      url,
      bodyFile,
    }) + "\n",
  );
});

await page.goto("https://kairo.ag/dashboard", { waitUntil: "domcontentloaded" }).catch(() => {});

console.log("BROWSER_READY cdp=http://localhost:9222");
// Keep alive until killed.
await new Promise(() => {});
