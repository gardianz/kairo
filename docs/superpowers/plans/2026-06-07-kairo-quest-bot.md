# Kairo Quest Bot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bot Node/TypeScript yang otomatis melakukan swap di Kairo DEX dan menyelesaikan quest harian, dijadwalkan tiap hari, dengan pengaman dana dan pelaporan Telegram.

**Architecture:** Approach C (hybrid) — Playwright menggerakkan UI dashboard untuk swap + sign (key Canton ada di klien), sementara progres quest & saldo dibaca dari response jaringan backend dashboard (network interception) dengan fallback DOM. Logika quest & safety berupa fungsi murni yang di-TDD; modul browser dibangun di atas peta selektor hasil discovery run.

**Tech Stack:** Node 20+, TypeScript, Playwright, zod (validasi config), pino (log), node-cron (jadwal), vitest (test), js-yaml (config), node-telegram-bot-api / fetch (Telegram).

---

## File Structure

```
kairo/
  src/
    config.ts        # load + validasi config.yaml (zod)
    types.ts         # WalletState, QuestDef, Action, SwapResult, dll
    browser.ts       # persistent context + ensureSession
    selectors.ts     # peta selektor + URL endpoint (diisi di Task 6 discovery)
    state-reader.ts  # network sniff + DOM fallback → WalletState
    swap-executor.ts # eksekusi 1 swap via UI
    quest-engine.ts  # planner murni: (defs, state, cfg) → Action[]
    safety.ts        # guard cap/floor/slippage/max-swaps
    scheduler.ts     # node-cron daily trigger
    reporter.ts      # pino + Telegram
    main.ts          # orkestrasi run
    discover.ts      # script discovery run (dijalankan manual sekali)
  tests/
    quest-engine.test.ts
    safety.test.ts
    config.test.ts
    state-reader.test.ts
    fixtures/
  config.example.yaml
  .gitignore
  package.json
  tsconfig.json
  vitest.config.ts
  README.md
```

**Catatan ketergantungan:** Task 6 (discovery run) menghasilkan `src/selectors.ts` berisi selektor & URL endpoint asli. Task 7–9 (browser, state-reader, swap-executor) bergantung pada file itu. Task 1–5 (types, config, quest-engine, safety, reporter) murni/independen dan bisa dikerjakan lebih dulu.

---

## Task 0: Scaffold proyek

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`

- [ ] **Step 1: Buat package.json**

```json
{
  "name": "kairo-quest-bot",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest",
    "discover": "tsx src/discover.ts",
    "start": "tsx src/main.ts",
    "run:once": "tsx src/main.ts --once"
  },
  "dependencies": {
    "playwright": "^1.48.0",
    "zod": "^3.23.8",
    "pino": "^9.4.0",
    "pino-pretty": "^11.2.2",
    "node-cron": "^3.0.3",
    "js-yaml": "^4.1.0"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "tsx": "^4.19.0",
    "vitest": "^2.1.0",
    "@types/node": "^22.0.0",
    "@types/js-yaml": "^4.0.9",
    "@types/node-cron": "^3.0.11"
  }
}
```

- [ ] **Step 2: Buat tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "resolveJsonModule": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

- [ ] **Step 3: Buat vitest.config.ts**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Buat .gitignore**

```
node_modules/
dist/
config.yaml
.env
user-data/
logs/
*.log
```

- [ ] **Step 5: Install + verifikasi**

Run: `npm install && npx tsc --noEmit`
Expected: instalasi sukses, tidak ada error TS (belum ada source file → `tsc --noEmit` lewat tanpa error).

- [ ] **Step 6: Init git + commit**

```bash
git init
git add package.json tsconfig.json vitest.config.ts .gitignore
git commit -m "chore: scaffold kairo quest bot project"
```

---

## Task 1: Tipe domain (`types.ts`)

**Files:**
- Create: `src/types.ts`

- [ ] **Step 1: Tulis types.ts**

```typescript
// Token simbol yang dipakai Kairo
export type Token = "CC" | "CBTC" | "USDCx";

// Saldo per token (dalam unit token, number desimal)
export type Balances = Record<Token, number>;

// Satu definisi quest harian
export type QuestDef =
  | {
      id: string;
      type: "swap-count"; // N swap dengan nilai >= minValueCC
      count: number;
      minValueCC: number;
    }
  | {
      id: string;
      type: "swap-pair"; // 1 swap pada pasangan tertentu (arah bebas)
      pair: [Token, Token];
    };

// Progres quest yang dibaca dari dashboard
export interface QuestProgress {
  id: string;
  completed: boolean;
  current: number; // mis. jumlah swap valid sejauh ini
  target: number;
}

// Snapshot keadaan wallet + quest
export interface WalletState {
  balances: Balances;
  quests: QuestProgress[];
  sessionAlive: boolean;
}

// Satu aksi swap yang direncanakan engine
export interface Action {
  questId: string;
  from: Token;
  to: Token;
  amountCC: number; // nilai swap dalam CC-equivalent (untuk cap/threshold)
  amountToken: number; // jumlah token `from` yang di-swap
  roundTripBack: boolean; // apakah ada swap balik setelah ini
}

// Hasil eksekusi 1 swap
export interface SwapResult {
  ok: boolean;
  from: Token;
  to: Token;
  amountToken: number;
  error?: string;
}

