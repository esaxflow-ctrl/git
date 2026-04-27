/**
 * SQLite schema. Designed to also work with Postgres with minor type swaps
 * (TEXT/INTEGER -> VARCHAR/BIGINT). Stored as a single string so the schema
 * is committed alongside the code.
 *
 * Every rejected trade row contains:
 *   - token address
 *   - token symbol
 *   - strategy
 *   - timestamp
 *   - rejection reason (human-readable)
 *   - score breakdown (JSON)
 *   - raw signal data (JSON)
 */

export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tokens (
  address TEXT PRIMARY KEY,
  symbol TEXT,
  name TEXT,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tokens_last_seen ON tokens(last_seen_at);

CREATE TABLE IF NOT EXISTS token_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_address TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  pair_address TEXT,
  dex TEXT,
  liquidity_usd REAL,
  market_cap_usd REAL,
  fdv_usd REAL,
  price_usd REAL,
  price_change_5m_pct REAL,
  price_change_1h_pct REAL,
  price_change_24h_pct REAL,
  volume_5m_usd REAL,
  volume_15m_usd REAL,
  volume_1h_usd REAL,
  volume_24h_usd REAL,
  buy_count_5m INTEGER,
  sell_count_5m INTEGER,
  unique_buyers_5m INTEGER,
  unique_sellers_5m INTEGER,
  token_age_minutes REAL,
  pool_age_minutes REAL,
  jupiter_quote_available INTEGER,
  est_price_impact_pct REAL,
  est_slippage_bps REAL,
  mint_authority_active INTEGER,
  freeze_authority_active INTEGER,
  top10_holder_pct REAL,
  top_single_holder_pct REAL,
  raw_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_snap_token ON token_snapshots(token_address, fetched_at DESC);

CREATE TABLE IF NOT EXISTS token_safety_scores (
  token_address TEXT NOT NULL,
  computed_at INTEGER NOT NULL,
  score INTEGER NOT NULL,
  label TEXT NOT NULL,
  reasons_json TEXT NOT NULL,
  PRIMARY KEY (token_address, computed_at)
);

CREATE TABLE IF NOT EXISTS watched_wallets (
  address TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  score INTEGER NOT NULL,
  notes TEXT,
  added_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS wallet_trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet TEXT NOT NULL,
  token_address TEXT NOT NULL,
  side TEXT NOT NULL,
  amount_token REAL,
  amount_usd REAL,
  price_usd REAL,
  signature TEXT NOT NULL,
  block_time INTEGER NOT NULL,
  UNIQUE(signature, wallet, token_address, side)
);
CREATE INDEX IF NOT EXISTS idx_walltrades_token ON wallet_trades(token_address, block_time DESC);
CREATE INDEX IF NOT EXISTS idx_walltrades_wallet ON wallet_trades(wallet, block_time DESC);

CREATE TABLE IF NOT EXISTS wallet_scores (
  wallet TEXT NOT NULL,
  computed_at INTEGER NOT NULL,
  score INTEGER NOT NULL,
  breakdown_json TEXT NOT NULL,
  PRIMARY KEY (wallet, computed_at)
);

CREATE TABLE IF NOT EXISTS wallet_labels (
  wallet TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS social_mentions (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  author_id TEXT,
  author_handle TEXT,
  author_followers INTEGER,
  author_verified INTEGER,
  text TEXT,
  created_at INTEGER NOT NULL,
  retweets INTEGER,
  likes INTEGER,
  quotes INTEGER,
  replies INTEGER,
  contained_addresses TEXT,
  contained_cashtags TEXT
);
CREATE INDEX IF NOT EXISTS idx_mentions_created ON social_mentions(created_at DESC);

CREATE TABLE IF NOT EXISTS x_accounts (
  account_id TEXT PRIMARY KEY,
  handle TEXT NOT NULL,
  category TEXT NOT NULL,
  credibility INTEGER NOT NULL,
  notes TEXT,
  added_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS buzz_scores (
  token_address TEXT NOT NULL,
  computed_at INTEGER NOT NULL,
  score INTEGER NOT NULL,
  signal_type TEXT,
  breakdown_json TEXT,
  PRIMARY KEY (token_address, computed_at)
);

CREATE TABLE IF NOT EXISTS news_events (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  title TEXT,
  body TEXT,
  url TEXT,
  tokens_json TEXT,
  published_at INTEGER NOT NULL,
  credibility INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS event_sources (
  source TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  credibility INTEGER NOT NULL,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS narratives (
  name TEXT PRIMARY KEY,
  description TEXT,
  keywords_json TEXT
);

CREATE TABLE IF NOT EXISTS narrative_scores (
  narrative TEXT NOT NULL,
  computed_at INTEGER NOT NULL,
  score INTEGER NOT NULL,
  breakdown_json TEXT,
  PRIMARY KEY (narrative, computed_at)
);

CREATE TABLE IF NOT EXISTS liquidity_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_address TEXT NOT NULL,
  pair_address TEXT,
  kind TEXT NOT NULL, -- added | removed | drained
  delta_usd REAL,
  total_after_usd REAL,
  detected_at INTEGER NOT NULL,
  raw_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_liqevt_token ON liquidity_events(token_address, detected_at DESC);

CREATE TABLE IF NOT EXISTS migration_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_address TEXT NOT NULL,
  from_venue TEXT,
  to_venue TEXT,
  pair_address TEXT,
  detected_at INTEGER NOT NULL,
  raw_json TEXT
);

CREATE TABLE IF NOT EXISTS dexscreener_boosts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_address TEXT NOT NULL,
  amount INTEGER,
  total_amount INTEGER,
  observed_at INTEGER NOT NULL,
  raw_json TEXT
);

CREATE TABLE IF NOT EXISTS token_signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_address TEXT NOT NULL,
  strategy TEXT NOT NULL,
  score INTEGER NOT NULL,
  recommendation TEXT NOT NULL,
  confirmations_json TEXT,
  warnings_json TEXT,
  raw_json TEXT,
  generated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_signals_token ON token_signals(token_address, generated_at DESC);

CREATE TABLE IF NOT EXISTS combined_signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_address TEXT NOT NULL,
  strategy TEXT NOT NULL,
  master_score INTEGER NOT NULL,
  recommendation TEXT NOT NULL,
  breakdown_json TEXT NOT NULL,
  confirmations_json TEXT,
  risks_json TEXT,
  reason TEXT,
  generated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_combined_token ON combined_signals(token_address, generated_at DESC);

CREATE TABLE IF NOT EXISTS paper_trades (
  id TEXT PRIMARY KEY,
  token_address TEXT NOT NULL,
  symbol TEXT,
  strategy TEXT NOT NULL,
  side TEXT NOT NULL,
  amount_sol REAL,
  amount_token REAL,
  price_usd REAL,
  est_slippage_bps REAL,
  est_price_impact_pct REAL,
  reason TEXT,
  ts INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS live_trades (
  id TEXT PRIMARY KEY,
  signature TEXT,
  token_address TEXT NOT NULL,
  symbol TEXT,
  strategy TEXT NOT NULL,
  side TEXT NOT NULL,
  amount_sol REAL,
  amount_token REAL,
  price_usd REAL,
  slippage_bps REAL,
  price_impact_pct REAL,
  fees_sol REAL,
  route_json TEXT,
  reason TEXT,
  status TEXT,
  ts INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS open_positions (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  token_address TEXT NOT NULL,
  symbol TEXT,
  strategy TEXT,
  entry_ts INTEGER NOT NULL,
  entry_price_usd REAL,
  entry_sol_spent REAL,
  token_amount REAL,
  highest_price_usd REAL,
  partials_json TEXT,
  trailing_active INTEGER,
  hard_stop_price_usd REAL,
  reason_opened TEXT,
  signal_json TEXT
);

CREATE TABLE IF NOT EXISTS closed_positions (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  token_address TEXT NOT NULL,
  symbol TEXT,
  strategy TEXT,
  entry_ts INTEGER NOT NULL,
  exit_ts INTEGER NOT NULL,
  entry_price_usd REAL,
  exit_price_usd REAL,
  entry_sol_spent REAL,
  exit_sol_received REAL,
  realised_pnl_sol REAL,
  realised_pnl_pct REAL,
  reason_closed TEXT,
  signal_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_closed_ts ON closed_positions(exit_ts DESC);

CREATE TABLE IF NOT EXISTS rejected_trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_address TEXT NOT NULL,
  symbol TEXT,
  strategy TEXT NOT NULL,
  ts INTEGER NOT NULL,
  rejection_reason TEXT NOT NULL,
  score_breakdown_json TEXT NOT NULL,
  raw_signal_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rejected_ts ON rejected_trades(ts DESC);

CREATE TABLE IF NOT EXISTS risk_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  ts INTEGER NOT NULL,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS idx_risk_ts ON risk_events(ts DESC);

CREATE TABLE IF NOT EXISTS daily_reports (
  date TEXT PRIMARY KEY,
  trades INTEGER,
  wins INTEGER,
  losses INTEGER,
  net_pnl_sol REAL,
  max_drawdown REAL,
  rejected_count INTEGER,
  emergency_exits INTEGER,
  generated_at INTEGER NOT NULL
);

-- ----- Wallet auto-discovery -------------------------------------------------
-- Each row: a wallet was observed buying a token at first_buy_ts. Used to
-- promote candidates into watched_wallets after they appear across multiple
-- tokens. Includes a snapshot of the token's market cap at buy time so we can
-- approximate "how early" they entered.
CREATE TABLE IF NOT EXISTS wallet_observations (
  wallet TEXT NOT NULL,
  token_address TEXT NOT NULL,
  first_buy_ts INTEGER NOT NULL,
  pool_age_at_buy_seconds INTEGER,
  buy_price_usd REAL,
  buy_market_cap_usd REAL,
  later_max_market_cap_usd REAL,
  approx_pnl_pct REAL,
  signature TEXT,
  PRIMARY KEY (wallet, token_address)
);
CREATE INDEX IF NOT EXISTS idx_walobs_wallet ON wallet_observations(wallet, first_buy_ts DESC);
CREATE INDEX IF NOT EXISTS idx_walobs_token ON wallet_observations(token_address, first_buy_ts ASC);

-- Cache of tokens we've already scanned for early buyers so the discovery
-- loop doesn't re-fetch the same pool over and over.
CREATE TABLE IF NOT EXISTS examined_pools (
  token_address TEXT PRIMARY KEY,
  pair_address TEXT,
  examined_at INTEGER NOT NULL,
  early_buyers_seen INTEGER NOT NULL DEFAULT 0
);

-- Per-(wallet, token) realised PnL accumulator. Updated each time we observe
-- a buy or sell for that wallet on that token in pool transactions. SOL
-- amounts are derived from the swap's nativeTransfers. realised_pnl_sol is
-- only meaningful once both sides exist; for buy-only positions it's null
-- (we'd need an oracle to value the still-held bag).
CREATE TABLE IF NOT EXISTS wallet_token_pnl (
  wallet TEXT NOT NULL,
  token_address TEXT NOT NULL,
  total_buy_sol REAL NOT NULL DEFAULT 0,
  total_sell_sol REAL NOT NULL DEFAULT 0,
  total_buys INTEGER NOT NULL DEFAULT 0,
  total_sells INTEGER NOT NULL DEFAULT 0,
  first_buy_ts INTEGER,
  last_sell_ts INTEGER,
  realised_pnl_sol REAL,
  PRIMARY KEY (wallet, token_address)
);
CREATE INDEX IF NOT EXISTS idx_wtpnl_wallet ON wallet_token_pnl(wallet);

-- Aggregated wallet-level realised PnL summary. Refreshed when we promote.
CREATE TABLE IF NOT EXISTS wallet_pnl_summary (
  wallet TEXT PRIMARY KEY,
  tokens_with_realised INTEGER NOT NULL DEFAULT 0,
  net_realised_pnl_sol REAL NOT NULL DEFAULT 0,
  win_rate REAL,
  avg_hold_minutes REAL,
  updated_at INTEGER NOT NULL
);
`;
