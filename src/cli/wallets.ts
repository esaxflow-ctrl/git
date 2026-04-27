/**
 * Wallet management CLI.
 *
 * Usage:
 *   pnpm wallet:list              — list all watched wallets, newest first
 *   pnpm wallet:list proposed     — list only auto-discovered candidates
 *   pnpm wallet:add <addr> [label] [score]
 *   pnpm wallet:remove <addr>
 *   pnpm wallet:discover          — run one wallet-discovery cycle now
 *
 * Labels accepted by `wallet:add`:
 *   ELITE_COPYABLE | GOOD_BUT_RISKY | INSIDER_LIKELY | DEV_WALLET_LIKELY |
 *   SNIPER_BOT | TOO_FAST_TO_COPY | LOW_QUALITY | IGNORE
 */

import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { config } from '../config.js';
import { Db } from '../db/database.js';
import { BirdeyeAdapter } from '../adapters/birdeye.js';
import { DexScreenerAdapter } from '../adapters/dexscreener.js';
import { HeliusAdapter } from '../adapters/helius.js';
import { WalletDiscovery } from '../scanners/walletDiscovery.js';
import type { WalletLabel } from '../types.js';

const VALID_LABELS: WalletLabel[] = [
  'ELITE_COPYABLE',
  'GOOD_BUT_RISKY',
  'INSIDER_LIKELY',
  'DEV_WALLET_LIKELY',
  'SNIPER_BOT',
  'TOO_FAST_TO_COPY',
  'LOW_QUALITY',
  'IGNORE',
];

function usage(): void {
  console.log(
    [
      'Wallet management commands:',
      '  pnpm wallet:list                       List all watched wallets',
      '  pnpm wallet:list proposed              List auto-discovered candidates',
      '  pnpm wallet:add <addr> [label] [score] Add a wallet (default GOOD_BUT_RISKY 60)',
      '  pnpm wallet:remove <addr>              Remove a wallet',
      '  pnpm wallet:discover                   Run wallet-discovery once',
      '',
      'Valid labels:',
      '  ' + VALID_LABELS.join(' '),
    ].join('\n'),
  );
}

async function main(): Promise<void> {
  const cfg = config();
  const db = new Db(cfg.DB_PATH);
  const cmd = process.argv[2] ?? '';
  const args = process.argv.slice(3);

  switch (cmd) {
    case 'list': {
      const filter = args[0];
      const rows = db
        .raw()
        .prepare(
          filter === 'proposed'
            ? `SELECT w.address, w.label, w.score, w.notes, w.added_at,
                      s.tokens_with_realised, s.net_realised_pnl_sol, s.win_rate
               FROM watched_wallets w
               LEFT JOIN wallet_pnl_summary s ON s.wallet = w.address
               WHERE w.notes LIKE '%realised%' OR w.notes LIKE '%sniper%'
               ORDER BY s.net_realised_pnl_sol DESC, w.added_at DESC LIMIT 100`
            : `SELECT w.address, w.label, w.score, w.notes, w.added_at,
                      s.tokens_with_realised, s.net_realised_pnl_sol, s.win_rate
               FROM watched_wallets w
               LEFT JOIN wallet_pnl_summary s ON s.wallet = w.address
               ORDER BY w.score DESC, w.added_at DESC LIMIT 200`,
        )
        .all() as Array<{
        address: string;
        label: string;
        score: number;
        notes: string | null;
        added_at: number;
        tokens_with_realised: number | null;
        net_realised_pnl_sol: number | null;
        win_rate: number | null;
      }>;
      if (rows.length === 0) {
        console.log('No wallets in watch list yet. Run `pnpm wallet:discover` first.');
        break;
      }
      console.log(`Found ${rows.length} wallet(s):`);
      console.log('-'.repeat(78));
      for (const r of rows) {
        const date = new Date(r.added_at).toISOString().slice(0, 19).replace('T', ' ');
        const pnl =
          r.net_realised_pnl_sol !== null
            ? `${r.net_realised_pnl_sol >= 0 ? '+' : ''}${r.net_realised_pnl_sol.toFixed(3)} SOL`
            : 'no sells observed';
        const wins =
          r.win_rate !== null && r.tokens_with_realised
            ? `${(r.win_rate * 100).toFixed(0)}% on ${r.tokens_with_realised}t`
            : '—';
        console.log(
          `${r.address}  ${r.label.padEnd(18)} score=${String(r.score).padStart(3)}  realised=${pnl.padStart(14)}  ${wins}`,
        );
        if (r.notes) console.log(`    ${r.notes}`);
      }
      break;
    }

    case 'add': {
      const addr = args[0];
      if (!addr) {
        usage();
        process.exit(1);
      }
      const labelArg = (args[1] ?? 'GOOD_BUT_RISKY').toUpperCase() as WalletLabel;
      if (!VALID_LABELS.includes(labelArg)) {
        console.error(`Invalid label "${labelArg}". Valid: ${VALID_LABELS.join(', ')}`);
        process.exit(1);
      }
      const score = Number(args[2] ?? 60);
      if (!Number.isFinite(score) || score < 0 || score > 100) {
        console.error(`Invalid score "${args[2]}". Must be 0-100.`);
        process.exit(1);
      }
      db.upsertWatchedWallet({
        address: addr,
        label: labelArg,
        score,
        notes: 'manually added',
        addedAt: Date.now(),
      });
      console.log(`Added ${addr} as ${labelArg} (score ${score}).`);
      break;
    }

    case 'remove': {
      const addr = args[0];
      if (!addr) {
        usage();
        process.exit(1);
      }
      const result = db.raw().prepare(`DELETE FROM watched_wallets WHERE address = ?`).run(addr);
      console.log(result.changes > 0 ? `Removed ${addr}.` : `${addr} not in watch list.`);
      break;
    }

    case 'discover': {
      const helius = new HeliusAdapter(cfg.HELIUS_API_KEY, cfg.SOLANA_RPC_URL || undefined);
      const birdeye = new BirdeyeAdapter(cfg.BIRDEYE_API_KEY);
      const dex = new DexScreenerAdapter(cfg.DEXSCREENER_API_KEY);
      const wd = new WalletDiscovery({ helius, birdeye, dex, db });
      console.log('Running wallet discovery (this can take 1-2 minutes)...');
      const stats = await wd.runOnce();
      console.log('Discovery stats:');
      console.log(`  pools examined            : ${stats.examinedPools}`);
      console.log(`  pools skipped (cached)    : ${stats.skippedAlreadyExamined}`);
      console.log(`  new buyer observations    : ${stats.newObservations}`);
      console.log(`  new sells recorded        : ${stats.newSellsRecorded}`);
      console.log(`  wallets w/ realised PnL   : ${stats.walletsWithRealisedPnl}`);
      console.log(`  wallets proposed          : ${stats.proposedWallets}`);
      console.log('');
      console.log('Run `pnpm wallet:list:proposed` to review.');
      break;
    }

    case '':
    case 'help':
    case '-h':
    case '--help':
      usage();
      break;

    default:
      console.error(`Unknown command: ${cmd}`);
      usage();
      process.exit(1);
  }

  db.close();
}

const isMainModule =
  process.argv[1] !== undefined &&
  resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);

if (isMainModule) {
  main().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
