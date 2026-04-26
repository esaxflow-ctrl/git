/**
 * Helius adapter.
 *
 * Provides:
 *   - RPC connection (just a configured @solana/web3.js Connection)
 *   - Enhanced Transactions parsing for wallet activity
 *   - Token holder lookups (getTokenLargestAccounts via RPC)
 *   - Mint authority / freeze authority checks (getAccountInfo)
 *
 * Webhook subscription is sketched but not auto-created here — production
 * deployments should manage webhooks out-of-band.
 */

import { Connection, PublicKey } from '@solana/web3.js';
import pRetry from 'p-retry';
import type { WalletTrade } from '../types.js';

const ENHANCED_TX_URL = 'https://api.helius.xyz/v0/addresses';

export class HeliusAdapter {
  readonly connection: Connection;

  constructor(
    private readonly apiKey: string,
    rpcUrl?: string,
  ) {
    const url =
      rpcUrl ||
      (apiKey ? `https://mainnet.helius-rpc.com/?api-key=${apiKey}` : 'https://api.mainnet-beta.solana.com');
    this.connection = new Connection(url, 'confirmed');
  }

  /** Pull recent enhanced transactions for an address (paginated by `before`). */
  async getEnhancedTransactions(address: string, limit = 50, before?: string): Promise<unknown[]> {
    if (!this.apiKey) return [];
    const url = new URL(`${ENHANCED_TX_URL}/${address}/transactions`);
    url.searchParams.set('api-key', this.apiKey);
    url.searchParams.set('limit', String(limit));
    if (before) url.searchParams.set('before', before);
    return pRetry(
      async () => {
        const r = await fetch(url);
        if (!r.ok) throw new Error(`helius enhanced ${r.status}`);
        return (await r.json()) as unknown[];
      },
      { retries: 2 },
    );
  }

  /**
   * Best-effort parse of an enhanced-tx list into wallet trades.
   * Helius' SWAP type carries `tokenTransfers` and `nativeTransfers`. We only
   * care about SOL <-> SPL swaps; everything else is ignored.
   */
  parseSwapsToTrades(wallet: string, txs: unknown[]): WalletTrade[] {
    const out: WalletTrade[] = [];
    for (const raw of txs) {
      const tx = raw as {
        type?: string;
        signature?: string;
        timestamp?: number;
        events?: { swap?: unknown };
        tokenTransfers?: Array<{
          fromUserAccount?: string;
          toUserAccount?: string;
          mint?: string;
          tokenAmount?: number;
        }>;
        nativeTransfers?: Array<{ fromUserAccount?: string; toUserAccount?: string; amount?: number }>;
      };
      if (tx.type !== 'SWAP' || !tx.signature) continue;

      const blockTime = (tx.timestamp ?? 0) * 1000;
      const tokenTransfers = tx.tokenTransfers ?? [];
      const incoming = tokenTransfers.find((t) => t.toUserAccount === wallet);
      const outgoing = tokenTransfers.find((t) => t.fromUserAccount === wallet);

      // Side detection: incoming non-SOL token while outgoing is SOL = buy.
      // Helius uses native transfers for SOL movements.
      const nativeOut = (tx.nativeTransfers ?? []).find(
        (n) => n.fromUserAccount === wallet && (n.amount ?? 0) > 0,
      );
      const nativeIn = (tx.nativeTransfers ?? []).find(
        (n) => n.toUserAccount === wallet && (n.amount ?? 0) > 0,
      );

      if (incoming && nativeOut) {
        out.push({
          wallet,
          tokenAddress: incoming.mint ?? '',
          side: 'buy',
          amountToken: incoming.tokenAmount ?? 0,
          amountUsd: 0, // requires price oracle to fill in; downstream may enrich
          priceUsd: 0,
          signature: tx.signature,
          blockTime,
        });
      } else if (outgoing && nativeIn) {
        out.push({
          wallet,
          tokenAddress: outgoing.mint ?? '',
          side: 'sell',
          amountToken: outgoing.tokenAmount ?? 0,
          amountUsd: 0,
          priceUsd: 0,
          signature: tx.signature,
          blockTime,
        });
      }
    }
    return out;
  }

  /** Returns top-holder concentration heuristics for an SPL mint (best-effort). */
  async getHolderConcentration(
    mint: string,
  ): Promise<{ top10Pct: number | null; topSinglePct: number | null }> {
    try {
      const pk = new PublicKey(mint);
      const res = await this.connection.getTokenLargestAccounts(pk, 'confirmed');
      const supplyRes = await this.connection.getTokenSupply(pk, 'confirmed');
      const supply = Number(supplyRes.value.uiAmount ?? 0);
      if (!supply) return { top10Pct: null, topSinglePct: null };
      const accounts = res.value.slice(0, 10).map((a) => Number(a.uiAmount ?? 0));
      const top10 = accounts.reduce((s, x) => s + x, 0);
      const top1 = accounts[0] ?? 0;
      return { top10Pct: (top10 / supply) * 100, topSinglePct: (top1 / supply) * 100 };
    } catch {
      return { top10Pct: null, topSinglePct: null };
    }
  }

  /** Returns mint/freeze authority status. */
  async getMintAuthorityStatus(
    mint: string,
  ): Promise<{ mintAuthorityActive: boolean | null; freezeAuthorityActive: boolean | null }> {
    try {
      const pk = new PublicKey(mint);
      const info = await this.connection.getParsedAccountInfo(pk, 'confirmed');
      const data = info.value?.data;
      if (!data || typeof data === 'string' || !('parsed' in data)) {
        return { mintAuthorityActive: null, freezeAuthorityActive: null };
      }
      const parsed = data.parsed as { info?: { mintAuthority: string | null; freezeAuthority: string | null } };
      const mi = parsed.info;
      if (!mi) return { mintAuthorityActive: null, freezeAuthorityActive: null };
      return {
        mintAuthorityActive: mi.mintAuthority !== null,
        freezeAuthorityActive: mi.freezeAuthority !== null,
      };
    } catch {
      return { mintAuthorityActive: null, freezeAuthorityActive: null };
    }
  }

  async getSolBalance(pubkey: string): Promise<number> {
    try {
      const lamports = await this.connection.getBalance(new PublicKey(pubkey), 'confirmed');
      return lamports / 1_000_000_000;
    } catch {
      return 0;
    }
  }

  async pingLatencyMs(): Promise<number> {
    const start = Date.now();
    try {
      await this.connection.getSlot('confirmed');
      return Date.now() - start;
    } catch {
      return -1;
    }
  }
}