// Ringkasan satu run untuk reporter
export interface RunSummary {
  startedAt: string;
  finishedAt: string;
  swapsAttempted: number;
  swapsSucceeded: number;
  questsCompleted: string[];
  questsRemaining: string[];
  spentCC: number;
  aborted?: string; // alasan abort bila ada
  errors: string[];
}
```

- [ ] **Step 2: Verifikasi kompilasi**

Run: `npx tsc --noEmit`
Expected: tidak ada error.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add domain types"
```

---

## Task 2: Config loader (`config.ts`)

**Files:**
- Create: `src/config.ts`, `config.example.yaml`
- Test: `tests/config.test.ts`

- [ ] **Step 1: Tulis test gagal**

```typescript
// tests/config.test.ts
import { describe, it, expect } from "vitest";
import { parseConfig } from "../src/config.js";

const valid = {
  swapAmountCC: 10,
  slippageTolerancePct: 1.0,
  roundTrip: true,
  dailySpendCapCC: 100,
  minBalanceFloorCC: 50,
  maxSwapsPerRun: 12,
  scheduleCron: "0 9 * * *",
  jitterMinutes: 15,
  headless: false,
  userDataDir: "./user-data",
  baseUrl: "https://kairo.ag/dashboard",
  quests: [
    { id: "five-swaps", type: "swap-count", count: 5, minValueCC: 10 },
    { id: "cc-cbtc", type: "swap-pair", pair: ["CC", "CBTC"] },
    { id: "cc-usdcx", type: "swap-pair", pair: ["CC", "USDCx"] },
  ],
  telegram: { enabled: true, botToken: "x", chatId: "y" },
};

describe("parseConfig", () => {
  it("menerima config valid", () => {
    const cfg = parseConfig(valid);
    expect(cfg.swapAmountCC).toBe(10);
    expect(cfg.quests).toHaveLength(3);
  });

  it("menolak slippage negatif", () => {
    expect(() => parseConfig({ ...valid, slippageTolerancePct: -1 })).toThrow();
  });

  it("menolak quest tanpa id", () => {
    expect(() =>
      parseConfig({ ...valid, quests: [{ type: "swap-pair", pair: ["CC", "CBTC"] }] }),
    ).toThrow();
  });

  it("Telegram boleh disabled tanpa token", () => {
    const cfg = parseConfig({ ...valid, telegram: { enabled: false } });
    expect(cfg.telegram.enabled).toBe(false);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `npx vitest run tests/config.test.ts`
Expected: FAIL — `parseConfig` belum ada.

- [ ] **Step 3: Implementasi config.ts**

```typescript
// src/config.ts
import { readFileSync } from "node:fs";
import yaml from "js-yaml";
import { z } from "zod";

const tokenSchema = z.enum(["CC", "CBTC", "USDCx"]);

const questSchema = z.discriminatedUnion("type", [
  z.object({
    id: z.string().min(1),
    type: z.literal("swap-count"),
    count: z.number().int().positive(),
    minValueCC: z.number().positive(),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("swap-pair"),
    pair: z.tuple([tokenSchema, tokenSchema]),
  }),
]);

const telegramSchema = z.discriminatedUnion("enabled", [
  z.object({ enabled: z.literal(false) }),
  z.object({
    enabled: z.literal(true),
    botToken: z.string().min(1),
    chatId: z.string().min(1),
  }),
]);

const configSchema = z.object({
  swapAmountCC: z.number().positive(),
  slippageTolerancePct: z.number().min(0),
  roundTrip: z.boolean(),
  dailySpendCapCC: z.number().positive(),
  minBalanceFloorCC: z.number().min(0),
  maxSwapsPerRun: z.number().int().positive(),
  scheduleCron: z.string().min(1),
  jitterMinutes: z.number().int().min(0).default(0),
  headless: z.boolean().default(false),
  userDataDir: z.string().min(1),
  baseUrl: z.string().url(),
  quests: z.array(questSchema).min(1),
  telegram: telegramSchema,
});

export type Config = z.infer<typeof configSchema>;

export function parseConfig(raw: unknown): Config {
  return configSchema.parse(raw);
}

export function loadConfig(path = "config.yaml"): Config {
  const raw = yaml.load(readFileSync(path, "utf8"));
  return parseConfig(raw);
}
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `npx vitest run tests/config.test.ts`
Expected: PASS (4 test).

- [ ] **Step 5: Tulis config.example.yaml**

```yaml
# Salin ke config.yaml dan sesuaikan. config.yaml di-gitignore.
swapAmountCC: 10            # nilai tiap swap (>= threshold quest)
slippageTolerancePct: 1.0   # toleransi slippage maksimum (%)
roundTrip: true             # swap balik agar holding hampir tidak bergerak
dailySpendCapCC: 100        # batas total nilai swap per run (CC-equivalent)
minBalanceFloorCC: 50       # jangan swap kalau saldo CC di bawah ini
maxSwapsPerRun: 12          # batas keras jumlah swap per run
scheduleCron: "0 9 * * *"   # tiap hari 09:00 waktu lokal
jitterMinutes: 15           # acak +0..15 menit agar tidak kaku
headless: false             # run pertama wajib false (unlock manual)
userDataDir: "./user-data"  # profil browser persisten (RAHASIA, di luar git)
baseUrl: "https://kairo.ag/dashboard"
quests:
  - id: five-swaps
    type: swap-count
    count: 5
    minValueCC: 10
  - id: cc-cbtc
    type: swap-pair
    pair: ["CC", "CBTC"]
  - id: cc-usdcx
    type: swap-pair
    pair: ["CC", "USDCx"]
telegram:
  enabled: false
  # botToken: "123:abc"
  # chatId: "123456"
```

- [ ] **Step 6: Commit**

