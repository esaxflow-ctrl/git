/**
 * Test helpers — shared fixtures.
 */

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { Db } from '../db/database.js';
import { _resetConfigForTests, loadConfig, type AppConfig } from '../config.js';
import type { TokenSnapshot, MasterSignal } from '../types.js';
import { emptyBreakdown } from '../scoring/masterSignalScore.js';

export function makeTempDb(): Db {
  const dir = mkdtempSync(join(tmpdir(), 'memebot-'));
  const path = join(dir, 'test.sqlite');
  return new Db(path);
}

export function testConfig(overrides: Partial<NodeJS.ProcessEnv> = {}): AppConfig {
  _resetConfigForTests();
  const env: NodeJS.ProcessEnv = {
    PAPER_TRADING: 'true',
    LIVE_TRADING: 'false',
    SOLANA_RPC_URL: '',
    HELIUS_API_KEY: '',
    BIRDEYE_API_KEY: '',
    DEXSCREENER_API_KEY: '',
    X_BEARER_TOKEN: '',
    JUPITER_API_KEY: '',
    WALLET_PUBLIC_KEY: '',
    PRIVATE_KEY_PATH: './keys/test.json',
    MAX_TRADE_SOL: '0.05',
    MAX_WALLET_PERCENT_PER_TRADE: '1',
    MAX_DAILY_LOSS_SOL: '0.2',
    MAX_OPEN_POSITIONS: '3',
    MAX_CONSECUTIVE_LOSSES: '3',
    COOLDOWN_AFTER_LOSS_MINUTES: '20',
    SAFETY_RESERVE_SOL: '0.5',
    MIN_TOKEN_LIQUIDITY_USD: '50000',
    MIN_VOLUME_5M_USD: '10000',
    MIN_VOLUME_1H_USD: '50000',
    MIN_UNIQUE_BUYERS_5M: '20',
    MAX_PRICE_IMPACT_PERCENT: '3',
    MAX_SLIPPAGE_BPS: '300',
    MAX_TOP_10_HOLDER_PERCENT: '35',
    MAX_SINGLE_HOLDER_PERCENT: '10',
    SMART_WALLET_MIN_SCORE: '75',
    BUZZ_SCORE_THRESHOLD: '70',
    EVENT_SCORE_THRESHOLD: '80',
    NARRATIVE_SCORE_THRESHOLD: '70',
    TOKEN_SAFETY_THRESHOLD: '75',
    LIVE_BUY_THRESHOLD: '85',
    COPY_TRADE_MAX_DELAY_SECONDS: '20',
    COPY_TRADE_MAX_MOVE_AFTER_WALLET_ENTRY_PERCENT: '25',
    KILL_SWITCH_FILE: join(tmpdir(), `STOP_BOT_${Date.now()}_${Math.random()}.txt`),
    DB_PATH: ':memory:',
    PROFIT_LADDER: '50:0.25,100:0.25,200:0.25',
    TRAILING_STOP_PERCENT: '20',
    HARD_STOP_LOSS_PERCENT: '35',
    TIME_BASED_EXIT_MINUTES: '180',
    ...overrides,
  };
  return loadConfig(env);
}

export function fakeSnapshot(overrides: Partial<TokenSnapshot> = {}): TokenSnapshot {
  const now = Date.now();
  return {
    address: 'So11111111111111111111111111111111111111112FAKE',
    symbol: 'FAKE',
    name: 'Fake Token',
    pairAddress: 'pair1',
    dex: 'raydium',
    liquidityUsd: 250_000,
    marketCapUsd: 2_000_000,
    fdvUsd: 2_000_000,
    priceUsd: 0.001,
    priceChange5mPct: 5,
    priceChange1hPct: 20,
    priceChange24hPct: 50,
    volume5mUsd: 30_000,
    volume15mUsd: 80_000,
    volume1hUsd: 250_000,
    volume24hUsd: 1_000_000,
    buyCount5m: 60,
    sellCount5m: 30,
    uniqueBuyers5m: 40,
    uniqueSellers5m: 20,
    tokenAgeMinutes: 60,
    poolAgeMinutes: 60,
    jupiterQuoteAvailable: true,
    estPriceImpactPct: 1.0,
    estSlippageBps: 100,
    mintAuthorityActive: false,
    freezeAuthorityActive: false,
    top10HolderPct: 20,
    topSingleHolderPct: 5,
    fetchedAt: now,
    ...overrides,
  };
}

export function fakeSignal(overrides: Partial<MasterSignal> = {}): MasterSignal {
  return {
    token: { address: 'fake-mint', symbol: 'FAKE', name: 'Fake' },
    strategy: 'volume_acceleration',
    masterScore: 90,
    breakdown: { ...emptyBreakdown(), tokenSafety: 90, volumeAcceleration: 90, smartWallet: 80, buzz: 80, riskManagerApproved: true },
    strongestConfirmations: ['safety high', 'buzz high', 'volume up'],
    biggestRisks: [],
    recommendation: 'LIVE_BUY_ALLOWED',
    generatedAt: Date.now(),
    reason: 'test',
    ...overrides,
  };
}
