// Interactive wizard to add an account. Run: npm run add-account
//
// Flow:
//   1. Open kairo.ag (logged in) -> DevTools Console -> paste tools/export-session.js
//      It copies the session bundle to your clipboard.
//   2. Run this wizard, paste the bundle, type the wallet password.
//   It writes sessions/<name>.json + secret/<name>.pw, verifies the password,
//   and registers the account in config.yaml.
import { createInterface } from "node:readline";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import yaml from "js-yaml";
import { decryptSecret, verifySecret } from "../src/crypto.ts";
import type { SessionBundle } from "../src/types.ts";

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q: string): Promise<string> =>
  new Promise((res) => rl.question(q, (a) => res(a.trim())));

// Read a line without echoing it (for the password).
function askHidden(q: string): Promise<string> {
  return new Promise((res) => {
    process.stdout.write(q);
    const stdin = process.stdin;
    stdin.setRawMode?.(true);
    stdin.resume();
    let buf = "";
    const collect = (chunk: Buffer) => {
      for (const code of chunk) {
        if (code === 10 || code === 13) {
          stdin.removeListener("data", collect);
          stdin.setRawMode?.(false);
          stdin.pause();
          process.stdout.write("\n");
          res(buf);
          return;
        } else if (code === 3) {
          process.exit(1); // Ctrl-C
        } else if (code === 127 || code === 8) {
          buf = buf.slice(0, -1); // backspace
        } else {
          buf += String.fromCharCode(code);
        }
      }
    };
    stdin.on("data", collect);
  });
}

async function main() {
  console.log("\n=== Kairo add-account wizard ===\n");
  const name = (await ask("Account name (e.g. main, acc2): ")).replace(/[^a-zA-Z0-9_-]/g, "");
  if (!name) throw new Error("name required");

  console.log("\nPaste the session bundle (copied by export-session.js), then Enter:");
  const raw = await ask("> ");
  let bundle: SessionBundle;
  try {
    bundle = JSON.parse(raw);
  } catch {
    throw new Error("that wasn't valid JSON — re-copy from the browser console");
  }
  if (!bundle?.localStorage?.authToken || !bundle?.indexedDB?.cantonNetwork) {
    throw new Error("bundle missing fields — run export-session.js while logged in");
  }

  const password = await askHidden("Wallet password (hidden): ");

  // Verify before saving.
  const cantonKey = bundle.indexedDB.cantonNetwork.stores.storeCanton?.[0]?.cantonKey;
  if (!cantonKey) throw new Error("bundle has no cantonKey");
  const secret = decryptSecret(cantonKey, password); // throws on wrong password
  if (!verifySecret(secret, bundle.localStorage.publicKey)) {
    throw new Error("password/bundle mismatch (derived pubkey != stored)");
  }
  console.log("✅ password verified against wallet key");

  // Write files.
  mkdirSync("sessions", { recursive: true });
  mkdirSync("secret", { recursive: true });
  const bundlePath = `sessions/${name}.json`;
  const pwPath = `secret/${name}.pw`;
  writeFileSync(bundlePath, JSON.stringify(bundle, null, 2));
  writeFileSync(pwPath, password);

  // Register in config.yaml (create from example if missing).
  const cfgPath = "config.yaml";
  const src = existsSync(cfgPath) ? cfgPath : "config.example.yaml";
  const cfg = (yaml.load(readFileSync(src, "utf8")) ?? {}) as any;
  cfg.accounts = (cfg.accounts ?? []).filter((a: any) => a.name !== name);
  cfg.accounts.push({ name, bundle: bundlePath, passwordFile: pwPath });
  writeFileSync(cfgPath, yaml.dump(cfg, { lineWidth: 100 }));

  console.log(`\n✅ Account "${name}" added.`);
  console.log(`   bundle:   ${bundlePath}`);
  console.log(`   password: ${pwPath}`);
  console.log(`   config:   ${cfgPath} (accounts: ${cfg.accounts.length})`);
  console.log(`\nRun it:  npx tsx src/main.ts --once --account ${name}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n❌", e instanceof Error ? e.message : e, "\n");
    process.exit(1);
  });
