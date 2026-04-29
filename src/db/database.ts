/**
 * Tiny better-sqlite3 wrapper with typed helpers for the most-used tables.
 * Postgres support can be added by replacing this module — the surface used
 * by the rest of the codebase is intentionally narrow.
 */

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import type {
  ClosedPosition,
  MasterSignal,
  OpenPosition,
  RejectedTrade,
  RiskEvent,
  SafetyLabel,
  TokenSnapshot,
  WatchedWallet,
} from '../types.js';
import { SCHEMA_SQL } from './schema.js';

export class Db {
  private db: Database.Database;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA_SQL);
  }

  close(): void {
    this.db.close();
  }

  raw(): Database.Database {
    return this.db;
  }

  // ----- tokens / snapshots -------------------------------------------------

  upsertToken(address: string, symbol: string, name: string, ts: number): void {
    this.db
      .prepare(
        `INSERT INTO tokens(address, symbol, name, first_seen_at, last_seen_at) VALUES (?,?,?,?,?)
         ON CONFLICT(address) DO UPDATE SET last_seen_at = excluded.last_seen_at,
           symbol = COALESCE(tokens.symbol, excluded.symbol),
           name = COALESCE(tokens.name, excluded.name)`,
      )
      .run(address, symbol, name, ts, ts);
  }

  insertTokenSnapshot(snap: TokenSnapshot): void {
    this.upsertToken(snap.address, snap.symbol, snap.name, snap.fetchedAt);
    this.db
      .prepare(
        `INSERT INTO token_snapshots
         (token_address, fetched_at, pair_address, dex, liquidity_usd, market_cap_usd, fdv_usd,
          price_usd, price_change_5m_pct, price_change_1h_pct, price_change_24h_pct,
          volume_5m_usd, volume_15m_usd, volume_1h_usd, volume_24h_usd,
          buy_count_5m, sell_count_5m, unique_buyers_5m, unique_sellers_5m,
          token_age_minutes, pool_age_minutes, jupiter_quote_available,
          est_price_impact_pct, est_slippage_bps,
          mint_authority_active, freeze_authority_active,
          top10_holder_pct, top_single_holder_pct, raw_json)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        snap.address,
        snap.fetchedAt,
        snap.pairAddress,
        snap.dex,
        snap.liquidityUsd,
        snap.marketCapUsd,
        snap.fdvUsd,
        snap.priceUsd,
        snap.priceChange5mPct,
        snap.priceChange1hPct,
        snap.priceChange24hPct,
        snap.volume5mUsd,
        snap.volume15mUsd,
        snap.volume1hUsd,
        snap.volume24hUsd,
        snap.buyCount5m,
        snap.sellCount5m,
        snap.uniqueBuyers5m,
        snap.uniqueSellers5m,
        snap.tokenAgeMinutes,
        snap.poolAgeMinutes,
        snap.jupiterQuoteAvailable ? 1 : 0,
        snap.estPriceImpactPct,
        snap.estSlippageBps,
        snap.mintAuthorityActive === null ? null : snap.mintAuthorityActive ? 1 : 0,
        snap.freezeAuthorityActive === null ? null : snap.freezeAuthorityActive ? 1 : 0,
        snap.top10HolderPct,
        snap.topSingleHolderPct,
        JSON.stringify(snap),
      );
  }

  getLatestSnapshot(tokenAddress: string): TokenSnapshot | null {
    const row = this.db
      .prepare(
        `SELECT raw_json FROM token_snapshots WHERE token_address = ? ORDER BY fetched_at DESC LIMIT 1`,
      )
      .get(tokenAddress) as { raw_json: string } | undefined;
    if (!row) return null;
    return JSON.parse(row.raw_json) as TokenSnapshot;
  }

  // ----- safety -------------------------------------------------------------

  insertSafetyScore(
    tokenAddress: string,
    score: number,
    label: SafetyLabel,
    reasons: string[],
    ts: number,
  ): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO token_safety_scores(token_address, computed_at, score, label, reasons_json) VALUES(?,?,?,?,?)`,
      )
      .run(tokenAddress, ts, score, label, JSON.stringify(reasons));
  }

  // ----- watched wallets ----------------------------------------------------

  upsertWatchedWallet(w: WatchedWallet): void {
    this.db
      .prepare(
        `INSERT INTO watched_wallets(address, label, score, notes, added_at) VALUES(?,?,?,?,?)
         ON CONFLICT(address) DO UPDATE SET label = excluded.label, score = excluded.score, notes = excluded.notes`,
      )
      .run(w.address, w.label, w.score, w.notes ?? null, w.addedAt);
  }

  /**
   * Recent buys of `tokenAddress` by watched wallets within the last
   * `windowSec` seconds. Returns the wallet record (with score/label) plus
   * the time of the buy. Used to feed `smartWallet` and
   * `smartWalletCluster` sub-scores into the master signal.
   */
  recentSmartWalletBuys(
    tokenAddress: string,
    windowSec = 60 * 60,
    now: number = Date.now(),
  ): Array<{ wallet: WatchedWallet; blockTime: number }> {
    const since = now - windowSec * 1000;
    const rows = this.db
      .prepare(
        `SELECT w.address, w.label, w.score, w.notes, w.added_at, t.block_time
         FROM watched_wallets w
         JOIN wallet_trades t ON t.wallet = w.address
         WHERE t.token_address = ? AND t.side = 'buy' AND t.block_time >= ?
         ORDER BY t.block_time DESC`,
      )
      .all(tokenAddress, since) as Array<{
      address: string;
      label: string;
      score: number;
      notes: string | null;
      added_at: number;
      block_time: number;
    }>;
    return rows.map((r) => ({
      wallet: {
        address: r.address,
        label: r.label as WatchedWallet['label'],
        score: r.score,
        notes: r.notes ?? undefined,
        addedAt: r.added_at,
      },
      blockTime: r.block_time,
    }));
  }

  listWatchedWallets(limit = 1000): WatchedWallet[] {
    const rows = this.db
      .prepare(`SELECT address, label, score, notes, added_at FROM watched_wallets ORDER BY score DESC LIMIT ?`)
      .all(limit) as Array<{
      address: string;
      label: string;
      score: number;
      notes: string | null;
      added_at: number;
    }>;
    return rows.map((r) => ({
      address: r.address,
      label: r.label as WatchedWallet['label'],
      score: r.score,
      notes: r.notes ?? undefined,
      addedAt: r.added_at,
    }));
  }

  // ----- signals ------------------------------------------------------------

  insertCombinedSignal(s: MasterSignal): void {
    this.db
      .prepare(
        `INSERT INTO combined_signals
         (token_address, strategy, master_score, recommendation, breakdown_json, confirmations_json, risks_json, reason, generated_at)
         VALUES(?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        s.token.address,
        s.strategy,
        Math.round(s.masterScore),
        s.recommendation,
        JSON.stringify(s.breakdown),
        JSON.stringify(s.strongestConfirmations),
        JSON.stringify(s.biggestRisks),
        s.reason,
        s.generatedAt,
      );
  }

  // ----- positions ----------------------------------------------------------

  insertOpenPosition(p: OpenPosition): void {
    this.db
      .prepare(
        `INSERT INTO open_positions(id, mode, token_address, symbol, strategy, entry_ts, entry_price_usd, entry_sol_spent,
         token_amount, highest_price_usd, partials_json, trailing_active, hard_stop_price_usd, reason_opened, signal_json)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        p.id,
        p.mode,
        p.token.address,
        p.token.symbol,
        p.strategy,
        p.entryTimestamp,
        p.entryPriceUsd,
        p.entrySolSpent,
        p.tokenAmount,
        p.highestPriceUsd,
        JSON.stringify(p.partialExitsTaken),
        p.trailingStopActive ? 1 : 0,
        p.hardStopPriceUsd,
        p.reasonOpened,
        JSON.stringify(p.signalSnapshot),
      );
  }

  updateOpenPosition(p: OpenPosition): void {
    this.db
      .prepare(
        `UPDATE open_positions SET highest_price_usd = ?, partials_json = ?, trailing_active = ?, hard_stop_price_usd = ?
         WHERE id = ?`,
      )
      .run(
        p.highestPriceUsd,
        JSON.stringify(p.partialExitsTaken),
        p.trailingStopActive ? 1 : 0,
        p.hardStopPriceUsd,
        p.id,
      );
  }

  deleteOpenPosition(id: string): void {
    this.db.prepare(`DELETE FROM open_positions WHERE id = ?`).run(id);
  }

  listOpenPositions(mode?: 'paper' | 'live'): OpenPosition[] {
    const rows = (
      mode
        ? this.db.prepare(`SELECT * FROM open_positions WHERE mode = ?`).all(mode)
        : this.db.prepare(`SELECT * FROM open_positions`).all()
    ) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: r.id as string,
      mode: r.mode as 'paper' | 'live',
      token: { address: r.token_address as string, symbol: r.symbol as string, name: '' },
      strategy: r.strategy as OpenPosition['strategy'],
      entryTimestamp: r.entry_ts as number,
      entryPriceUsd: r.entry_price_usd as number,
      entrySolSpent: r.entry_sol_spent as number,
      tokenAmount: r.token_amount as number,
      highestPriceUsd: r.highest_price_usd as number,
      partialExitsTaken: JSON.parse((r.partials_json as string) ?? '[]'),
      trailingStopActive: !!r.trailing_active,
      hardStopPriceUsd: r.hard_stop_price_usd as number,
      reasonOpened: (r.reason_opened as string) ?? '',
      signalSnapshot: JSON.parse((r.signal_json as string) ?? '{}'),
    }));
  }

  insertClosedPosition(p: ClosedPosition): void {
    this.db
      .prepare(
        `INSERT INTO closed_positions(id, mode, token_address, symbol, strategy, entry_ts, exit_ts, entry_price_usd,
         exit_price_usd, entry_sol_spent, exit_sol_received, realised_pnl_sol, realised_pnl_pct, reason_closed, signal_json)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        p.id,
        p.mode,
        p.token.address,
        p.token.symbol,
        p.strategy,
        p.entryTimestamp,
        p.exitTimestamp,
        p.entryPriceUsd,
        p.exitPriceUsd,
        p.entrySolSpent,
        p.exitSolReceived,
        p.realisedPnlSol,
        p.realisedPnlPct,
        p.reasonClosed,
        JSON.stringify(p.signalSnapshot),
      );
  }

  // ----- rejections ---------------------------------------------------------

  insertRejectedTrade(r: RejectedTrade): void {
    this.db
      .prepare(
        `INSERT INTO rejected_trades(token_address, symbol, strategy, ts, rejection_reason, score_breakdown_json, raw_signal_json)
         VALUES(?,?,?,?,?,?,?)`,
      )
      .run(
        r.tokenAddress,
        r.symbol,
        r.strategy,
        r.timestamp,
        r.rejectionReason,
        JSON.stringify(r.scoreBreakdown),
        JSON.stringify(r.rawSignal),
      );
  }

  countRejectedSince(ts: number): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) as c FROM rejected_trades WHERE ts >= ?`)
      .get(ts) as { c: number };
    return row.c;
  }

  // ----- risk events --------------------------------------------------------

  insertRiskEvent(ev: RiskEvent): void {
    this.db
      .prepare(`INSERT INTO risk_events(kind, ts, detail) VALUES(?,?,?)`)
      .run(ev.kind, ev.timestamp, ev.detail);
  }

  // ----- daily reports / pnl ------------------------------------------------

  realisedPnlSolSince(ts: number, mode: 'paper' | 'live'): number {
    const row = this.db
      .prepare(`SELECT COALESCE(SUM(realised_pnl_sol), 0) as p FROM closed_positions WHERE mode = ? AND exit_ts >= ?`)
      .get(mode, ts) as { p: number };
    return row.p;
  }

  consecutiveLosses(mode: 'paper' | 'live'): number {
    const rows = this.db
      .prepare(
        `SELECT realised_pnl_sol FROM closed_positions WHERE mode = ? ORDER BY exit_ts DESC LIMIT 25`,
      )
      .all(mode) as Array<{ realised_pnl_sol: number }>;
    let streak = 0;
    for (const r of rows) {
      if (r.realised_pnl_sol < 0) streak++;
      else break;
    }
    return streak;
  }

  /**
   * Per-strategy expectancy summary for the given mode.
   *
   * Expectancy = avg PnL per trade (in SOL). Strategies with negative
   * expectancy after >=10 trades should be paused. Surfaced in the
   * dashboard so the user can see at a glance which signals win.
   */
  perStrategyExpectancy(
    mode: 'paper' | 'live',
  ): Array<{
    strategy: string;
    trades: number;
    wins: number;
    netPnlSol: number;
    avgWinSol: number;
    avgLossSol: number;
    winRate: number;
    expectancy: number;
    profitFactor: number;
  }> {
    const rows = this.db
      .prepare(
        `SELECT strategy,
                COUNT(*) as trades,
                SUM(CASE WHEN realised_pnl_sol > 0 THEN 1 ELSE 0 END) as wins,
                COALESCE(SUM(realised_pnl_sol), 0) as net,
                COALESCE(SUM(CASE WHEN realised_pnl_sol > 0 THEN realised_pnl_sol ELSE 0 END), 0) as gross_wins,
                COALESCE(SUM(CASE WHEN realised_pnl_sol < 0 THEN realised_pnl_sol ELSE 0 END), 0) as gross_losses
         FROM closed_positions
         WHERE mode = ?
         GROUP BY strategy
         ORDER BY net DESC`,
      )
      .all(mode) as Array<{
      strategy: string;
      trades: number;
      wins: number;
      net: number;
      gross_wins: number;
      gross_losses: number;
    }>;
    return rows.map((r) => {
      const losses = Math.max(0, r.trades - r.wins);
      const winRate = r.trades > 0 ? r.wins / r.trades : 0;
      const avgWin = r.wins > 0 ? r.gross_wins / r.wins : 0;
      const avgLoss = losses > 0 ? r.gross_losses / losses : 0; // negative
      const expectancy = r.trades > 0 ? r.net / r.trades : 0;
      const profitFactor =
        Math.abs(r.gross_losses) > 0
          ? r.gross_wins / Math.abs(r.gross_losses)
          : r.gross_wins > 0
            ? Infinity
            : 0;
      return {
        strategy: r.strategy,
        trades: r.trades,
        wins: r.wins,
        netPnlSol: r.net,
        avgWinSol: avgWin,
        avgLossSol: avgLoss,
        winRate,
        expectancy,
        profitFactor,
      };
    });
  }

  lastLossTimestamp(mode: 'paper' | 'live'): number | null {
    const row = this.db
      .prepare(
        `SELECT exit_ts FROM closed_positions WHERE mode = ? AND realised_pnl_sol < 0 ORDER BY exit_ts DESC LIMIT 1`,
      )
      .get(mode) as { exit_ts: number } | undefined;
    return row?.exit_ts ?? null;
  }
}
