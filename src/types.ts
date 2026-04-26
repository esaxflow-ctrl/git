/**
 * Shared types used across the framework. Kept in one file deliberately —
 * cross-module consistency is more important here than locality.
 */

// ----- Core token / market data ---------------------------------------------

export type SafetyLabel =
  | 'SAFE_ENOUGH_TO_WATCH'
  | 'HIGH_RISK'
  | 'RUG_RISK'
  | 'FAKE_CONTRACT_RISK'
  | 'LOW_LIQUIDITY'
  | 'TOO_MUCH_HOLDER_CONCENTRATION'
  | 'CANNOT_EXECUTE'
  | 'PASS_ONLY';

export type WalletLabel =
  | 'ELITE_COPYABLE'
  | 'GOOD_BUT_RISKY'
  | 'INSIDER_LIKELY'
  | 'DEV_WALLET_LIKELY'
  | 'SNIPER_BOT'
  | 'TOO_FAST_TO_COPY'
  | 'LOW_QUALITY'
  | 'IGNORE';

export type BuzzSignalType =
  | 'EARLY_BUZZ'
  | 'VIRAL_ACCELERATION'
  | 'OFFICIAL_ANNOUNCEMENT'
  | 'CONTRACT_ADDRESS_TRENDING'
  | 'FAKE_CONTRACT_RISK'
  | 'INFLUENCER_PUMP_RISK'
  | 'NEWS_CATALYST'
  | 'EXHAUSTION_RISK';

export type EventSignalType =
  | 'VERIFIED_MAJOR_LAUNCH'
  | 'POSSIBLE_MAJOR_LAUNCH'
  | 'FAKE_LAUNCH_RISK'
  | 'EXCHANGE_LISTING'
  | 'OFFICIAL_CONTRACT_POSTED'
  | 'LIQUIDITY_ADDED'
  | 'SOCIAL_EXPLOSION'
  | 'TOO_LATE_PASS';

export type BoostSignal =
  | 'ORGANIC_TRENDING'
  | 'PAID_BOOST_CONFIRMED'
  | 'PAID_BOOST_NO_CONFIRMATION'
  | 'HYPE_WITHOUT_VOLUME'
  | 'PASS';

export type Recommendation =
  | 'PASS'
  | 'WATCH'
  | 'PAPER_BUY'
  | 'LIVE_BUY_ALLOWED'
  | 'EMERGENCY_EXIT';

export type StrategySource =
  | 'smart_wallet_cluster'
  | 'pumpfun_bonding_curve'
  | 'migration'
  | 'liquidity_growth'
  | 'volume_acceleration'
  | 'x_buzz'
  | 'official_announcement'
  | 'narrative_rotation';

export type DexId =
  | 'raydium'
  | 'pumpswap'
  | 'orca'
  | 'meteora'
  | 'pump_fun_curve'
  | 'unknown';

// ----- Token snapshot --------------------------------------------------------

export interface TokenIdentity {
  address: string;        // SPL mint address
  symbol: string;
  name: string;
}

export interface TokenSnapshot extends TokenIdentity {
  pairAddress: string | null;
  dex: DexId;
  liquidityUsd: number;
  marketCapUsd: number;
  fdvUsd: number;
  priceUsd: number;
  priceChange5mPct: number;
  priceChange1hPct: number;
  priceChange24hPct: number;
  volume5mUsd: number;
  volume15mUsd: number;
  volume1hUsd: number;
  volume24hUsd: number;
  buyCount5m: number;
  sellCount5m: number;
  uniqueBuyers5m: number;
  uniqueSellers5m: number;
  tokenAgeMinutes: number;
  poolAgeMinutes: number;
  jupiterQuoteAvailable: boolean;
  estPriceImpactPct: number | null;
  estSlippageBps: number | null;
  // Authority flags — null when adapter could not determine.
  mintAuthorityActive: boolean | null;
  freezeAuthorityActive: boolean | null;
  top10HolderPct: number | null;
  topSingleHolderPct: number | null;
  fetchedAt: number;       // unix ms
}

// ----- Wallet tracking -------------------------------------------------------

export interface WatchedWallet {
  address: string;
  label: WalletLabel;
  score: number; // 0–100
  notes?: string;
  addedAt: number;
}

export interface WalletTrade {
  wallet: string;
  tokenAddress: string;
  side: 'buy' | 'sell';
  amountToken: number;
  amountUsd: number;
  priceUsd: number;
  signature: string;
  blockTime: number;
}

