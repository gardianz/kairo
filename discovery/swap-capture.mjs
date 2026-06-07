// Drive ONE swap (CC->CBTC, 10) via UI while logging every network call,
// especially POSTs, to learn the swap submission mechanism.
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";

const OUT = "/home/gosjavar/bot-erdrop/kairo/discovery";
mkdirSync(`${OUT}/swap`, { recursive: true });

const browser = await chromium.connectOverCDP("http://localhost:9222");
const ctx = browser.contexts()[0];
const page = ctx.pages().find((p) => p.url().includes("kairo.ag")) ?? ctx.pages()[0];

const log = [];
ctx.on("request", (req) => {
  const u = req.url();
  if (/google|gstatic|youtube|fonts|\.png|\.svg|\.css|\.woff/i.test(u)) return;
  let postData = null;
  try {
    postData = req.postData();
  } catch {}
  log.push({ phase: "req", method: req.method(), url: u, postData: postData?.slice(0, 2000) });
});
ctx.on("response", async (res) => {
  const u = res.url();
  if (/google|gstatic|youtube|fonts|\.png|\.svg|\.css|\.woff/i.test(u)) return;
  if (res.request().method() === "GET" && !/swap|trade|quest|activity/i.test(u)) return;
  let body = null;
  try {
    body = (await res.text()).slice(0, 2000);
  } catch {}
  log.push({ phase: "res", status: res.status(), method: res.request().method(), url: u, body });
});

function step(msg) {
  console.log("STEP:", msg);
}

try {
  await page.goto("https://kairo.ag/dashboard", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);

  step("open From picker");
  await page.getByText("Select token", { exact: true }).nth(0).click();
  await page.waitForTimeout(1500);

  // dump token options in the opened list
  const fromOpts = await page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    return [
      ...new Set(
        Array.from(document.querySelectorAll("button,li,[role=option],div"))
          .filter(vis)
          .map((e) => (e.innerText || "").trim())
          .filter((t) => /^(CC|CBTC|USDCx|stBTC|Canton Coin|Amulet)\b/i.test(t) && t.length < 30),
      ),
    ];
  });
  console.log("FROM OPTIONS:", JSON.stringify(fromOpts));

  step("select Canton Coin (CC) as From");
  await page
    .getByText(/^Canton Coin$|^CC$/, { exact: false })
    .first()
    .click()
    .catch((e) => console.log("from-select err", e.message));
  await page.waitForTimeout(1200);

  step("open To picker");
  await page.getByText("Select token", { exact: true }).first().click().catch(() => {});
  await page.waitForTimeout(1500);

  step("select CBTC as To");
  await page
    .getByText(/^CBTC$/, { exact: false })
    .first()
    .click()
    .catch((e) => console.log("to-select err", e.message));
  await page.waitForTimeout(1200);

  step("fill amount 10");
  await page.getByPlaceholder("Input amount").fill("10");
  await page.waitForTimeout(2000);

  // Snapshot CTA button label/state
  const cta = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button")).filter((b) => {
      const r = b.getBoundingClientRect();
      return r.width > 300;
    });
    return btns.map((b) => ({ text: (b.innerText || "").trim(), disabled: b.disabled }));
  });
  console.log("CTA buttons:", JSON.stringify(cta));

  step("click main CTA (Review/Swap)");
  // wide bottom button that's now enabled
  const mainBtn = page.locator("button").filter({ hasText: /swap|review|confirm/i }).last();
  await mainBtn.click({ timeout: 8000 }).catch((e) => console.log("cta err", e.message));
  await page.waitForTimeout(2500);

  // capture any confirm/sign dialog buttons
  const dlg = await page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    return Array.from(document.querySelectorAll("button"))
      .filter(vis)
      .map((b) => (b.innerText || "").trim())
      .filter(Boolean);
  });
  console.log("DIALOG buttons:", JSON.stringify(dlg));

  step("click Sign/Confirm");
  await page
    .locator("button")
    .filter({ hasText: /sign|confirm|approve/i })
    .last()
    .click({ timeout: 8000 })
    .catch((e) => console.log("sign err", e.message));

  step("wait for settlement");
  await page.waitForTimeout(12000);

  const finalText = await page.evaluate(() => document.body.innerText.slice(0, 600));
  console.log("FINAL PAGE TEXT:\n", finalText);
} catch (e) {
  console.log("FLOW ERROR:", e.message);
} finally {
  writeFileSync(`${OUT}/swap/network.json`, JSON.stringify(log, null, 1));
  console.log(`\nLogged ${log.length} network events -> discovery/swap/network.json`);
  await browser.close();
}
