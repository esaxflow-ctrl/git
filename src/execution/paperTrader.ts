/**
 * Paper trader. Simulates entries/exits using Jupiter quotes (or supplied
 * snapshot estimates) so the same accounting logic later powers live trading.
 *
 * Accounting model (deliberately simple to be auditable):
 *   - At entry we spend `sizeSol` SOL minus a priority-fee allowance.
 *   - We assume SOL/USD is roughly constant over the (short) hold; PnL_SOL
 *     therefore scales with the USD price ratio of the meme token.
 *   - Slippage and price impact are charged at entry by inflating the
 *     effective entry price.
 *   - tokenAmount is stored in normalised "SOL-equivalent units" (entrySolSpent
 *     divided by adjusted entry price) — used only for reporting and for
 *     computing portion sizes; PnL math works on SOL directly.
 */

import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../config.js';
import type { Db } from '../db/database.js';
import type { JupiterAdapter } from '../adapters/jupiter.js';
import { SOL_MINT_ADDRESS } from '../adapters/jupiter.js';
import type {
  ClosedPosition,
  MasterSignal,
  OpenPosition,
  TokenSnapshot,
} from '../types.js';

export interface PaperEntryInputs {
  cfg: AppConfig;
  signal: MasterSignal;
  snapshot: TokenSnapshot;
  sizeSol: number;
  reasonOpened: string;
  now?: number;
}

export interface PaperEntryResult {
  ok: boolean;
  position?: OpenPosition;
  reason?: string;
}

const PRIORITY_FEE_SOL = 0.000_05;

export class PaperTrader {
  constructor(
    private readonly cfg: AppConfig,
    private readonly db: Db,
    private readonly jupiter: JupiterAdapter,
  ) {}

  async openPosition(input: PaperEntryInputs): Promise<PaperEntryResult> {
    const { signal, snapshot, sizeSol } = input;
    const now = input.now ?? Date.now();
    if (sizeSol <= 0) return { ok: false, reason: 'size 0' };
    if (snapshot.priceUsd <= 0) return { ok: false, reason: 'no price' };

    // Ground entry on a real Jupiter quote when available.
    const lamports = Math.floor(sizeSol * 1_000_000_000);
    const quote = await this.jupiter.getQuote({
      inputMint: SOL_MINT_ADDRESS,
      outputMint: snapshot.address,
      amount: String(lamports),
      slippageBps: this.cfg.MAX_SLIPPAGE_BPS,
    });

    const priceImpactPct = quote?.priceImpactPct ?? snapshot.estPriceImpactPct ?? 0;
    if (priceImpactPct > this.cfg.MAX_PRICE_IMPACT_PERCENT) {
      return { ok: false, reason: `price impact ${priceImpactPct.toFixed(2)}% > limit` };
    }
    const slippageBps = quote?.slippageBps ?? snapshot.estSlippageBps ?? 0;
    if (slippageBps > this.cfg.MAX_SLIPPAGE_BPS) {
      return { ok: false, reason: `slippage ${slippageBps}bps > limit` };
    }

    // Conservative entry price: snapshot price + price impact + half of slippage.
    const adjustedEntryPriceUsd =
      snapshot.priceUsd * (1 + priceImpactPct / 100 + slippageBps / 20_000);
    const effectiveSpend = sizeSol - PRIORITY_FEE_SOL;
    if (effectiveSpend <= 0) return { ok: false, reason: 'size below priority-fee floor' };

    const id = randomUUID();
    const hardStopPriceUsd = adjustedEntryPriceUsd * (1 - this.cfg.HARD_STOP_LOSS_PERCENT / 100);

    const position: OpenPosition = {
      id,
      mode: 'paper',
      token: signal.token,
      strategy: signal.strategy,
      entryTimestamp: now,
      entryPriceUsd: adjustedEntryPriceUsd,
      entrySolSpent: effectiveSpend,
      // SOL-equivalent units used for portion-sizing only; not real token balance.
      tokenAmount: effectiveSpend / adjustedEntryPriceUsd,
      highestPriceUsd: adjustedEntryPriceUsd,
      partialExitsTaken: [],
      trailingStopActive: false,
      hardStopPriceUsd,
      reasonOpened: input.reasonOpened,
      signalSnapshot: signal,
    };

    this.db.insertOpenPosition(position);
    this.db
      .raw()
      .prepare(
        `INSERT INTO paper_trades(id, token_address, symbol, strategy, side, amount_sol, amount_token, price_usd,
         est_slippage_bps, est_price_impact_pct, reason, ts) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        signal.token.address,
        signal.token.symbol,
        signal.strategy,
        'buy',
        sizeSol,
        position.tokenAmount,
        adjustedEntryPriceUsd,
        slippageBps,
        priceImpactPct,
        input.reasonOpened,
        now,
      );

    return { ok: true, position };
  }

  /** Partial or full exit. Returns the ClosedPosition only on full close. */
  async exit(
    position: OpenPosition,
    snapshot: TokenSnapshot,
    fraction: number,
    reason: string,
    now = Date.now(),
  ): Promise<ClosedPosition | null> {
    const portion = Math.max(0, Math.min(1, fraction));
    if (portion === 0) return null;
    if (snapshot.priceUsd <= 0) return null;

    // SOL value of the portion at exit price (constant SOL/USD assumption).
    const portionSolValueAtEntry = position.entrySolSpent * portion;
    const grossSolBack = portionSolValueAtEntry * (snapshot.priceUsd / position.entryPriceUsd);
    const netSolBack = Math.max(0, grossSolBack - PRIORITY_FEE_SOL);

    if (portion >= 0.999) {
      const realisedPnlSol = netSolBack - position.entrySolSpent;
      const realisedPnlPct =
        position.entrySolSpent > 0 ? (realisedPnlSol / position.entrySolSpent) * 100 : 0;
      const closed: ClosedPosition = {
        ...position,
        exitTimestamp: now,
        exitPriceUsd: snapshot.priceUsd,
        exitSolReceived: netSolBack,
        realisedPnlSol,
        realisedPnlPct,
        reasonClosed: reason,
      };
      this.db.insertClosedPosition(closed);
      this.db.deleteOpenPosition(position.id);
      this.recordSell(position, netSolBack, snapshot.priceUsd, reason, now, position.id + '-close');
      return closed;
    }

    // Partial: book the SOL back, reduce the remaining position size.
    position.tokenAmount -= position.tokenAmount * portion;
    position.entrySolSpent -= portionSolValueAtEntry;
    position.partialExitsTaken.push({
      atPct: ((snapshot.priceUsd / position.entryPriceUsd) - 1) * 100,
      fraction: portion,
      executedAt: now,
      priceUsd: snapshot.priceUsd,
    });
    this.db.updateOpenPosition(position);
    this.recordSell(
      position,
      netSolBack,
      snapshot.priceUsd,
      reason,
      now,
      position.id + '-p' + position.partialExitsTaken.length,
    );
    return null;
  }

  private recordSell(
    position: OpenPosition,
    solBack: number,
    priceUsd: number,
    reason: string,
    now: number,
    rowId: string,
  ): void {
    this.db
      .raw()
      .prepare(
        `INSERT INTO paper_trades(id, token_address, symbol, strategy, side, amount_sol, amount_token, price_usd,
         est_slippage_bps, est_price_impact_pct, reason, ts) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        rowId,
        position.token.address,
        position.token.symbol,
        position.strategy,
        'sell',
        solBack,
        position.tokenAmount,
        priceUsd,
        null,
        null,
        reason,
        now,
      );
  }
}