export interface WalletScoreBreakdown {
  realisedPnl7d: number;
  realisedPnl30d: number;
  realisedPnl90d: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  expectancy: number;
  maxDrawdown: number;
  trades: number;
  avgEntryMcUsd: number;
  avgExitMcUsd: number;
  avgHoldMinutes: number;
  earlyEntryRate: number;
  liquidityAdjustedPnl: number;
  repeatabilityScore: number;
  copyabilityScore: number;
  rugExposure: number;
  suspiciousBehaviourScore: number;
  rawScore: number;
}

// ----- Scoring outputs -------------------------------------------------------

export interface ScoreBreakdown {
  // Each component is 0–100 and contributes to a weighted master score.
  tokenSafety: number;
  smartWallet: number;
  smartWalletCluster: number;
  buzz: number;
  event: number;
  pumpfun: number;
  migration: number;
  liquidityGrowth: number;
  volumeAcceleration: number;
  dexscreenerBoost: number;
  narrative: number;
  jupiterExecutionQuality: number;
  tooLatePenalty: number;     // higher = more late
  riskManagerApproved: boolean;
}

export interface MasterSignal {
  token: TokenIdentity;
  strategy: StrategySource;
  masterScore: number;            // 0–100
  breakdown: ScoreBreakdown;
  strongestConfirmations: string[];
  biggestRisks: string[];
  recommendation: Recommendation;
  generatedAt: number;
  reason: string;                 // human-readable explanation
}

// ----- Strategy outputs ------------------------------------------------------

export interface StrategySignal {
  strategy: StrategySource;
  token: TokenIdentity;
  score: number;                  // 0–100
  confirmations: string[];
  warnings: string[];
  recommendation: Recommendation;
  raw?: Record<string, unknown>;
}

// ----- Trade records ---------------------------------------------------------

export interface OpenPosition {
  id: string;
  mode: 'paper' | 'live';
  token: TokenIdentity;
  strategy: StrategySource;
  entryTimestamp: number;
  entryPriceUsd: number;
  entrySolSpent: number;
  tokenAmount: number;
  highestPriceUsd: number;
  partialExitsTaken: { atPct: number; fraction: number; executedAt: number; priceUsd: number }[];
  trailingStopActive: boolean;
  hardStopPriceUsd: number;
  reasonOpened: string;
  signalSnapshot: MasterSignal;
}

export interface ClosedPosition extends OpenPosition {
  exitTimestamp: number;
  exitPriceUsd: number;
  exitSolReceived: number;
  realisedPnlSol: number;
  realisedPnlPct: number;
  reasonClosed: string;
}

export interface RejectedTrade {
  tokenAddress: string;
  symbol: string;
  strategy: StrategySource;
  timestamp: number;
  rejectionReason: string;
  scoreBreakdown: ScoreBreakdown;
  rawSignal: Record<string, unknown>;
}

// ----- Risk events -----------------------------------------------------------

export type RiskEventKind =
  | 'kill_switch_engaged'
  | 'daily_loss_limit'
  | 'consecutive_loss_cooldown'
  | 'wallet_below_reserve'
  | 'max_open_positions'
  | 'rpc_unstable'
  | 'quote_failure'
  | 'price_impact_exceeded'
  | 'slippage_exceeded'
  | 'live_disabled';

export interface RiskEvent {
  kind: RiskEventKind;
  timestamp: number;
  detail: string;
}

// ----- Jupiter quote (subset we care about) ----------------------------------

export interface JupiterQuoteResult {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  priceImpactPct: number;
  slippageBps: number;
  routePlan: { swapInfo: { ammKey: string; label: string; inputMint: string; outputMint: string } }[];
  contextSlot: number;
  fetchedAt: number;
}

// ----- News / event sources --------------------------------------------------

export interface XPostMeta {
  id: string;
  authorId: string;
  authorHandle: string;
  authorVerified: boolean;
  authorFollowers: number;
  text: string;
  createdAt: number;
  retweets: number;
  likes: number;
  quotes: number;
  replies: number;
  containedAddresses: string[];
  containedCashtags: string[];
}

export interface NewsEvent {
  id: string;
  source: string;
  title: string;
  body: string;
  url: string | null;
  tokens: string[];
  publishedAt: number;
  credibility: number; // 0–100
}

// ----- Backtest --------------------------------------------------------------

export interface BacktestRun {
  id: string;
  startedAt: number;
  finishedAt: number;
  config: Record<string, unknown>;
  totalTrades: number;
  winRate: number;
  netPnlSol: number;
  maxDrawdown: number;
  bestTradePnl: number;
  worstTradePnl: number;
  avgHoldMinutes: number;
  expectancy: number;
  profitFactor: number;
  perStrategy: Record<string, { trades: number; winRate: number; netPnlSol: number }>;
}
