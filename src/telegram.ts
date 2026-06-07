// Interactive Telegram control: long-polls for commands and runs the bot.
// Commands (only from the authorized chatId):
//   /help          show commands
//   /status        is a job running? account count
//   /check /stats  account login + balance + quest status
//   /run /quests   complete all quests (concurrent)
//   /stop          cancel the running quest job
import type { Config } from "./config.ts";
import { resolveAccounts } from "./accounts.ts";
import { checkAccounts } from "./check.ts";
import { completeAllQuests } from "./run-quests.ts";
import type { CancelToken } from "./runner.ts";
import type { Dashboard } from "./dashboard.ts";
import { logger } from "./reporter.ts";

const HELP = [
  "🤖 *Kairo Bot*",
  "/status — job status + accounts",
  "/check — saldo + status quest tiap akun",
  "/run — selesaikan semua quest (paralel)",
  "/stop — hentikan job berjalan",
  "/help — bantuan",
].join("\n");

export class TelegramControl {
  private base: string;
  private chatId: string;
  private offset = 0;
  private running = false;
  private cancel: CancelToken = { cancelled: false };

  constructor(
    private cfg: Config,
    private dash?: Dashboard,
  ) {
    if (!cfg.telegram.enabled) throw new Error("telegram disabled in config");
    this.base = `https://api.telegram.org/bot${cfg.telegram.botToken}`;
    this.chatId = cfg.telegram.chatId;
  }

  async send(text: string): Promise<void> {
    try {
      await fetch(`${this.base}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: this.chatId, text, parse_mode: "Markdown" }),
      });
    } catch (err) {
      logger.warn({ err }, "telegram send failed");
    }
  }

  async start(): Promise<void> {
    logger.info("telegram control started");
    await this.send(HELP);
    for (;;) {
      try {
        const res = await fetch(`${this.base}/getUpdates?timeout=30&offset=${this.offset}`);
        const body = await res.json();
        for (const u of body.result ?? []) {
          this.offset = u.update_id + 1;
          const msg = u.message;
          if (!msg?.text) continue;
          if (String(msg.chat?.id) !== this.chatId) continue; // authorize
          await this.handle(msg.text.trim());
        }
      } catch (err) {
        logger.warn({ err }, "getUpdates failed");
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }

  private async handle(text: string): Promise<void> {
    const cmd = text.split(/\s+/)[0].toLowerCase().replace(/@.*$/, "");
    this.dash?.addLog("TG", `perintah ${cmd}`, "info");
    switch (cmd) {
      case "/start":
      case "/help":
        await this.send(HELP);
        break;
      case "/status":
        await this.send(
          this.running ? "🟢 Job *berjalan*. /stop untuk hentikan." : "⚪ Idle. /run untuk mulai.",
        );
        break;
      case "/check":
      case "/stats":
        await this.doCheck();
        break;
      case "/run":
      case "/quests":
        await this.doRun();
        break;
      case "/stop":
        if (this.running) {
          this.cancel.cancelled = true;
          await this.send("🛑 Menghentikan job setelah swap berjalan selesai…");
        } else await this.send("Tidak ada job berjalan.");
        break;
      default:
        await this.send("Perintah tidak dikenal. /help");
    }
  }

  private async doCheck(): Promise<void> {
    await this.send("🔎 Cek akun…");
    const accounts = resolveAccounts(this.cfg);
    const res = await checkAccounts(this.cfg, accounts, { showDashboard: false });
    // mirror results onto the persistent dashboard cards
    for (const r of res) {
      this.dash?.setAcct(r.name, {
        state: r.ok ? "done" : "error",
        party: r.partyTail,
        status: r.ok ? `online ✓ · quest ${r.quests} · ${r.swaps} sw 24h` : `gagal: ${r.error?.slice(0, 30)}`,
      });
      this.dash?.addLog(r.name, r.ok ? `cek: quest ${r.quests} · ${r.bal}` : `cek gagal`, r.ok ? "balance" : "error");
    }
    const lines = res.map((r) =>
      r.ok
        ? `✅ *${r.name}*  quest ${r.quests} · ${r.swaps} sw 24h\n   \`${r.bal}\``
        : `❌ *${r.name}* — ${r.error}`,
    );
    const ok = res.filter((r) => r.ok).length;
    await this.send(`📊 *Accounts ${ok}/${res.length} online*\n\n` + lines.join("\n"));
  }

  private async doRun(): Promise<void> {
    if (this.running) {
      await this.send("⚠️ Job sudah berjalan. /stop dulu.");
      return;
    }
    this.running = true;
    this.cancel = { cancelled: false };
    const accounts = resolveAccounts(this.cfg);
    await this.send(`🚀 Mulai quest untuk ${accounts.length} akun…`);
    try {
      const sums = await completeAllQuests(this.cfg, accounts, {
        signal: this.cancel,
        dash: this.dash,
        showDashboard: this.dash ? undefined : false,
      });
      const lines = sums.map((s) => {
        const st = s.aborted ? `⛔ ${s.aborted}` : s.questsRemaining.length ? "⚠️ partial" : "✅ done";
        return `*${s.account}*: ${st} (quest ${s.questsCompleted.length}, swap ${s.swapsSucceeded})`;
      });
      await this.send("🏁 Selesai:\n" + lines.join("\n"));
    } catch (err) {
      await this.send("❌ Error: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      this.running = false;
    }
  }
}
