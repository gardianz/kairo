// Resolve accounts from either an inline accounts.json (best for VPS) or the
// file-based entries in config.yaml. Returns ready-to-run account descriptors,
// each with a persist callback so refreshed tokens are written back.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import type { Config } from "./config.ts";
import type { SessionBundle } from "./types.ts";
import type { PersistFn } from "./session.ts";

export interface ResolvedAccount {
  name: string;
  bundle: SessionBundle;
  password: string;
  persist: PersistFn;
}

// accounts.json format: [ { "name": "...", "password": "...", "bundle": { ... } } ]
interface InlineAccount {
  name: string;
  password: string;
  bundle: SessionBundle;
}

function loadInline(path: string): ResolvedAccount[] {
  const list = JSON.parse(readFileSync(path, "utf8")) as InlineAccount[];
  if (!Array.isArray(list)) throw new Error(`${path} must be a JSON array`);
  return list.map((a) => ({
    name: a.name,
    bundle: a.bundle,
    password: a.password,
    persist: (updated: SessionBundle) => {
      const current = JSON.parse(readFileSync(path, "utf8")) as InlineAccount[];
      const i = current.findIndex((x) => x.name === a.name);
      if (i >= 0) {
        current[i].bundle = updated;
        writeFileSync(path, JSON.stringify(current, null, 2));
      }
    },
  }));
}

function loadFileBased(acc: { name: string; bundle: string; passwordFile: string }): ResolvedAccount {
  const bundle = JSON.parse(readFileSync(acc.bundle, "utf8")) as SessionBundle;
  const password = readFileSync(acc.passwordFile, "utf8").trim();
  return {
    name: acc.name,
    bundle,
    password,
    persist: (updated: SessionBundle) => writeFileSync(acc.bundle, JSON.stringify(updated, null, 2)),
  };
}

export function resolveAccounts(cfg: Config): ResolvedAccount[] {
  const out: ResolvedAccount[] = [];
  if (cfg.accountsFile && existsSync(cfg.accountsFile)) {
    out.push(...loadInline(cfg.accountsFile));
  }
  for (const acc of cfg.accounts ?? []) {
    out.push(loadFileBased(acc));
  }
  if (out.length === 0) {
    throw new Error(
      "no accounts found — set accountsFile (accounts.json) or accounts[] in config.yaml",
    );
  }
  return out;
}