```bash
git add src/config.ts config.example.yaml tests/config.test.ts
git commit -m "feat: config loader with zod validation"
```

---

## Task 3: Quest engine (`quest-engine.ts`) — planner murni

**Files:**
- Create: `src/quest-engine.ts`
- Test: `tests/quest-engine.test.ts`

- [ ] **Step 1: Tulis test gagal**

```typescript
// tests/quest-engine.test.ts
import { describe, it, expect } from "vitest";
import { plan } from "../src/quest-engine.js";
import type { Config } from "../src/config.js";
import type { WalletState } from "../src/types.js";

const cfg = {
  swapAmountCC: 10,
  roundTrip: true,
  quests: [
    { id: "five-swaps", type: "swap-count", count: 5, minValueCC: 10 },
    { id: "cc-cbtc", type: "swap-pair", pair: ["CC", "CBTC"] },
    { id: "cc-usdcx", type: "swap-pair", pair: ["CC", "USDCx"] },
  ],
} as unknown as Config;

function state(quests: WalletState["quests"]): WalletState {
  return {
    balances: { CC: 1000, CBTC: 1, USDCx: 1000 },
    quests,
    sessionAlive: true,
  };
}

describe("plan", () => {
  it("tidak menghasilkan aksi bila semua quest selesai", () => {
    const s = state([
      { id: "five-swaps", completed: true, current: 5, target: 5 },
      { id: "cc-cbtc", completed: true, current: 1, target: 1 },
      { id: "cc-usdcx", completed: true, current: 1, target: 1 },
    ]);
    expect(plan(cfg, s)).toEqual([]);
  });

  it("merencanakan sisa swap untuk quest swap-count", () => {
    const s = state([
      { id: "five-swaps", completed: false, current: 2, target: 5 },
      { id: "cc-cbtc", completed: true, current: 1, target: 1 },
      { id: "cc-usdcx", completed: true, current: 1, target: 1 },
    ]);
    const actions = plan(cfg, s);
    // 3 swap tersisa untuk five-swaps
    expect(actions.filter((a) => a.questId === "five-swaps")).toHaveLength(3);
    expect(actions[0].amountCC).toBe(10);
    expect(actions[0].roundTripBack).toBe(true);
  });

  it("merencanakan swap pasangan yang belum selesai", () => {
    const s = state([
      { id: "five-swaps", completed: true, current: 5, target: 5 },
      { id: "cc-cbtc", completed: false, current: 0, target: 1 },
      { id: "cc-usdcx", completed: true, current: 1, target: 1 },
    ]);
    const actions = plan(cfg, s);
    expect(actions).toHaveLength(1);
    expect(actions[0].questId).toBe("cc-cbtc");
    expect(actions[0].from).toBe("CC");
    expect(actions[0].to).toBe("CBTC");
  });

  it("roundTripBack false saat config.roundTrip false", () => {
    const s = state([
      { id: "five-swaps", completed: false, current: 4, target: 5 },
      { id: "cc-cbtc", completed: true, current: 1, target: 1 },
      { id: "cc-usdcx", completed: true, current: 1, target: 1 },
    ]);
    const noRt = { ...cfg, roundTrip: false } as Config;
    const actions = plan(noRt, s);
    expect(actions[0].roundTripBack).toBe(false);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `npx vitest run tests/quest-engine.test.ts`
Expected: FAIL — `plan` belum ada.

- [ ] **Step 3: Implementasi quest-engine.ts**

```typescript
// src/quest-engine.ts
import type { Config } from "./config.js";
import type { Action, WalletState, QuestProgress } from "./types.js";

function progressOf(state: WalletState, id: string): QuestProgress | undefined {
  return state.quests.find((q) => q.id === id);
}

// Planner murni: hitung aksi swap yang masih perlu dilakukan.
// Aksi untuk swap-count memakai pasangan CC->CBTC sebagai swap "netral"
// default (round-trip balik bila diaktifkan). Pasangan quest memakai pair-nya.
export function plan(cfg: Config, state: WalletState): Action[] {
  const actions: Action[] = [];

  for (const def of cfg.quests) {
    const prog = progressOf(state, def.id);
    if (prog?.completed) continue;

    if (def.type === "swap-count") {
      const done = prog?.current ?? 0;
      const remaining = Math.max(0, def.count - done);
      for (let i = 0; i < remaining; i++) {
        actions.push({
          questId: def.id,
          from: "CC",
          to: "CBTC",
          amountCC: cfg.swapAmountCC,
          amountToken: cfg.swapAmountCC, // from = CC, jadi amountToken == amountCC
          roundTripBack: cfg.roundTrip,
        });
      }
    } else {
      // swap-pair: arahkan dari elemen pertama ke kedua
      const [from, to] = def.pair;
      actions.push({
        questId: def.id,
        from,
        to,
        amountCC: cfg.swapAmountCC,
        amountToken: cfg.swapAmountCC,
        roundTripBack: cfg.roundTrip,
      });
    }
  }

  return actions;
}
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `npx vitest run tests/quest-engine.test.ts`
Expected: PASS (4 test).

- [ ] **Step 5: Commit**

```bash
git add src/quest-engine.ts tests/quest-engine.test.ts
git commit -m "feat: pure quest planner"
```

---

## Task 4: Safety guard (`safety.ts`)

**Files:**
- Create: `src/safety.ts`
- Test: `tests/safety.test.ts`

- [ ] **Step 1: Tulis test gagal**

