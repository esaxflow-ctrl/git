/**
 * Jupiter Swap API adapter.
 *
 * Endpoints (post-2024 Jupiter migration):
 *   - Free / no key:  https://lite-api.jup.ag/swap/v1/quote
 *                     https://lite-api.jup.ag/swap/v1/swap
 *   - Paid / API key: https://api.jup.ag/swap/v1/quote
 *                     https://api.jup.ag/swap/v1/swap
 *
 * The old `quote-api.jup.ag/v6/*` host has been retired and DNS no longer
 * resolves it.
 *
 * We do NOT auto-execute swaps from this adapter. The live executor
 * (`execution/jupiterExecutor.ts`) builds, simulates, and sends transactions
 * with explicit safety wrapping.
 */

import pRetry from 'p-retry';
import type { JupiterQuoteResult } from '../types.js';

const LITE_BASE = 'https://lite-api.jup.ag/swap/v1';
const PRO_BASE = 'https://api.jup.ag/swap/v1';
const SOL_MINT = 'So11111111111111111111111111111111111111112';

export interface JupiterQuoteOptions {
  inputMint: string;
  outputMint: string;
  amount: string;          // raw amount in input mint's smallest unit
  slippageBps: number;     // user-controlled slippage
  swapMode?: 'ExactIn' | 'ExactOut';
  onlyDirectRoutes?: boolean;
}

export class JupiterAdapter {
  private readonly base: string;

  constructor(private readonly apiKey?: string) {
    // Use the paid host only when an API key is configured. Otherwise the
    // free `lite-api.jup.ag` host is used (rate-limited but functional).
    this.base = apiKey ? PRO_BASE : LITE_BASE;
  }

  /** Returns a quote, or null on transient failure. Never throws on missing route. */
  async getQuote(opts: JupiterQuoteOptions): Promise<JupiterQuoteResult | null> {
    const url = new URL(`${this.base}/quote`);
    url.searchParams.set('inputMint', opts.inputMint);
    url.searchParams.set('outputMint', opts.outputMint);
    url.searchParams.set('amount', opts.amount);
    url.searchParams.set('slippageBps', String(opts.slippageBps));
    if (opts.swapMode) url.searchParams.set('swapMode', opts.swapMode);
    if (opts.onlyDirectRoutes) url.searchParams.set('onlyDirectRoutes', 'true');

    try {
      const res = await pRetry(
        () =>
          fetch(url, {
            headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : undefined,
          }).then((r) => {
            if (r.status === 404) return null;       // no route — not retryable
            if (!r.ok) throw new Error(`jupiter quote ${r.status}`);
            return r.json() as Promise<unknown>;
          }),
        { retries: 2, minTimeout: 250 },
      );
      if (!res) return null;
      const j = res as {
        inputMint: string;
        outputMint: string;
        inAmount: string;
        outAmount: string;
        otherAmountThreshold: string;
        priceImpactPct: string | number;
        slippageBps: number;
        routePlan: { swapInfo: { ammKey: string; label: string; inputMint: string; outputMint: string } }[];
        contextSlot: number;
      };
      return {
        inputMint: j.inputMint,
        outputMint: j.outputMint,
        inAmount: j.inAmount,
        outAmount: j.outAmount,
        otherAmountThreshold: j.otherAmountThreshold,
        priceImpactPct: Number(j.priceImpactPct),
        slippageBps: j.slippageBps,
        routePlan: j.routePlan,
        contextSlot: j.contextSlot,
        fetchedAt: Date.now(),
      };
    } catch {
      return null;
    }
  }

  /** Build a swap transaction (base64-encoded VersionedTransaction). Caller signs/sends. */
  async buildSwap(params: {
    quote: JupiterQuoteResult;
    userPublicKey: string;
    wrapAndUnwrapSol?: boolean;
    prioritizationFeeLamports?: number | 'auto';
    dynamicComputeUnitLimit?: boolean;
  }): Promise<{ swapTransaction: string } | null> {
    try {
      const res = await fetch(`${this.base}/swap`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({
          quoteResponse: params.quote,
          userPublicKey: params.userPublicKey,
          wrapAndUnwrapSol: params.wrapAndUnwrapSol ?? true,
          prioritizationFeeLamports: params.prioritizationFeeLamports ?? 'auto',
          dynamicComputeUnitLimit: params.dynamicComputeUnitLimit ?? true,
        }),
      });
      if (!res.ok) return null;
      return (await res.json()) as { swapTransaction: string };
    } catch {
      return null;
    }
  }

  /** Returns true iff a non-trivial route exists for buying `mint` with SOL. */
  async routeAvailable(mint: string, amountLamports = 1_000_000_000): Promise<boolean> {
    if (mint === SOL_MINT) return true;
    const q = await this.getQuote({
      inputMint: SOL_MINT,
      outputMint: mint,
      amount: String(amountLamports),
      slippageBps: 300,
    });
    return q !== null && q.routePlan.length > 0;
  }
}

export const SOL_MINT_ADDRESS = SOL_MINT;
