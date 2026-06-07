// Connect to running Chromium via CDP and dump interactive elements of current page.
import { chromium } from "playwright";

const browser = await chromium.connectOverCDP("http://localhost:9222");
const ctx = browser.contexts()[0];
const pages = ctx.pages();
// Pick the kairo page (not the google iframe popup)
const page =
  pages.find((p) => p.url().includes("kairo.ag")) ?? pages[0];

console.log("URL:", page.url());

const data = await page.evaluate(() => {
  const txt = (el) => (el.innerText || el.value || el.getAttribute("aria-label") || "").trim().slice(0, 60);
  const grab = (sel) =>
    Array.from(document.querySelectorAll(sel)).map((el) => ({
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute("type") || "",
      testid: el.getAttribute("data-testid") || "",
      placeholder: el.getAttribute("placeholder") || "",
      href: el.getAttribute("href") || "",
      text: txt(el),
    }));
  return {
    buttons: grab("button"),
    links: grab("a"),
    inputs: grab("input"),
    bodyText: document.body.innerText.slice(0, 1500),
  };
});

console.log("BUTTONS:", JSON.stringify(data.buttons, null, 1));
console.log("LINKS:", JSON.stringify(data.links, null, 1));
console.log("INPUTS:", JSON.stringify(data.inputs, null, 1));
console.log("BODYTEXT:\n", data.bodyText);

await browser.close();