```typescript
// tests/safety.test.ts
import { describe, it, expect } from "vitest";
import { checkAction } from "../src/safety.js";
import type { Config } from "../src/config.js";
import type { Action, WalletState } from "../src/types.js";

const cfg = {
  dailySpendCapCC: 100,
  minBalanceFloorCC: 50,
  maxSwapsPerRun: 12,
} as unknown as Config;

const action: Action = {
  questId: "q",
  from: "CC",
  to: "CBTC",
  amountCC: 10,
  amountToken: 10,
  roundTripBack: false,
};

const state: WalletState = {
  balances: { CC: 1000, CBTC: 1, USDCx: 1000 },
  quests: [],
  sessionAlive: true,
};

describe("checkAction", () => {
  it("mengizinkan aksi normal", () => {
    expect(checkAction(cfg, state, action, { spentCC: 0, swapCount: 0 })).toEqual({ ok: true });
  });

  it("menolak bila melewati daily cap", () => {
    const r = checkAction(cfg, state, action, { spentCC: 95, swapCount: 0 });
    expect(r.ok).toBe(false);
  });

  it("menolak bila saldo CC turun di bawah floor", () => {
    const low = { ...state, balances: { ...state.balances, CC: 55 } };
    const r = checkAction(cfg, low, action, { spentCC: 0, swapCount: 0 });
    expect(r.ok).toBe(false);
  });

  it("menolak bila melewati maxSwapsPerRun", () => {
    const r = checkAction(cfg, state, action, { spentCC: 0, swapCount: 12 });
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `npx vitest run tests/safety.test.ts`
Expected: FAIL — `checkAction` belum ada.

- [ ] **Step 3: Implementasi safety.ts**

```typescript
// src/safety.ts
import type { Config } from "./config.js";
import type { Action, WalletState } from "./types.js";

export interface RunCounters {
  spentCC: number;
  swapCount: number;
}

export type SafetyResult = { ok: true } | { ok: false; reason: string };

export function checkAction(
  cfg: Config,
  state: WalletState,
  action: Action,
  counters: RunCounters,
): SafetyResult {
  if (counters.swapCount >= cfg.maxSwapsPerRun) {
    return { ok: false, reason: `maxSwapsPerRun (${cfg.maxSwapsPerRun}) tercapai` };
  }
  if (counters.spentCC + action.amountCC > cfg.dailySpendCapCC) {
    return { ok: false, reason: `dailySpendCapCC (${cfg.dailySpendCapCC}) terlewati` };
  }
  // Jika sumber CC, saldo setelah swap tidak boleh di bawah floor
  if (action.from === "CC" && state.balances.CC - action.amountToken < cfg.minBalanceFloorCC) {
    return { ok: false, reason: `saldo CC akan di bawah floor (${cfg.minBalanceFloorCC})` };
  }
  return { ok: true };
}
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `npx vitest run tests/safety.test.ts`
Expected: PASS (4 test).

- [ ] **Step 5: Commit**

```bash
git add src/safety.ts tests/safety.test.ts
git commit -m "feat: safety guard for swap actions"
```

---

## Task 5: Reporter (`reporter.ts`)

**Files:**
- Create: `src/reporter.ts`
- Test: `tests/reporter.test.ts`

- [ ] **Step 1: Tulis test gagal (format pesan Telegram)**

```typescript
// tests/reporter.test.ts
import { describe, it, expect } from "vitest";
import { formatSummary } from "../src/reporter.js";
import type { RunSummary } from "../src/types.js";

const summary: RunSummary = {
  startedAt: "2026-06-07T09:00:00Z",
  finishedAt: "2026-06-07T09:03:00Z",
  swapsAttempted: 6,
  swapsSucceeded: 6,
  questsCompleted: ["five-swaps", "cc-cbtc", "cc-usdcx"],
  questsRemaining: [],
  spentCC: 60,
  errors: [],
};

describe("formatSummary", () => {
  it("menyertakan jumlah quest selesai dan swap", () => {
    const msg = formatSummary(summary);
    expect(msg).toContain("3");
    expect(msg).toContain("6");
    expect(msg).toContain("five-swaps");
  });

  it("menandai run yang abort", () => {
    const msg = formatSummary({ ...summary, aborted: "daily cap" });
    expect(msg.toLowerCase()).toContain("abort");
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `npx vitest run tests/reporter.test.ts`
Expected: FAIL — `formatSummary` belum ada.

- [ ] **Step 3: Implementasi reporter.ts**

```typescript
// src/reporter.ts
import pino from "pino";
import type { Config } from "./config.js";
import type { RunSummary } from "./types.js";

export const logger = pino(
  { level: process.env.LOG_LEVEL ?? "info" },
  pino.destination({ dest: "logs/bot.log", mkdir: true, sync: false }),
);

export function formatSummary(s: RunSummary): string {
  const lines = [
    "🤖 Kairo Quest Bot",
    s.aborted ? `⛔ ABORTED: ${s.aborted}` : "✅ Run selesai",
    `Quest selesai: ${s.questsCompleted.length} (${s.questsCompleted.join(", ") || "-"})`,
    `Quest sisa: ${s.questsRemaining.join(", ") || "-"}`,
    `Swap: ${s.swapsSucceeded}/${s.swapsAttempted} sukses`,
    `Spent: ${s.spentCC} CC`,
  ];
  if (s.errors.length) lines.push(`Errors: ${s.errors.join("; ")}`);
  return lines.join("\n");
}

