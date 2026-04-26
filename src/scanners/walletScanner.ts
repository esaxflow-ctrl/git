/**
 * Wallet scanner: pulls recent enhanced transactions for each watched wallet,
 * extracts buys/sells, persists them, and emits "wallet bought token" signals.
 *
 * The smart-wallet seed list is expected to be populated externally (you must
 * decide which wallets to track). The scanner does not auto-discover wallets;
 * that's a separate offline analysis step.
 */

import type { HeliusAdapter } from '../adapters/helius.js';
import type { Db } from '../db/database.js';
import type { WalletTrade, WatchedWallet } from '../types.js';

export interface WalletEntrySignal {
  wallet: WatchedWallet;
  trade: WalletTrade;
  observedAt: number;
}

export class WalletScanner {
  /** Tracks the latest signature seen per wallet to avoid double-processing. */
  private cursor = new Map<string, string>();

  constructor(
    private readonly helius: HeliusAdapter,
    private readonly db: Db,
  ) {}

  async pollOnce(maxPerWallet = 25): Promise<WalletEntrySignal[]> {
    const wallets = this.db.listWatchedWallets();
    const signals: WalletEntrySignal[] = [];
    const now = Date.now();
    for (const w of wallets) {
      try {
        const txs = await this.helius.getEnhancedTransactions(w.address, maxPerWallet);
        const trades = this.helius.parseSwapsToTrades(w.address, txs);
        for (const t of trades) {
          // best-effort dedupe
          this.db
            .raw()
            .prepare(
              `INSERT OR IGNORE INTO wallet_trades(wallet, token_address, side, amount_token, amount_usd, price_usd, signature, block_time)
               VALUES(?,?,?,?,?,?,?,?)`,
            )
            .run(
              t.wallet,
              t.tokenAddress,
              t.side,
              t.amountToken,
              t.amountUsd,
              t.priceUsd,
              t.signature,
              t.blockTime,
            );
          if (t.side === 'buy') {
            signals.push({ wallet: w, trade: t, observedAt: now });
          }
        }
      } catch {
        // swallow per-wallet errors; the loop must continue
      }
    }
    return signals;
  }
}
