/**
 * Live trader.
 *
 * Refuses to do anything unless every gate passes:
 *   - cfg.liveModeEnabled (i.e. LIVE_TRADING=true AND PAPER_TRADING=false)
 *   - kill switch off
 *   - risk manager approval
 *   - fresh Jupiter quote
 *   - simulation passes
 *
 * Prints a multi-line warning the first time it's instantiated. NEVER prints
 * the private key. Always logs the route, signature, and (estimated) fees.
 */

import { randomUUID } from 'node:crypto';
import chalk from 'chalk';
import type { AppConfig } from '../config.js';
import type { Db } from '../db/database.js';
import type { JupiterAdapter } from '../adapters/jupiter.js';
import { SOL_MINT_ADDRESS } from '../adapters/jupiter.js';
import type { HeliusAdapter } from '../adapters/helius.js';
import type {
  JupiterQuoteResult,
  MasterSignal,
  OpenPosition,
  TokenSnapshot,
} from '../types.js';
import type { JupiterExecutor } from './jupiterExecutor.js';
import type { RiskManager } from '../risk/riskManager.js';

export interface LiveEntryInputs {
  signal: MasterSignal;
  snapshot: TokenSnapshot;
  sizeSol: number;
  reasonOpened: string;
}

export interface LiveEntryResult {
  ok: boolean;
  position?: OpenPosition;
  signature?: string;
  reason?: string;
}

export class LiveTrader {
  private warned = false;

  constructor(
    private readonly cfg: AppConfig,
    private readonly db: Db,
    private readonly jupiter: JupiterAdapter,
    private readonly executor: JupiterExecutor,
    private readonly helius: HeliusAdapter,
    private readonly risk: RiskManager,
  ) {}

  private warnOnce(): void {
    if (this.warned) return;
    this.warned = true;
    console.log(chalk.bgRed.white.bold('\n  *** LIVE TRADING ENABLED ***  '));
    console.log(
      chalk.red(
        [
          '  Real funds are at risk. The bot will only act when every safety',
          '  gate passes. You can halt it instantly by creating the file:',
          `    ${this.cfg.KILL_SWITCH_FILE}`,
          '  in the project root.',
          '  Trades cap: ' + this.cfg.MAX_TRADE_SOL + ' SOL per trade.',
          '  Daily loss cap: ' + this.cfg.MAX_DAILY_LOSS_SOL + ' SOL.',
          '  Max open positions: ' + this.cfg.MAX_OPEN_POSITIONS,
          '',
        ].join('\n'),
      ),
    );
  }

  async openPosition(input: LiveEntryInputs): Promise<LiveEntryResult> {
    this.warnOnce();

    if (!this.cfg.liveModeEnabled) {
      return { ok: false, reason: 'live mode disabled (LIVE_TRADING=true & PAPER_TRADING=false required)' };
    }

    // Wallet balance + reserve check.
    const balance = await this.helius.getSolBalance(this.cfg.WALLET_PUBLIC_KEY);
    if (balance < this.cfg.SAFETY_RESERVE_SOL + input.sizeSol) {
      return { ok: false, reason: `wallet balance ${balance.toFixed(4)} below reserve+size` };
    }

    // Fresh quote.
    const lamports = Math.floor(input.sizeSol * 1_000_000_000);
    const quote = await this.jupiter.getQuote({
      inputMint: SOL_MINT_ADDRESS,
      outputMint: input.snapshot.address,
      amount: String(lamports),
      slippageBps: this.cfg.MAX_SLIPPAGE_BPS,
    });
    if (!quote) return { ok: false, reason: 'no Jupiter quote' };

    // Final risk gate (last word, even though caller likely already ran it).
    const approval = this.risk.approve({
      signal: input.signal,
      snapshot: input.snapshot,
      quote,
      walletBalanceSol: balance,
      intendedMode: 'live',
      now: Date.now(),
    });
    for (const ev of approval.riskEvents) this.db.insertRiskEvent(ev);
    if (!approval.approved) {
      return { ok: false, reason: approval.reasons.join('; ') };
    }

    const exec = await this.executor.execute({ quote, priorityFeeLamports: 'auto' });
    if (!exec.ok || !exec.signature) {
      this.db.insertRiskEvent({
        kind: 'quote_failure',
        timestamp: Date.now(),
        detail: exec.error ?? 'unknown',
      });
      return { ok: false, reason: exec.error ?? 'execution failed' };
    }

    const id = randomUUID();
    const now = Date.now();
    const adjustedEntryPriceUsd =
      input.snapshot.priceUsd * (1 + quote.priceImpactPct / 100 + quote.slippageBps / 20_000);

    const position: OpenPosition = {
      id,
      mode: 'live',
      token: input.signal.token,
      strategy: input.signal.strategy,
      entryTimestamp: now,
      entryPriceUsd: adjustedEntryPriceUsd,
      entrySolSpent: input.sizeSol,
      tokenAmount: Number(quote.outAmount),
      highestPriceUsd: adjustedEntryPriceUsd,
      partialExitsTaken: [],
      trailingStopActive: false,
      hardStopPriceUsd: adjustedEntryPriceUsd * (1 - this.cfg.HARD_STOP_LOSS_PERCENT / 100),
      reasonOpened: input.reasonOpened,
      signalSnapshot: input.signal,
    };
    this.db.insertOpenPosition(position);

    this.db
      .raw()
      .prepare(
        `INSERT INTO live_trades(id, signature, token_address, symbol, strategy, side, amount_sol, amount_token, price_usd,
         slippage_bps, price_impact_pct, fees_sol, route_json, reason, status, ts) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        exec.signature,
        input.signal.token.address,
        input.signal.token.symbol,
        input.signal.strategy,
        'buy',
        input.sizeSol,
        Number(quote.outAmount),
        adjustedEntryPriceUsd,
        quote.slippageBps,
        quote.priceImpactPct,
        (exec.feesPaidLamports ?? 0) / 1_000_000_000,
        JSON.stringify(quote.routePlan),
        input.reasonOpened,
        'confirmed',
        now,
      );

    return { ok: true, position, signature: exec.signature };
  }

  /** Simple sell — reverse direction quote, execute. Caller manages partials. */
  async closePosition(
    position: OpenPosition,
    snapshot: TokenSnapshot,
    fraction: number,
    reason: string,
  ): Promise<{ ok: boolean; signature?: string; error?: string }> {
    this.warnOnce();
    if (position.mode !== 'live') return { ok: false, error: 'not a live position' };
    const portion = Math.max(0, Math.min(1, fraction));
    if (portion <= 0) return { ok: false, error: 'fraction <= 0' };

    // For simplicity we close the full SOL value of the portion via a SOL-denominated reverse quote.
    // Real Jupiter sell would quote ExactIn over the token amount; that requires correct decimals.
    // Production deployments must adapt to actual token balances — this is documented in README.
    const quote = await this.jupiter.getQuote({
      inputMint: snapshot.address,
      outputMint: SOL_MINT_ADDRESS,
      amount: String(Math.floor(position.tokenAmount * portion)),
      slippageBps: this.cfg.MAX_SLIPPAGE_BPS,
    });
    if (!quote) return { ok: false, error: 'no reverse quote' };
    const exec = await this.executor.execute({ quote });
    if (!exec.ok) return { ok: false, error: exec.error ?? 'sell exec failed' };

    void reason;
    return { ok: true, signature: exec.signature };
  }
}
