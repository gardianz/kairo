// Dump the Swap card DOM in detail to derive selectors for driving a swap.
import { chromium } from "playwright";

const browser = await chromium.connectOverCDP("http://localhost:9222");
const ctx = browser.contexts()[0];
const page = ctx.pages().find((p) => p.url().includes("kairo.ag")) ?? ctx.pages()[0];
await page.goto("https://kairo.ag/dashboard", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);

const dump = await page.evaluate(() => {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const desc = (el) => ({
    tag: el.tagName.toLowerCase(),
    role: el.getAttribute("role") || "",
    type: el.getAttribute("type") || "",
    testid: el.getAttribute("data-testid") || el.getAttribute("data-test") || "",
    cls: (el.className || "").toString().slice(0, 40),
    ph: el.getAttribute("placeholder") || "",
    text: (el.innerText || el.value || "").trim().slice(0, 40),
  });
  const els = Array.from(
    document.querySelectorAll("button, input, [role=button], [role=combobox], select"),
  ).filter(visible);
  return els.map(desc);
});

console.log(JSON.stringify(dump, null, 1));
await browser.close();
