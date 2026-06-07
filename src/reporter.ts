import pino from "pino";
import type { Config } from "./config.ts";
import type { RunSummary } from "./types.ts";

// Detailed logs go to file; the live dashboard owns the console.
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  transport: {
    targets: [{ target: "pino/file", options: { destination: "logs/bot.log", mkdir: true } }],
  },
});

export function formatSummary(s: RunSummary): string {
  const lines = [
    `🤖 Kairo Bot — ${s.account}`,
    s.aborted ? `⛔ ABORTED: ${s.aborted}` : "✅ Run done",
    `Quests done: ${s.questsCompleted.length} (${s.questsCompleted.join(", ") || "-"})`,
    `Quests left: ${s.questsRemaining.join(", ") || "-"}`,
    `Swaps: ${s.swapsSucceeded}/${s.swapsAttempted} ok`,
    `Spent: ${s.spentCC} CC`,
  ];
  if (s.errors.length) lines.push(`Errors: ${s.errors.slice(0, 5).join("; ")}`);
  return lines.join("\n");
}

export async function sendTelegram(cfg: Config, text: string): Promise<void> {
  if (!cfg.telegram.enabled) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${cfg.telegram.botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: cfg.telegram.chatId, text }),
    });
    if (!res.ok) logger.warn({ status: res.status }, "telegram send failed");
  } catch (err) {
    logger.warn({ err }, "telegram send error");
  }
}

export async function report(cfg: Config, summary: RunSummary): Promise<void> {
  logger.info({ summary }, "run summary");
  await sendTelegram(cfg, formatSummary(summary));
}