export async function sendTelegram(cfg: Config, text: string): Promise<void> {
  if (!cfg.telegram.enabled) return;
  const url = `https://api.telegram.org/bot${cfg.telegram.botToken}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: cfg.telegram.chatId, text }),
    });
    if (!res.ok) logger.warn({ status: res.status }, "Telegram send gagal");
  } catch (err) {
    logger.warn({ err }, "Telegram send error");
  }
}

export async function report(cfg: Config, summary: RunSummary): Promise<void> {
  logger.info({ summary }, "run summary");
  await sendTelegram(cfg, formatSummary(summary));
}
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `npx vitest run tests/reporter.test.ts`
Expected: PASS (2 test).

- [ ] **Step 5: Commit**

```bash
git add src/reporter.ts tests/reporter.test.ts
git commit -m "feat: reporter with pino logs and telegram"
```

---

## Task 6: Discovery run (`discover.ts`) — MANUAL, butuh sesi login user

**Tujuan:** Tanpa selektor & URL endpoint asli, modul browser tidak bisa dibangun. Task ini menjalankan Playwright headed, user login manual, lalu script merekam: (a) URL response yang berisi saldo/quest, (b) contoh body JSON ke `tests/fixtures/`, dan engineer mengisi `src/selectors.ts` dari hasil amatan.

**Files:**
- Create: `src/discover.ts`, `src/selectors.ts`

- [ ] **Step 1: Tulis src/discover.ts**

```typescript
// src/discover.ts
// Jalankan: npm run discover
// Buka browser headed, user login + unlock wallet manual,
// lalu navigasi ke Activity & Balances. Script mencetak semua
// response XHR/fetch (URL + ringkasan body) untuk diidentifikasi.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE_URL = "https://kairo.ag/dashboard";
const USER_DATA_DIR = "./user-data";

async function main() {
  mkdirSync("tests/fixtures", { recursive: true });
  const ctx = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    viewport: { width: 1400, height: 900 },
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());

  let n = 0;
  page.on("response", async (res) => {
    const url = res.url();
    const ct = res.headers()["content-type"] ?? "";
    if (!ct.includes("application/json")) return;
    if (!/api|graphql|trade|quest|activity|balance|token|wallet/i.test(url)) return;
    try {
      const body = await res.text();
      n += 1;
      const file = `tests/fixtures/resp-${n}.json`;
      writeFileSync(file, `// ${res.request().method()} ${url}\n${body}`);
      console.log(`[${n}] ${res.status()} ${url} -> ${file}`);
    } catch {
      /* abaikan body yang tidak terbaca */
    }
  });

  await page.goto(BASE_URL);
  console.log(
    "\n>>> Login + unlock wallet manual. Buka tab Activity lalu Balances.\n" +
      ">>> Perhatikan log URL di atas. Tekan ENTER di terminal ini saat selesai.\n",
  );
  await new Promise<void>((resolve) => process.stdin.once("data", () => resolve()));
  await ctx.close();
  console.log("Selesai. Cek tests/fixtures/ untuk body JSON.");
}

main();
```

- [ ] **Step 2: Jalankan discovery (MANUAL — user)**

Run: `npx playwright install chromium && npm run discover`
Aksi user: login, unlock wallet, buka tab **Activity** lalu **Balances**, amati URL yang tercetak, lalu tekan ENTER.
Expected: file `tests/fixtures/resp-*.json` berisi body JSON; teridentifikasi URL untuk **saldo** dan **quest/activity**.

- [ ] **Step 3: Catat selektor UI swap (MANUAL — user/engineer)**

Dengan DevTools di browser yang sama, catat selektor stabil (prioritas: `data-testid`, lalu role+name, terakhir teks) untuk:
- tombol/menu navigasi: Swap, Balances, Activity
- dropdown token "from" & "to" + opsi token CC/CBTC/USDCx
- input jumlah, tombol **Max**
- tombol **Review Swap**, tombol **Sign Transaction**
- elemen indikator sukses "Swap Completed"
- indikator wallet locked vs connected (mis. teks `kairo::...` di header)

- [ ] **Step 4: Isi src/selectors.ts dari hasil discovery**

```typescript
// src/selectors.ts
// DIISI dari hasil Task 6. Nilai di bawah adalah placeholder template —
// ganti dengan selektor & URL asli yang ditemukan saat discovery.
import type { Token } from "./types.js";

// Regex untuk mencocokkan URL response yang membawa data state.
export const apiPatterns = {
  balances: /REPLACE_balances_url_fragment/i,
  quests: /REPLACE_quests_or_activity_url_fragment/i,
};

// Selektor CSS / Playwright locator string.
export const sel = {
  nav: {
    swap: 'REPLACE: getByRole("link", { name: "Swap" })',
    balances: "REPLACE",
    activity: "REPLACE",
  },
  swap: {
    fromTokenTrigger: "REPLACE",
    toTokenTrigger: "REPLACE",
    tokenOption: (t: Token) => `REPLACE token=${t}`,
    amountInput: "REPLACE",
    maxButton: "REPLACE",
    reviewButton: "REPLACE",
    signButton: "REPLACE",
    successIndicator: "REPLACE text=Swap Completed",
  },
  session: {
    connectedIndicator: "REPLACE text=kairo::",
    lockedIndicator: "REPLACE",
  },
};
```

- [ ] **Step 5: Commit (selectors.ts + discover.ts; fixtures di-gitignore bila sensitif)**

```bash
git add src/discover.ts src/selectors.ts
git commit -m "feat: discovery script and selectors map"
```

> **Catatan keamanan:** body fixture bisa memuat data akun/saldo. Tinjau sebelum commit; bila sensitif, tambahkan `tests/fixtures/` ke `.gitignore` dan simpan versi yang sudah disanitasi untuk test.

---

## Task 7: Browser manager (`browser.ts`)

**Files:**
- Create: `src/browser.ts`

> Bergantung pada `src/selectors.ts` (Task 6).

- [ ] **Step 1: Implementasi browser.ts**

```typescript
// src/browser.ts
import { chromium, type BrowserContext, type Page } from "playwright";
import type { Config } from "./config.js";
import { sel } from "./selectors.js";
import { logger } from "./reporter.js";

