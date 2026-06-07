import { readFileSync } from "node:fs";
import yaml from "js-yaml";
import { z } from "zod";

const tokenSchema = z.enum(["Amulet", "CBTC", "USDCx"]);

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

const accountSchema = z.object({
  name: z.string().min(1),
  bundle: z.string().min(1), // path to session bundle json
  passwordFile: z.string().min(1), // path to file holding wallet password
  proxy: z.string().optional(), // per-account proxy override
});

const configSchema = z.object({
  apiBase: z.string().url().default("https://api.kairo.ag"),
  proxy: z.string().optional(), // global proxy (http://user:pass@host:port); per-account overrides
  swapAmountCC: z.number().positive().default(10),
  roundTrip: z.boolean().default(true),
  dailySpendCapCC: z.number().positive().default(100),
  minBalanceFloorCC: z.number().min(0).default(0),
  maxSwapsPerRun: z.number().int().positive().default(20),
  swapDelayMs: z.number().int().min(0).default(4000),
  swapReserveCC: z.number().min(0).default(1), // extra unlocked buffer for fees
  consolidateToCC: z.boolean().default(true), // swap leftover non-CC back to CC at end
  consolidateOnlyWhenQuestsDone: z.boolean().default(true),
  dustMinUnlocked: z.number().min(0).default(0.00000001),
  waitForUnlock: z.boolean().default(true),
  unlockMaxWaitMs: z.number().int().min(0).default(900000), // 15 min
  unlockPollMs: z.number().int().min(1000).default(20000),
  socialFollow: z
    .object({ x: z.boolean().default(false), telegram: z.boolean().default(false) })
    .default({ x: false, telegram: false }),
  scheduleCron: z.string().min(1).default("0 9 * * *"),
  jitterMinutes: z.number().int().min(0).default(15),
  accountDelayMs: z.number().int().min(0).default(8000),
  maxConcurrent: z.number().int().min(1).default(5), // accounts processed in parallel
  autoRecheckMinutes: z.number().int().min(0).default(0), // re-attempt liquidity-skipped quests every N min (0=off; each retry may lock CC)
  autoRecheckMax: z.number().int().min(0).default(6), // max recheck rounds
  quests: z.array(questSchema).min(1),
  accountsFile: z.string().optional(), // inline accounts.json (best for VPS)
  accounts: z.array(accountSchema).default([]), // file-based accounts (optional)
  telegram: z.discriminatedUnion("enabled", [
    z.object({ enabled: z.literal(false) }),
    z.object({
      enabled: z.literal(true),
      botToken: z.string().min(1),
      chatId: z.string().min(1),
    }),
  ]),
});

export type Config = z.infer<typeof configSchema>;
export type QuestDef = z.infer<typeof questSchema>;
export type AccountCfg = z.infer<typeof accountSchema>;

export function parseConfig(raw: unknown): Config {
  return configSchema.parse(raw);
}

export function loadConfig(path = "config.yaml"): Config {
  return parseConfig(yaml.load(readFileSync(path, "utf8")));
}
