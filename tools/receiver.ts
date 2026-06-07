// Local receiver for the Kairo Session Exporter extension.
// Run: npm run receiver   (listens on 127.0.0.1:8787)
// Accepts POST /session { name, password, bundle } -> verifies, writes
// sessions/<name>.json + secret/<name>.pw, registers in config.yaml.
import { createServer } from "node:http";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import yaml from "js-yaml";
import { decryptSecret, verifySecret } from "../src/crypto.ts";
import type { SessionBundle } from "../src/types.ts";

const PORT = Number(process.env.RECEIVER_PORT ?? 8787);

function saveAccount(name: string, password: string, bundle: SessionBundle): void {
  name = name.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!name) throw new Error("invalid name");
  if (!bundle?.localStorage?.authToken || !bundle?.indexedDB?.cantonNetwork) {
    throw new Error("bundle missing fields");
  }
  const cantonKey = bundle.indexedDB.cantonNetwork.stores.storeCanton?.[0]?.cantonKey;
  if (!cantonKey) throw new Error("bundle has no cantonKey");
  const secret = decryptSecret(cantonKey, password); // throws on wrong password
  if (!verifySecret(secret, bundle.localStorage.publicKey)) {
    throw new Error("password/bundle mismatch");
  }

  mkdirSync("sessions", { recursive: true });
  mkdirSync("secret", { recursive: true });
  const bundlePath = `sessions/${name}.json`;
  const pwPath = `secret/${name}.pw`;
  writeFileSync(bundlePath, JSON.stringify(bundle, null, 2));
  writeFileSync(pwPath, password);

  const cfgPath = "config.yaml";
  const src = existsSync(cfgPath) ? cfgPath : "config.example.yaml";
  const cfg = (yaml.load(readFileSync(src, "utf8")) ?? {}) as any;
  cfg.accounts = (cfg.accounts ?? []).filter((a: any) => a.name !== name);
  cfg.accounts.push({ name, bundle: bundlePath, passwordFile: pwPath });
  writeFileSync(cfgPath, yaml.dump(cfg, { lineWidth: 100 }));
}

const server = createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method !== "POST" || req.url !== "/session") {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "not found" }));
    return;
  }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    try {
      const { name, password, bundle } = JSON.parse(body);
      saveAccount(name, password, bundle);
      console.log(`✅ saved account "${name}"`);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, name }));
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      console.error("❌", error);
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error }));
    }
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Kairo receiver on http://127.0.0.1:${PORT} — load the extension, grab + save.`);
  console.log("Ctrl+C to stop once accounts are added.");
});
