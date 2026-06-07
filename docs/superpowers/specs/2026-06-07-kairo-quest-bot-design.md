# Kairo Quest Bot — Design Spec

**Date:** 2026-06-07
**Status:** Approved (design phase)

## Tujuan

Bot otomatis yang menjalankan swap di Kairo DEX (https://kairo.ag/dashboard) dan
menyelesaikan quest harian secara otomatis setiap hari, dengan biaya seminimal
mungkin dan pengamanan dana.

## Konteks Platform

- Kairo berjalan di **Canton Network** (bukan EVM).
- Wallet = native Kairo wallet, identitas berupa Canton party (`kairo::...`)
  dengan password. Private key disimpan di sisi klien (non-custodial); Kairo
  tidak menyimpan akses.
- Token: `$CC` (Canton Coin), `$CBTC` (Canton Bitcoin), `$USDCx` (Canton USD Coin).
- Swap bersifat atomic, dieksekusi lewat UI dashboard:
  tab **Swap** → pilih token sumber/tujuan → isi jumlah → **Review Swap** →
  **Sign Transaction** → muncul "Swap Completed Successfully!".
- **Trading Partner API** (`POST /trading-partner/trade-request`, header
  `x-api-key: kex_...`) bersifat partner-only: butuh key dari admin + Canton
  validator node sendiri + SDK membangun kontrak `TradeProposal` on-ledger.
  Tidak self-serve untuk trader biasa. **Tidak dipakai** untuk farming quest.

## Daily Quests (target bot)

1. **5 swap**, masing-masing bernilai ≥ 10 $CC.
2. 1× swap pasangan **$CC ↔ $CBTC**.
3. 1× swap pasangan **$CC ↔ $USDCx**.
4. Onboarding (one-time): Follow X — di luar scope harian (umumnya sudah selesai).

Catatan: daftar quest dapat berubah; quest engine membaca progres aktual dari
state dashboard, bukan hardcode jumlah swap secara buta.

## Keputusan Desain (disetujui)

| Aspek | Pilihan |
|-------|---------|
| Bahasa/stack | Node + TypeScript + Playwright |
| Autentikasi | Persistent profile (`userDataDir`); unlock manual sekali, sesi dipakai ulang. Tidak menyimpan password plaintext. |
| Mode jalan | Built-in daily scheduler (long-running, bangun 1×/hari) |
| Strategi swap | Configurable (default: minimal round-trip — swap minimum lalu balik agar holding hampir tidak bergerak; hanya rugi fee+slippage) |
| Pelaporan | Log file (pino) + ringkasan/alert Telegram |
| Arsitektur baca state | Approach C (hybrid): UI untuk swap+sign, sniff network response untuk state, fallback DOM |

## Arsitektur

Pendekatan **Approach C (hybrid)**: signing harus lewat browser (key Canton ada
di klien), tapi pembacaan progres quest + saldo diambil dari response jaringan
backend dashboard (Playwright response interception) — bukan scraping DOM teks —
agar robust terhadap perubahan copy/UI.

### Komponen

1. **config** — `config.yaml` (gitignored) + `config.example.yaml`. Field:
   - `swapAmountCC` (default 10), `slippageTolerancePct`
   - `roundTrip` (default true)
   - `dailySpendCapCC`, `minBalanceFloorCC`, `maxSwapsPerRun`
   - `scheduleCron` (jam jalan harian), `jitterMinutes`
   - `headless` (default false untuk run pertama)
   - `quests[]` (definisi: id, tipe, pair, threshold, count)
   - `telegram.botToken`, `telegram.chatId`
   - Validasi schema saat startup (zod), gagal cepat bila invalid.

2. **browser** — buat Playwright persistent context (`userDataDir`). Run pertama
   headed untuk unlock manual. Sediakan `ensureSession()` yang mendeteksi sesi
   locked/expired dan melempar error terstruktur bila perlu unlock manual.

3. **state-reader** — pasang `page.on('response')` untuk menangkap response
   endpoint quest/saldo dashboard, parse jadi `WalletState { balances, quests }`.
   Fallback baca DOM per field bila sniff gagal. Expose `snapshot()` &
   `refresh()`.

4. **swap-executor** — `executeSwap({ from, to, amount })`: buka tab Swap, pilih
   token, isi jumlah, klik Review Swap → Sign Transaction, tunggu konfirmasi
   "Swap Completed". Return `{ ok, txInfo?, error? }`. Timeout + deteksi reject.

5. **quest-engine** — fungsi murni `plan(questDefs, state, config) → Action[]`.
   Hitung aksi tersisa: berapa swap lagi untuk quest 5×10-CC, apakah pasangan
   CC↔CBTC / CC↔USDCx perlu dilakukan, plus aksi round-trip balik bila aktif.
   Idempotent: quest yang sudah selesai dilewati.

6. **safety** — `check(action, state, config) → ok | abortReason`. Paksa:
   daily spend cap, min-balance floor, max swaps per run, slippage tolerance.
   Abort run bila dilanggar.

7. **scheduler** — `node-cron` trigger harian (+ jitter opsional), lalu sleep.

8. **reporter** — `pino` log terstruktur ke file. Kirim ringkasan harian
   (quest selesai, jumlah swap, fee, error) + alert kegagalan ke Telegram.

9. **main** — orkestrasi: schedule → `ensureSession` → `snapshot` →
   `engine.plan` → loop aksi (`safety.check` → `swap` → `refresh`) → `report`.

### Alur Data

```
cron fire
  → browser.ensureSession (unlock context)
  → state-reader.snapshot  ──► WalletState
  → quest-engine.plan(defs, state, cfg) ──► Action[]
  → untuk tiap action:
        safety.check  → (abort jika dilanggar)
        swap-executor.executeSwap
        state-reader.refresh
  → reporter.summary (log + Telegram)
```

### Error Handling

- Sesi locked/expired → alert Telegram "perlu unlock manual", abort run.
- Swap gagal (reject / timeout / slippage) → retry dengan backoff (N kali),
  lalu skip aksi + alert.
- Safety dilanggar → hentikan run + alert.
- Sniff network gagal → fallback baca DOM untuk field tsb.

### Testing

- **Unit:** `quest-engine.plan` (murni, input state → output aksi); aturan
  `safety`; validasi config; parser response (fixture JSON hasil rekam).
- **Integrasi:** `swap-executor` terhadap route yang di-mock; smoke run headed
  manual sekali.

## Struktur Proyek

```
kairo/
  src/
    config.ts        # load + validasi config (zod)
    types.ts         # WalletState, QuestDef, Action, dll
    browser.ts       # persistent context, ensureSession
    selectors.ts     # peta selektor + URL endpoint (diisi dari discovery)
    state-reader.ts  # network sniff + DOM fallback
    swap-executor.ts # eksekusi 1 swap via UI
    quest-engine.ts  # planner murni
    safety.ts        # guard cap/floor/slippage
    scheduler.ts     # node-cron
    reporter.ts      # pino + telegram
    main.ts          # orkestrasi
  tests/
  config.example.yaml
  package.json
  tsconfig.json
```

## Dependensi / Risiko

- **Selektor pasti + URL API quest/saldo dashboard tidak tersedia di docs publik.**
  Karena itu **Task 0 implementasi = discovery run**: dengan user sudah login,
  Playwright merekam selektor asli + endpoint jaringan ke `selectors.ts`.
  Semua komponen lain bergantung pada hasil ini. Tanpa sesi live milik user,
  selektor tidak bisa ditebak.
- **Keamanan:** persistent profile menyimpan sesi wallet di disk. Folder
  `userDataDir` setara akses ke dana — wajib di luar git, permission ketat.
  `config.yaml` & `.env` (Telegram) gitignored.
- Perubahan UI/API Kairo bisa merusak selektor → mitigasi: state-reader berbasis
  network + fallback DOM, selektor terpusat di `selectors.ts`.
