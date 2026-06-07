# Kairo Quest Bot

Pure-API, multi-account auto-swap + daily-quest bot for [Kairo DEX](https://kairo.ag) (Canton Network).

No browser at runtime: swaps go straight to `api.kairo.ag` (quote → prepare → sign → submit), signing locally with the wallet's ed25519 key. A browser is only used once, manually, to grab each account's session.

## How it works

- **Auth**: Kairo web login is Google-only and issues an `authToken` (24h) + `refreshToken` (7d) stored in `localStorage`, plus an AES-encrypted Canton key in IndexedDB `cantonNetwork`. The bot reuses an exported session bundle and auto-refreshes the token — no repeated Google login until the refresh token expires (7d).
- **Swap**: `POST /swap/simple-escrow/prepare` returns a `preparedTransactionHash`; the bot signs it (`nacl.sign.detached` with the AES-decrypted key) and calls `POST /swap/simple-escrow/submit`.
- **Quests**: read live from `GET /trader-analytics/daily-swap-activities`. The planner only does what's still pending (idempotent).
- **Escrow lock**: each swap locks its input in an escrow that unlocks a few minutes later. Keep enough float, or the bot skips swaps when unlocked balance is too low.

## Setup

```bash
npm install
cp config.example.yaml config.yaml   # edit accounts, caps, schedule, telegram
```

### Add an account — easiest: the browser extension (recommended)
1. `npm run receiver` (starts a local save server on 127.0.0.1:8787).
2. Load the extension: Chrome → `chrome://extensions` → enable Developer mode →
   "Load unpacked" → pick the `extension/` folder.
3. On a logged-in kairo.ag tab, click the extension icon:
   - **1. Grab session from tab**
   - type account name + wallet password
   - **2. Save to bot** → it's verified and written automatically.
4. Repeat per account. Stop the receiver (Ctrl+C) when done.

### Add an account — alternative: copy-paste wizard (no extension)
1. Log in to kairo.ag, F12 → Console → paste `tools/export-session.js` → Enter
   (copies the session to clipboard).
2. `npm run add-account`, paste it, type the wallet password.

Both paths verify the password against the wallet key and register the account in
`config.yaml`.

### Run on a VPS (extension local, bot remote)
The bot has no browser at runtime, so it runs fine on a headless VPS. Sessions
are grabbed on your local machine and pasted into one file on the VPS:

1. Local: load the `extension/`, open a logged-in kairo.ag tab.
2. Extension → **Grab session** → set name + wallet password → **Copy account JSON**.
3. On the VPS, paste that object into the `accounts.json` array:
   ```json
   [
     { "name": "main", "password": "...", "bundle": { ... } },
     { "name": "acc2", "password": "...", "bundle": { ... } }
   ]
   ```
4. In `config.yaml` set `accountsFile: "accounts.json"` (and leave `accounts: []`).
5. `npm run run:once` or `npm start`. Refreshed tokens are written back to
   `accounts.json` automatically (survives the 7-day refresh window).

`accounts.json` holds keys + passwords — keep it `chmod 600`, it's gitignored.

## Run

```bash
npm start          # interactive menu: 1) check  2) complete quests  3) scheduler
npm run run:once   # check accounts only (login + balance + quest status), no swaps
npm run quests     # complete all quests, all accounts, CONCURRENT, then exit
npm run schedule   # daily scheduler (cron + jitter), concurrent accounts
```

All multi-account work runs in parallel (`maxConcurrent` in config) with a live
dashboard; detailed logs go to `logs/bot.log`.

## Safety

- `secret/`, `sessions/`, `config.yaml`, `user-data/` are gitignored. A session
  bundle contains the wallet key + tokens — **anyone with it controls the funds**.
- Guards: `dailySpendCapCC`, `minBalanceFloorCC`, `maxSwapsPerRun`.
- `roundTrip: true` swaps back after each swap to keep holdings stable (minus
  fees + temporary escrow lock).

## Tests

```bash
npm test          # crypto roundtrip, quest planner, safety guards
npm run typecheck
```

## Layout

```
src/
  crypto.ts        # AES decrypt + ed25519 sign (verified vs live wallet)
  api.ts           # api.kairo.ag client (quote/prepare/submit/balance/quests/refresh)
  session.ts       # load bundle + password, verify, auto-refresh token
  swap.ts          # quote -> prepare -> sign -> submit
  quest-engine.ts  # pure planner from live quest progress
  safety.ts        # spend cap / floor / max swaps
  runner.ts        # per-account orchestration
  scheduler.ts     # node-cron daily
  reporter.ts      # pino logs + telegram
  main.ts          # CLI entry
tools/export-session.js   # browser console snippet to export a session bundle
docs/superpowers/         # design spec + plan
```
