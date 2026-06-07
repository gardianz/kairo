import { chromium } from "playwright";

const browser = await chromium.connectOverCDP("http://localhost:9222");
const ctx = browser.contexts()[0];
const page = ctx.pages().find((p) => p.url().includes("kairo.ag")) ?? ctx.pages()[0];

const seen = new Set();
ctx.on("response", async (res) => {
  const u = res.url();
  if (!u.includes("api.kairo.ag")) return;
  const path = u.split("?")[0].replace("https://api.kairo.ag", "");
  let extra = "";
  try {
    if (/quote|liquid|pool|max|route|swap/i.test(u)) extra = (await res.text()).slice(0, 160);
  } catch {}
  seen.add(`${res.request().method()} ${res.status()} ${path}  ${extra}`);
});

await page.goto("https://kairo.ag/dashboard", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);

async function clickText(t, nth = 0) {
  await page.getByText(t, { exact: false }).nth(nth).click({ timeout: 5000 }).catch((e) => console.log("click", t, "err", e.message.slice(0, 40)));
  await page.waitForTimeout(1200);
}

// open From picker, choose Canton Coin
await page.getByText("Select token", { exact: true }).nth(0).click({ timeout: 5000 }).catch(() => {});
await page.waitForTimeout(1000);
await clickText("Canton Coin");
// open To picker, choose USDCx
await page.getByText("Select token", { exact: true }).first().click({ timeout: 5000 }).catch(() => {});
await page.waitForTimeout(1000);
await clickText("USDCx");
// type amount
await page.getByPlaceholder("Input amount").fill("11").catch((e) => console.log("fill err", e.message.slice(0, 40)));
await page.waitForTimeout(3000);

// dump visible text + button states
const ui = await page.evaluate(() => {
  const txt = document.body.innerText;
  const interesting = txt
    .split("\n")
    .filter((l) => /liquid|insuffic|max|receive|balance|swap|pool|unavailable|error|0\.0/i.test(l))
    .slice(0, 30);
  const btns = Array.from(document.querySelectorAll("button"))
    .filter((b) => b.getBoundingClientRect().width > 200)
    .map((b) => ({ text: (b.innerText || "").trim().slice(0, 40), disabled: b.disabled }));
  return { interesting, btns };
});
console.log("=== UI lines ===");
ui.interesting.forEach((l) => console.log(" ", l));
console.log("=== wide buttons ===", JSON.stringify(ui.btns));
console.log("=== api.kairo.ag calls during compose ===");
[...seen].sort().forEach((s) => console.log(" ", s));

await browser.close();
