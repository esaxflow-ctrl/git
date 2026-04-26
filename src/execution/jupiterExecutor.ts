/**
 * Jupiter executor — turns a Jupiter quote into a signed and submitted
 * transaction.
 *
 * Loads a Solana keypair from `PRIVATE_KEY_PATH` (file content: a JSON array
 * of 64 ints, the standard `solana-keygen` format). NEVER prints the key.
 *
 * Defensive checks:
 *   - private key file exists and is readable
 *   - public key derived from secret matches WALLET_PUBLIC_KEY
 *   - quote is non-null and fresh (<= QUOTE_FRESHNESS_MS)
 *   - simulation succeeds (or only fails for known-acceptable reasons)
 *   - bounded retries (MAX_SEND_RETRIES) and signature confirmation timeout
 */

import { readFileSync, statSync } from 'node:fs';
import {
  Keypair,
  Transaction,
  VersionedTransaction,
  type Connection,
  type SendOptions,
} from '@solana/web3.js';
import type { JupiterAdapter } from '../adapters/jupiter.js';
import type { JupiterQuoteResult } from '../types.js';

const QUOTE_FRESHNESS_MS = 10_000;
const MAX_SEND_RETRIES = 3;
const CONFIRM_TIMEOUT_MS = 60_000;

export interface ExecuteParams {
  quote: JupiterQuoteResult;
  /** Optional: priority fee override (lamports). Defaults to 'auto'. */
  priorityFeeLamports?: number | 'auto';
}

export interface ExecuteResult {
  ok: boolean;
  signature?: string;
  error?: string;
  simulationError?: string;
  feesPaidLamports?: number;
}

export class JupiterExecutor {
  private keypair?: Keypair;

  constructor(
    private readonly connection: Connection,
    private readonly jupiter: JupiterAdapter,
    private readonly privateKeyPath: string,
    private readonly expectedPubkey: string,
  ) {}

  /** Lazily load and validate the keypair. Never prints it. */
  private loadKeypair(): Keypair {
    if (this.keypair) return this.keypair;
    if (!this.privateKeyPath) throw new Error('PRIVATE_KEY_PATH not set');
    let stat;
    try {
      stat = statSync(this.privateKeyPath);
    } catch {
      throw new Error(`PRIVATE_KEY_PATH not found: ${this.privateKeyPath}`);
    }
    if (!stat.isFile()) throw new Error('PRIVATE_KEY_PATH is not a file');
    if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
      throw new Error(
        `Private key file ${this.privateKeyPath} is world/group readable. Run: chmod 600 ${this.privateKeyPath}`,
      );
    }
    const raw = readFileSync(this.privateKeyPath, 'utf-8').trim();
    let bytes: number[];
    try {
      bytes = JSON.parse(raw) as number[];
    } catch {
      throw new Error('Private key file is not a JSON array of bytes');
    }
    if (!Array.isArray(bytes) || bytes.length !== 64) {
      throw new Error('Private key file must be a JSON array of 64 ints');
    }
    const kp = Keypair.fromSecretKey(Uint8Array.from(bytes));
    if (this.expectedPubkey && kp.publicKey.toBase58() !== this.expectedPubkey) {
      throw new Error(
        `Loaded keypair public key does not match WALLET_PUBLIC_KEY env value`,
      );
    }
    this.keypair = kp;
    return kp;
  }

  publicKey(): string {
    return this.loadKeypair().publicKey.toBase58();
  }

  async execute(params: ExecuteParams): Promise<ExecuteResult> {
    const kp = this.loadKeypair();

    if (!params.quote) return { ok: false, error: 'no quote' };
    if (Date.now() - params.quote.fetchedAt > QUOTE_FRESHNESS_MS) {
      return { ok: false, error: 'quote stale' };
    }

    const built = await this.jupiter.buildSwap({
      quote: params.quote,
      userPublicKey: kp.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
      prioritizationFeeLamports: params.priorityFeeLamports ?? 'auto',
      dynamicComputeUnitLimit: true,
    });
    if (!built) return { ok: false, error: 'swap build failed' };

    let txn: VersionedTransaction;
    try {
      const buf = Buffer.from(built.swapTransaction, 'base64');
      txn = VersionedTransaction.deserialize(buf);
    } catch {
      return { ok: false, error: 'swap tx decode failed' };
    }

    txn.sign([kp]);

    // Simulate first.
    const sim = await this.connection.simulateTransaction(txn, { commitment: 'confirmed' });
    if (sim.value.err) {
      return {
        ok: false,
        error: 'simulation failed',
        simulationError: JSON.stringify(sim.value.err),
      };
    }

    // Send with bounded retries.
    const opts: SendOptions = { skipPreflight: false, maxRetries: 0 };
    let lastErr = 'unknown';
    for (let attempt = 1; attempt <= MAX_SEND_RETRIES; attempt++) {
      try {
        const sig = await this.connection.sendRawTransaction(txn.serialize(), opts);
        const conf = await this.connection.confirmTransaction(
          { signature: sig, ...(await this.connection.getLatestBlockhash('confirmed')) },
          'confirmed',
        );
        if (conf.value.err) {
          lastErr = `on-chain error: ${JSON.stringify(conf.value.err)}`;
          break; // do NOT retry an on-chain error — the input was bad
        }
        return { ok: true, signature: sig };
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
        if (attempt === MAX_SEND_RETRIES) break;
        await new Promise((r) => setTimeout(r, 250 * attempt));
      }
    }
    return { ok: false, error: lastErr };
  }

  /** Used by callers to print balance without ever exposing the key. */
  async balanceSol(connection: Connection): Promise<number> {
    const kp = this.loadKeypair();
    const lamports = await connection.getBalance(kp.publicKey, 'confirmed');
    return lamports / 1_000_000_000;
  }
}

// Quiet "unused" lints for the `Transaction` import — kept available for callers
// that pre-build legacy transactions outside the executor.
export type { Transaction };
