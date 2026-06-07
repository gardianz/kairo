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
import { logger } from "./reporter.ts";

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
  scheduleDaily(cfg, async () => {
    await completeAllQuests(cfg, resolveAccounts(cfg));
  });
  console.log("Scheduler running. Ctrl+C to stop.");
}

async function menu() {
  header();
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  for (;;) {
    console.log("\n  1) Cek akun (saldo + status quest)");
    console.log("  2) Selesaikan semua quest (paralel)");
    console.log("  3) Jalankan scheduler harian");
    console.log("  4) Keluar");
    const ans = (await rl.question("Pilih [1-4]: ")).trim();
    if (ans === "1") await doCheck();
    else if (ans === "2") await doQuests();
    else if (ans === "3") {
      rl.close();
      doSchedule();
      return;
    } else if (ans === "4" || ans.toLowerCase() === "q") {
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
    else await menu();
  } catch (err) {
    logger.error({ err }, "fatal");
    console.error("\n❌", err instanceof Error ? err.message : err);
    process.exit(1);
  }
  if (!process.argv.includes("--schedule")) process.exit(0);
}

main();
