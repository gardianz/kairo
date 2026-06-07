import cron from "node-cron";
import type { Config } from "./config.ts";
import { logger } from "./reporter.ts";

export function scheduleDaily(cfg: Config, run: () => Promise<void>): void {
  if (!cron.validate(cfg.scheduleCron)) {
    throw new Error(`invalid scheduleCron: ${cfg.scheduleCron}`);
  }
  cron.schedule(cfg.scheduleCron, async () => {
    const jitter = Math.floor(Math.random() * (cfg.jitterMinutes + 1)) * 60_000;
    logger.info({ jitterMs: jitter }, "daily trigger — waiting jitter");
    await new Promise((r) => setTimeout(r, jitter));
    try {
      await run();
    } catch (err) {
      logger.error({ err }, "daily run failed");
    }
  });
  logger.info({ cron: cfg.scheduleCron }, "scheduler active");
}