export interface Session {
  ctx: BrowserContext;
  page: Page;
}

export async function openSession(cfg: Config): Promise<Session> {
  const ctx = await chromium.launchPersistentContext(cfg.userDataDir, {
    headless: cfg.headless,
    viewport: { width: 1400, height: 900 },
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto(cfg.baseUrl, { waitUntil: "domcontentloaded" });
  return { ctx, page };
}

// True bila wallet terhubung & tidak locked.
export async function ensureSession(session: Session): Promise<boolean> {
  const { page } = session;
  try {
    await page.locator(sel.session.connectedIndicator).first().waitFor({
      state: "visible",
      timeout: 8000,
    });
    return true;
  } catch {
    logger.error("Sesi tidak aktif / wallet locked — perlu unlock manual");
    return false;
  }
}

export async function closeSession(session: Session): Promise<void> {
  await session.ctx.close();
}
```

- [ ] **Step 2: Verifikasi kompilasi**

Run: `npx tsc --noEmit`
Expected: tidak ada error.

- [ ] **Step 3: Commit**

```bash
git add src/browser.ts
git commit -m "feat: browser session manager"
```

---

## Task 8: State reader (`state-reader.ts`)

**Files:**
- Create: `src/state-reader.ts`
- Test: `tests/state-reader.test.ts`

> Parser di-TDD dengan fixture JSON hasil discovery. Sesuaikan bentuk parse dengan body asli yang ditemukan di Task 6.

- [ ] **Step 1: Tulis test parser dengan fixture**

> Ganti isi `balancesFixture` / `questsFixture` dengan struktur body asli dari `tests/fixtures/`. Contoh di bawah memakai bentuk umum; sesuaikan field-nya.

```typescript
// tests/state-reader.test.ts
import { describe, it, expect } from "vitest";
import { parseBalances, parseQuests } from "../src/state-reader.js";

const balancesFixture = {
  balances: [
    { symbol: "CC", amount: "1000.5" },
    { symbol: "CBTC", amount: "0.25" },
    { symbol: "USDCx", amount: "300" },
  ],
};

const questsFixture = {
  quests: [
    { id: "five-swaps", progress: 2, target: 5, done: false },
    { id: "cc-cbtc", progress: 1, target: 1, done: true },
  ],
};

describe("parseBalances", () => {
  it("memetakan simbol ke angka", () => {
    const b = parseBalances(balancesFixture);
    expect(b.CC).toBeCloseTo(1000.5);
    expect(b.CBTC).toBeCloseTo(0.25);
    expect(b.USDCx).toBeCloseTo(300);
  });
});

describe("parseQuests", () => {
  it("memetakan progres quest", () => {
    const q = parseQuests(questsFixture);
    expect(q.find((x) => x.id === "five-swaps")?.current).toBe(2);
    expect(q.find((x) => x.id === "cc-cbtc")?.completed).toBe(true);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `npx vitest run tests/state-reader.test.ts`
Expected: FAIL — fungsi belum ada.

- [ ] **Step 3: Implementasi state-reader.ts**

> Sesuaikan field (`symbol`/`amount`/`progress`/`target`/`done`) dengan body asli dari discovery.

```typescript
// src/state-reader.ts
import type { Page } from "playwright";
import { apiPatterns, sel } from "./selectors.js";
import type { Balances, QuestProgress, Token, WalletState } from "./types.js";
import { logger } from "./reporter.js";

const ZERO: Balances = { CC: 0, CBTC: 0, USDCx: 0 };

export function parseBalances(body: any): Balances {
  const out: Balances = { ...ZERO };
  for (const row of body?.balances ?? []) {
    const sym = row.symbol as Token;
    if (sym in out) out[sym] = Number(row.amount);
  }
  return out;
}

export function parseQuests(body: any): QuestProgress[] {
  return (body?.quests ?? []).map((q: any) => ({
    id: String(q.id),
    completed: Boolean(q.done),
    current: Number(q.progress ?? 0),
    target: Number(q.target ?? 0),
  }));
}

// Tangkap response yang cocok pattern, kembalikan body JSON terakhir per kategori.
async function captureState(
  page: Page,
  timeoutMs = 15000,
): Promise<{ balances?: any; quests?: any }> {
  const result: { balances?: any; quests?: any } = {};
  const handler = async (res: any) => {
    const url = res.url();
    try {
      if (apiPatterns.balances.test(url)) result.balances = await res.json();
      if (apiPatterns.quests.test(url)) result.quests = await res.json();
    } catch {
      /* abaikan */
    }
  };
  page.on("response", handler);
  // Picu fetch ulang: buka tab Balances lalu Activity
  await page.locator(sel.nav.balances).first().click().catch(() => {});
  await page.waitForTimeout(1500);
  await page.locator(sel.nav.activity).first().click().catch(() => {});
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && (!result.balances || !result.quests)) {
    await page.waitForTimeout(500);
  }
  page.off("response", handler);
  return result;
}

export async function snapshot(page: Page): Promise<WalletState> {
  const captured = await captureState(page);
  if (!captured.balances || !captured.quests) {
    logger.warn("Sniff tidak lengkap — pertimbangkan fallback DOM");
  }
  return {
    balances: captured.balances ? parseBalances(captured.balances) : { ...ZERO },
    quests: captured.quests ? parseQuests(captured.quests) : [],
    sessionAlive: true,
  };
}
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `npx vitest run tests/state-reader.test.ts`
Expected: PASS (2 test).

- [ ] **Step 5: Commit**

```bash
git add src/state-reader.ts tests/state-reader.test.ts
git commit -m "feat: state reader with network sniff and parsers"
```

---

## Task 9: Swap executor (`swap-executor.ts`)

**Files:**
- Create: `src/swap-executor.ts`

> Bergantung pada `src/selectors.ts`. Tidak ada unit test otomatis (butuh UI live); verifikasi via headed smoke run.

- [ ] **Step 1: Implementasi swap-executor.ts**

```typescript
// src/swap-executor.ts
import type { Page } from "playwright";
import { sel } from "./selectors.js";
import type { Action, SwapResult, Token } from "./types.js";
import { logger } from "./reporter.js";

async function selectToken(page: Page, trigger: string, token: Token): Promise<void> {
  await page.locator(trigger).first().click();
  await page.locator(sel.swap.tokenOption(token)).first().click();
}

async function singleSwap(
  page: Page,
  from: Token,
  to: Token,
  amount: number,
): Promise<SwapResult> {
  try {
    await page.locator(sel.nav.swap).first().click();
    await selectToken(page, sel.swap.fromTokenTrigger, from);
    await selectToken(page, sel.swap.toTokenTrigger, to);
    await page.locator(sel.swap.amountInput).first().fill(String(amount));
    await page.locator(sel.swap.reviewButton).first().click();
    await page.locator(sel.swap.signButton).first().click();
    await page.locator(sel.swap.successIndicator).first().waitFor({
      state: "visible",
      timeout: 60000,
    });
    return { ok: true, from, to, amountToken: amount };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ from, to, amount, err: msg }, "swap gagal");
    return { ok: false, from, to, amountToken: amount, error: msg };
  }
}

// Eksekusi aksi: swap utama + (opsional) swap balik round-trip.
export async function executeAction(page: Page, action: Action): Promise<SwapResult[]> {
  const results: SwapResult[] = [];
  const first = await singleSwap(page, action.from, action.to, action.amountToken);
  results.push(first);
  if (first.ok && action.roundTripBack) {
    // swap balik: jumlahnya didasarkan saldo token tujuan; pakai Max untuk simpel
    const back = await singleSwapMax(page, action.to, action.from);
    results.push(back);
  }
  return results;
}

async function singleSwapMax(page: Page, from: Token, to: Token): Promise<SwapResult> {
  try {
    await page.locator(sel.nav.swap).first().click();
    await page.locator(sel.swap.fromTokenTrigger).first().click();
    await page.locator(sel.swap.tokenOption(from)).first().click();
    await page.locator(sel.swap.toTokenTrigger).first().click();
    await page.locator(sel.swap.tokenOption(to)).first().click();
    await page.locator(sel.swap.maxButton).first().click();
    await page.locator(sel.swap.reviewButton).first().click();
    await page.locator(sel.swap.signButton).first().click();
    await page.locator(sel.swap.successIndicator).first().waitFor({
      state: "visible",
      timeout: 60000,
    });
    return { ok: true, from, to, amountToken: 0 };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ from, to, err: msg }, "swap balik gagal");
    return { ok: false, from, to, amountToken: 0, error: msg };
  }
}

export async function retrySwap(
  fn: () => Promise<SwapResult>,
  retries = 2,
  backoffMs = 3000,
): Promise<SwapResult> {
  let last: SwapResult = { ok: false, from: "CC", to: "CC", amountToken: 0, error: "no attempt" };
  for (let i = 0; i <= retries; i++) {
    last = await fn();
    if (last.ok) return last;
    if (i < retries) await new Promise((r) => setTimeout(r, backoffMs * (i + 1)));
  }
  return last;
}
```

- [ ] **Step 2: Verifikasi kompilasi**

Run: `npx tsc --noEmit`
Expected: tidak ada error.

- [ ] **Step 3: Commit**

```bash
git add src/swap-executor.ts
git commit -m "feat: swap executor via UI with round-trip and retry"
```

---

## Task 10: Scheduler (`scheduler.ts`)

**Files:**
- Create: `src/scheduler.ts`

- [ ] **Step 1: Implementasi scheduler.ts**

```typescript
// src/scheduler.ts
import cron from "node-cron";
import type { Config } from "./config.js";
import { logger } from "./reporter.js";

export function scheduleDaily(cfg: Config, run: () => Promise<void>): void {
  if (!cron.validate(cfg.scheduleCron)) {
    throw new Error(`scheduleCron invalid: ${cfg.scheduleCron}`);
  }
  cron.schedule(cfg.scheduleCron, async () => {
    const jitter = Math.floor(Math.random() * (cfg.jitterMinutes + 1)) * 60_000;
    logger.info({ jitterMs: jitter }, "trigger harian — menunggu jitter");
    await new Promise((r) => setTimeout(r, jitter));
    try {
      await run();
    } catch (err) {
      logger.error({ err }, "run harian gagal");
    }
  });
  logger.info({ cron: cfg.scheduleCron }, "scheduler aktif");
}
```

- [ ] **Step 2: Verifikasi kompilasi**

Run: `npx tsc --noEmit`
Expected: tidak ada error.

- [ ] **Step 3: Commit**

```bash
git add src/scheduler.ts
git commit -m "feat: daily cron scheduler with jitter"
```

---

## Task 11: Orkestrasi (`main.ts`)

**Files:**
- Create: `src/main.ts`

- [ ] **Step 1: Implementasi main.ts**

```typescript
// src/main.ts
import { loadConfig } from "./config.js";
import { openSession, ensureSession, closeSession } from "./browser.js";
import { snapshot } from "./state-reader.js";
import { plan } from "./quest-engine.js";
import { checkAction, type RunCounters } from "./safety.js";
import { executeAction } from "./swap-executor.js";
import { scheduleDaily } from "./scheduler.js";
import { report, logger } from "./reporter.js";
import type { RunSummary } from "./types.js";

async function runOnce(): Promise<void> {
  const cfg = loadConfig();
  const startedAt = new Date().toISOString();
  const summary: RunSummary = {
    startedAt,
    finishedAt: startedAt,
    swapsAttempted: 0,
    swapsSucceeded: 0,
    questsCompleted: [],
    questsRemaining: [],
    spentCC: 0,
    errors: [],
  };

  const session = await openSession(cfg);
  try {
    if (!(await ensureSession(session))) {
      summary.aborted = "sesi locked — perlu unlock manual";
      summary.finishedAt = new Date().toISOString();
      await report(cfg, summary);
      return;
    }

    let state = await snapshot(session.page);
    const counters: RunCounters = { spentCC: 0, swapCount: 0 };
    const actions = plan(cfg, state);
    logger.info({ count: actions.length }, "rencana aksi");

    for (const action of actions) {
      const guard = checkAction(cfg, state, action, counters);
      if (!guard.ok) {
        summary.aborted = guard.reason;
        break;
      }
      summary.swapsAttempted += 1;
      const results = await executeAction(session.page, action);
      for (const r of results) {
        if (r.ok) summary.swapsSucceeded += 1;
        else summary.errors.push(`${r.from}->${r.to}: ${r.error}`);
      }
      counters.swapCount += results.length;
      counters.spentCC += action.amountCC;
      summary.spentCC = counters.spentCC;
      // refresh state untuk idempotensi
      state = await snapshot(session.page);
    }

    state = await snapshot(session.page);
    summary.questsCompleted = state.quests.filter((q) => q.completed).map((q) => q.id);
    summary.questsRemaining = state.quests.filter((q) => !q.completed).map((q) => q.id);
  } catch (err) {
    summary.errors.push(err instanceof Error ? err.message : String(err));
  } finally {
    await closeSession(session);
    summary.finishedAt = new Date().toISOString();
    await report(cfg, summary);
  }
}

function main(): void {
  const once = process.argv.includes("--once");
  if (once) {
    runOnce();
  } else {
    const cfg = loadConfig();
    scheduleDaily(cfg, runOnce);
    logger.info("bot berjalan dalam mode scheduler — tekan Ctrl+C untuk berhenti");
  }
}

main();
```

- [ ] **Step 2: Verifikasi kompilasi + seluruh test**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tidak ada error TS; semua unit test PASS.

- [ ] **Step 3: Commit**

```bash
git add src/main.ts
git commit -m "feat: orchestrate run with scheduler and --once mode"
```

---

## Task 12: README + smoke run manual

**Files:**
- Create: `README.md`

- [ ] **Step 1: Tulis README.md**

````markdown
# Kairo Quest Bot

Bot otomatis swap + quest harian Kairo DEX (Canton Network).

## Setup
1. `npm install && npx playwright install chromium`
2. `cp config.example.yaml config.yaml` lalu sesuaikan.
3. Discovery (sekali): `npm run discover` — login + unlock wallet manual, isi `src/selectors.ts`.
4. Test: `npm test`

## Menjalankan
- Sekali jalan: `npm run run:once`
- Scheduler harian: `npm start`

## Keamanan
- `user-data/` = profil browser berisi sesi wallet. JANGAN commit/bagikan. Setara akses dana.
- `config.yaml` & token Telegram di-gitignore.
- Set batas: `dailySpendCapCC`, `minBalanceFloorCC`, `maxSwapsPerRun`.

## Cara kerja
UI dipakai untuk swap + sign (key Canton ada di klien). Progres quest & saldo
dibaca dari response jaringan dashboard (fallback DOM). Lihat
`docs/superpowers/specs/2026-06-07-kairo-quest-bot-design.md`.
````

- [ ] **Step 2: Smoke run manual (headed, --once)**

Run: `npm run run:once`
Expected: browser terbuka, sesi terdeteksi, bot melakukan swap sesuai quest yang belum selesai, log ringkasan muncul + (bila enabled) pesan Telegram. Verifikasi di tab Activity bahwa quest tercentang.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add README and usage"
```

---

## Self-Review (sudah dijalankan saat penulisan)

- **Spec coverage:** config, browser/persistent profile, state-reader (Approach C), swap-executor, quest-engine, safety, scheduler, reporter (log+Telegram), discovery run — semua tercakup (Task 0–12).
- **Placeholder:** `selectors.ts` sengaja berisi placeholder yang HARUS diisi dari Task 6 (discovery) — ini bukan kegagalan plan, melainkan ketergantungan data live yang sudah didokumentasikan sejak spec.
- **Type consistency:** `plan(cfg, state)`, `checkAction(cfg, state, action, counters)`, `executeAction(page, action)`, `snapshot(page)`, `WalletState`, `Action`, `RunSummary` konsisten dipakai lintas Task 1/3/4/8/9/11.
```
