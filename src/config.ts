/**
 * Strict env-driven config. Validates invariants up front so the rest of the
 * code can trust its inputs. Live trading requires *both* PAPER_TRADING=false
 * AND LIVE_TRADING=true — accidentally setting one is not enough.
 */

import 'dotenv/config';
import { z } from 'zod';

const boolFromEnv = z
  .union([z.literal('true'), z.literal('false'), z.literal('1'), z.literal('0'), z.literal('')])
  .transform((v) => v === 'true' || v === '1')
  .default('false');

const numFromEnv = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : Number(v)))
    .pipe(z.number().finite());

const strOrEmpty = z.string().optional().default('');

const schema = z.object({
  PAPER_TRADING: boolFromEnv.default('true'),
  LIVE_TRADING: boolFromEnv,
  ENABLE_LIVE_LAUNCHPAD_TRADING: boolFromEnv,

  SOLANA_RPC_URL: strOrEmpty,
  HELIUS_API_KEY: strOrEmpty,
  BIRDEYE_API_KEY: strOrEmpty,
  DEXSCREENER_API_KEY: strOrEmpty,
  X_BEARER_TOKEN: strOrEmpty,
  JUPITER_API_KEY: strOrEmpty,

  WALLET_PUBLIC_KEY: strOrEmpty,
  PRIVATE_KEY_PATH: z.string().default('./keys/trading-wallet.json'),

  MAX_TRADE_SOL: numFromEnv(0.05),
  MAX_WALLET_PERCENT_PER_TRADE: numFromEnv(1),
  MAX_DAILY_LOSS_SOL: numFromEnv(0.2),
  MAX_OPEN_POSITIONS: numFromEnv(3),
  MAX_CONSECUTIVE_LOSSES: numFromEnv(3),
  COOLDOWN_AFTER_LOSS_MINUTES: numFromEnv(20),
  SAFETY_RESERVE_SOL: numFromEnv(0.5),

  MIN_TOKEN_LIQUIDITY_USD: numFromEnv(50_000),
  MIN_VOLUME_5M_USD: numFromEnv(10_000),
  MIN_VOLUME_1H_USD: numFromEnv(50_000),
  MIN_UNIQUE_BUYERS_5M: numFromEnv(20),
  MAX_PRICE_IMPACT_PERCENT: numFromEnv(3),
  MAX_SLIPPAGE_BPS: numFromEnv(300),
  MAX_TOP_10_HOLDER_PERCENT: numFromEnv(35),
  MAX_SINGLE_HOLDER_PERCENT: numFromEnv(10),

  SMART_WALLET_MIN_SCORE: numFromEnv(75),
  BUZZ_SCORE_THRESHOLD: numFromEnv(70),
  EVENT_SCORE_THRESHOLD: numFromEnv(80),
  NARRATIVE_SCORE_THRESHOLD: numFromEnv(70),
  TOKEN_SAFETY_THRESHOLD: numFromEnv(75),
  LIVE_BUY_THRESHOLD: numFromEnv(85),

  COPY_TRADE_MAX_DELAY_SECONDS: numFromEnv(20),
  COPY_TRADE_MAX_MOVE_AFTER_WALLET_ENTRY_PERCENT: numFromEnv(25),

  ENABLE_SMART_WALLET_TRACKING: boolFromEnv.default('true'),
  ENABLE_X_MONITORING: boolFromEnv.default('true'),
  ENABLE_NEWS_EVENTS: boolFromEnv.default('true'),
  ENABLE_PUMPFUN_SCANNER: boolFromEnv.default('true'),
  ENABLE_MIGRATION_SCANNER: boolFromEnv.default('true'),
  ENABLE_DEXSCREENER_TRENDING: boolFromEnv.default('true'),
  ENABLE_NARRATIVE_ROTATION: boolFromEnv.default('true'),

  KILL_SWITCH_FILE: z.string().default('STOP_BOT.txt'),
  DB_PATH: z.string().default('./data/bot.sqlite'),

  PROFIT_LADDER: z.string().default('30:0.33,70:0.33,150:0.33'),
  TRAILING_STOP_PERCENT: numFromEnv(15),
  HARD_STOP_LOSS_PERCENT: numFromEnv(25),
  TIME_BASED_EXIT_MINUTES: numFromEnv(180),
});

export type RawConfig = z.infer<typeof schema>;

export interface ProfitLadderRung {
  pct: number;
  fraction: number;
}

export interface AppConfig extends RawConfig {
  /** Effective live mode — requires *both* flags. */
  liveModeEnabled: boolean;
  profitLadder: ProfitLadderRung[];
}

function parseProfitLadder(raw: string): ProfitLadderRung[] {
  if (!raw.trim()) return [];
  return raw.split(',').map((part) => {
    const [pctStr, fracStr] = part.split(':');
    const pct = Number(pctStr);
    const fraction = Number(fracStr);
    if (!Number.isFinite(pct) || !Number.isFinite(fraction)) {
      throw new Error(`Invalid PROFIT_LADDER entry: "${part}"`);
    }
    if (fraction <= 0 || fraction > 1) {
      throw new Error(`PROFIT_LADDER fraction must be in (0,1]: "${part}"`);
    }
    return { pct, fraction };
  });
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${issues}`);
  }

  const cfg = parsed.data;

  // Invariants
  if (cfg.MAX_WALLET_PERCENT_PER_TRADE <= 0 || cfg.MAX_WALLET_PERCENT_PER_TRADE > 100) {
    throw new Error('MAX_WALLET_PERCENT_PER_TRADE must be in (0, 100]');
  }
  if (cfg.MAX_TRADE_SOL <= 0) {
    throw new Error('MAX_TRADE_SOL must be > 0');
  }
  if (cfg.SAFETY_RESERVE_SOL < 0) {
    throw new Error('SAFETY_RESERVE_SOL cannot be negative');
  }
  if (cfg.MAX_SLIPPAGE_BPS < 0 || cfg.MAX_SLIPPAGE_BPS > 5_000) {
    throw new Error('MAX_SLIPPAGE_BPS must be between 0 and 5000');
  }

  // Hard rule: live mode needs BOTH flags. Refuses ambiguous states.
  const liveModeEnabled = cfg.LIVE_TRADING && !cfg.PAPER_TRADING;
  if (cfg.LIVE_TRADING && cfg.PAPER_TRADING) {
    throw new Error(
      'Ambiguous mode: LIVE_TRADING=true and PAPER_TRADING=true cannot both be set. Set PAPER_TRADING=false to go live.',
    );
  }

  return {
    ...cfg,
    liveModeEnabled,
    profitLadder: parseProfitLadder(cfg.PROFIT_LADDER),
  };
}

/** Singleton accessor — loaded once on first import. */
let _cached: AppConfig | undefined;
export function config(): AppConfig {
  if (!_cached) _cached = loadConfig();
  return _cached;
}

/** For tests: reset the singleton. */
export function _resetConfigForTests(): void {
  _cached = undefined;
}
