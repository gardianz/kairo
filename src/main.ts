// Entry point.
//   npm run run:once        -> check accounts (login + balance + quest status), exit
//   npm start               -> interactive menu
//   tsx src/main.ts --quests   -> complete all quests once (concurrent), exit
//   tsx src/main.ts --schedule -> daily scheduler
import { createInterface } from "node:readline/promises";
import { loadConfig } from "./config.ts";
import { resolveAccounts } from "./accounts.ts";
import { checkAccounts } from "./check.ts";
import { completeAllQuests } from "./run-quests.ts";
import { scheduleDaily } from "./scheduler.ts";
import { TelegramControl } from "./telegram.ts";
import { Dashboard } from "./dashboard.ts";
import { logger } from "./reporter.ts";

function makeDashboard(title: string, accounts: { name: string; proxy?: string }[], cfg: any) {
  return new Dashboard(title, accounts.map((a) => a.name), {
    swapAmt: cfg.swapAmountCC,
    proxied: accounts.filter((a) => a.proxy).length,
    nextRunCron: cfg.scheduleCron,
  });
}

function header() {
  console.log("\n\x1b[1m╔══════════════════════════════╗");
  console.log("║      KAIRO QUEST BOT         ║");
  console.log("╚══════════════════════════════╝\x1b[0m");
}

async function doCheck() {
  const cfg = loadConfig();
  const accounts = resolveAccounts(cfg);
  const res = await checkAccounts(cfg, accounts);
  const ok = res.filter((r) => r.ok).length;
  console.log(`\n${ok}/${res.length} accounts online.`);
  const bad = res.filter((r) => !r.ok);
  if (bad.length) console.log("Failed: " + bad.map((b) => `${b.name} (${b.error})`).join(", "));
}

async function doQuests() {
  const cfg = loadConfig();
  const accounts = resolveAccounts(cfg);
  const sums = await completeAllQuests(cfg, accounts);
  const done = sums.filter((s) => s.questsRemaining.length === 0 && !s.aborted).length;
  console.log(`\n${done}/${sums.length} accounts: all quests done.`);
  for (const s of sums) {
    const status = s.aborted ? `⛔ ${s.aborted}` : s.questsRemaining.length ? "partial" : "✅ done";
    console.log(`  ${s.account}: ${status} | quests ${s.questsCompleted.length} done, swaps ${s.swapsSucceeded}`);
  }
}

function doSchedule() {
  const cfg = loadConfig();
  const accounts = resolveAccounts(cfg);
  const dash = makeDashboard("Scheduler", accounts, cfg);
  dash.setAllStatus("menunggu jadwal");
  dash.start();
  scheduleDaily(cfg, async () => {
    dash.addLog("-", "mulai run terjadwal", "info");
    await completeAllQuests(cfg, resolveAccounts(cfg), { dash });
    dash.addLog("-", "run selesai — menunggu jadwal berikutnya", "done");
  });
}

async function doTelegram() {
  const cfg = loadConfig();
  if (!cfg.telegram.enabled) {
    console.error("Telegram disabled. Set telegram.enabled/botToken/chatId in config.yaml.");
    process.exit(1);
  }
  const accounts = resolveAccounts(cfg);
  const dash = makeDashboard("Telegram", accounts, cfg);
  dash.setAllStatus("idle — kirim /run di Telegram");
  dash.start();
  await new TelegramControl(cfg, dash).start();
}

async function menu() {
  header();
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  for (;;) {
    console.log("\n  1) Cek akun (saldo + status quest)");
    console.log("  2) Selesaikan semua quest (paralel)");
    console.log("  3) Jalankan scheduler harian");
    console.log("  4) Jalankan kontrol Telegram");
    console.log("  5) Keluar");
    const ans = (await rl.question("Pilih [1-5]: ")).trim();
    if (ans === "1") await doCheck();
    else if (ans === "2") await doQuests();
    else if (ans === "3") {
      rl.close();
      doSchedule();
      return;
    } else if (ans === "4") {
      rl.close();
      await doTelegram();
      return;
    } else if (ans === "5" || ans.toLowerCase() === "q") {
      rl.close();
      console.log("bye");
      return;
    } else console.log("pilihan tidak valid");
  }
}

async function main() {
  try {
    if (process.argv.includes("--check") || process.argv.includes("--once")) await doCheck();
    else if (process.argv.includes("--quests")) await doQuests();
    else if (process.argv.includes("--schedule")) doSchedule();
    else if (process.argv.includes("--telegram")) await doTelegram();
    else await menu();
  } catch (err) {
    logger.error({ err }, "fatal");
    console.error("\n❌", err instanceof Error ? err.message : err);
    process.exit(1);
  }
  const longRunning = process.argv.includes("--schedule") || process.argv.includes("--telegram");
  if (!longRunning) process.exit(0);
}

main();
