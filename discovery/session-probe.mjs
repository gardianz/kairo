// Inspect session token lifetime + API auth scheme. No secret values printed.
import { chromium } from "playwright";

const browser = await chromium.connectOverCDP("http://localhost:9222");
const ctx = browser.contexts()[0];
const page = ctx.pages().find((p) => p.url().includes("kairo.ag")) ?? ctx.pages()[0];

// Decode JWT exp/iat only (no signature, no payload dump beyond timestamps + keys)
const info = await page.evaluate(() => {
  function decodeExp(tok) {
    try {
      const [, p] = tok.split(".");
      const json = JSON.parse(atob(p.replace(/-/g, "+").replace(/_/g, "/")));
      return { exp: json.exp, iat: json.iat, keys: Object.keys(json) };
    } catch {
      return { error: "not a JWT" };
    }
  }
  const at = localStorage.getItem("authToken") || "";
  const rt = localStorage.getItem("refreshToken") || "";
  let user = {};
  try {
    user = JSON.parse(localStorage.getItem("user") || "{}");
  } catch {}
  return {
    authToken: decodeExp(at),
    refreshToken: decodeExp(rt),
    userKeys: Object.keys(user),
  };
});

const fmt = (e) => (e ? new Date(e * 1000).toISOString() : "n/a");
console.log("authToken: keys=", JSON.stringify(info.authToken.keys || info.authToken));
console.log("  iat=", fmt(info.authToken.iat), " exp=", fmt(info.authToken.exp));
console.log("refreshToken: keys=", JSON.stringify(info.refreshToken.keys || info.refreshToken));
console.log("  iat=", fmt(info.refreshToken.iat), " exp=", fmt(info.refreshToken.exp));
console.log("user object keys:", JSON.stringify(info.userKeys));

// Capture Authorization scheme on next api.kairo.ag request (header name + scheme only)
const reqInfo = await new Promise((resolve) => {
  const to = setTimeout(() => resolve("(no api request seen in 12s)"), 12000);
  ctx.on("request", (req) => {
    if (req.url().includes("api.kairo.ag")) {
      const h = req.headers();
      const auth = h["authorization"] || "";
      clearTimeout(to);
      resolve({
        url: req.url().split("?")[0],
        method: req.method(),
        authScheme: auth.split(" ")[0] || "(none)",
        hasAuthHeader: Boolean(auth),
        headerNames: Object.keys(h),
      });
    }
  });
  // trigger a refetch
  page.reload().catch(() => {});
});
console.log("\nSample api.kairo.ag request:", JSON.stringify(reqInfo, null, 1));

await browser.close();
