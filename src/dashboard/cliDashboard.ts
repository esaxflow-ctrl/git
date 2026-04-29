/**
 * CLI dashboard. Periodically prints a single screen of:
 *   - System: mode / wallet / kill switch / RPC latency / open positions / daily PnL
 *   - Signals: recent discovered, elite-wallet buys, buzz leaders, narratives
 *   - Trading: open paper/live trades, recent closed, rejected with reasons,
 *              emergency exits, cooldown
 *   - Wallets: top 25 tracked wallets, labels, latest trades
 *
 * Uses `chalk` for colour. Designed to be readable in a 100-col terminal.
 */

import chalk from 'chalk';
import type { AppConfig } from '../config.js';
import type { Db } from '../db/database.js';
import type { HeliusAdapter } from '../adapters/helius.js';
import type { KillSwitch } from '../risk/killSwitch.js';

export interface DashboardSnapshot {
  cfg: AppConfig;
  walletBalanceSol: number;
  rpcLatencyMs: number;
  openPositions: number;
  dailyPnlSol: number;
  killEngaged: boolean;
}

export class CliDashboard {
  constructor(
    private readonly cfg: AppConfig,
    private readonly db: Db,
    private readonly helius: HeliusAdapter,
    private readonly killSwitch: KillSwitch,
  ) {}

  async render(): Promise<void> {
    const now = Date.now();
    const dayStart = startOfUtcDay(now);
    const mode: 'paper' | 'live' = this.cfg.liveModeEnabled ? 'live' : 'paper';
    const balance = this.cfg.WALLET_PUBLIC_KEY ? await this.helius.getSolBalance(this.cfg.WALLET_PUBLIC_KEY) : 0;
    const latency = await this.helius.pingLatencyMs();
    const open = this.db.listOpenPositions().length;
    const pnl = this.db.realisedPnlSolSince(dayStart, mode);
    const engaged = this.killSwitch.isEngaged();

    const lines: string[] = [];
    lines.push(chalk.bold('━━━ Solana Meme-Coin Bot ━━━'));
    lines.push(
      `${chalk.bold('Mode:')} ${
        mode === 'live' ? chalk.bgRed.white(' LIVE ') : chalk.bgGreen.black(' PAPER ')
      }    ${chalk.bold('Wallet:')} ${balance.toFixed(4)} SOL    ${chalk.bold('RPC:')} ${latency}ms    ${chalk.bold('Kill switch:')} ${engaged ? chalk.bgRed.white(' ENGAGED ') : chalk.green('off')}`,
    );
    lines.push(
      `${chalk.bold('Open positions:')} ${open}/${this.cfg.MAX_OPEN_POSITIONS}    ${chalk.bold('Daily PnL:')} ${formatPnl(pnl)} SOL`,
    );
    lines.push('');

    // Recent discovered tokens
    lines.push(chalk.bold.underline('Latest discovered tokens'));
    const recent = this.db
      .raw()
      .prepare(
        `SELECT t.address, t.symbol, t.last_seen_at, s.liquidity_usd, s.market_cap_usd, s.volume_5m_usd
         FROM tokens t LEFT JOIN token_snapshots s ON s.token_address = t.address
         GROUP BY t.address ORDER BY t.last_seen_at DESC LIMIT 10`,
      )
      .all() as Array<{ address: string; symbol: string; last_seen_at: number; liquidity_usd: number; market_cap_usd: number; volume_5m_usd: number }>;
    for (const r of recent) {
      lines.push(
        `  ${r.symbol.padEnd(10)} ${short(r.address)} liq $${(r.liquidity_usd ?? 0).toFixed(0).padStart(8)} mc $${(r.market_cap_usd ?? 0).toFixed(0).padStart(8)} vol5m $${(r.volume_5m_usd ?? 0).toFixed(0)}`,
      );
    }
    lines.push('');

    // Top tracked wallets
    lines.push(chalk.bold.underline('Top tracked wallets (max 25)'));
    const wallets = this.db.listWatchedWallets(25);
    for (const w of wallets) {
      lines.push(`  ${short(w.address)}  ${labelColor(w.label)}  score=${w.score}`);
    }
    lines.push('');

    // Recent rejected trades — most important for transparency
    lines.push(chalk.bold.underline('Latest rejected trades (with reasons)'));
    const rejs = this.db
      .raw()
      .prepare(
        `SELECT symbol, strategy, ts, rejection_reason FROM rejected_trades ORDER BY ts DESC LIMIT 10`,
      )
      .all() as Array<{ symbol: string; strategy: string; ts: number; rejection_reason: string }>;
    for (const r of rejs) {
      lines.push(
        `  ${chalk.gray(new Date(r.ts).toISOString().slice(11, 19))} ${r.symbol.padEnd(10)} ${r.strategy.padEnd(28)} ${chalk.dim(r.rejection_reason)}`,
      );
    }
    lines.push('');

    // Open + recent closed
    lines.push(chalk.bold.underline('Open positions'));
    const ops = this.db.listOpenPositions();
    for (const p of ops) {
      const heldMin = ((now - p.entryTimestamp) / 60_000).toFixed(0);
      lines.push(
        `  ${p.token.symbol.padEnd(10)} ${p.mode.padEnd(5)} entry $${p.entryPriceUsd.toFixed(6)} held ${heldMin}min strat=${p.strategy}`,
      );
    }
    lines.push('');

    // Per-strategy expectancy: which signals actually win, in SOL terms.
    // Helps the user see at a glance whether to keep or pause a strategy.
    lines.push(chalk.bold.underline('Per-strategy expectancy'));
    const perStrat = this.db.perStrategyExpectancy(mode);
    if (perStrat.length === 0) {
      lines.push(`  ${chalk.dim('no closed trades yet')}`);
    } else {
      for (const s of perStrat) {
        const expColored = s.expectancy >= 0
          ? chalk.green(`E=${s.expectancy >= 0 ? '+' : ''}${s.expectancy.toFixed(4)}`)
          : chalk.red(`E=${s.expectancy.toFixed(4)}`);
        const pfStr = isFinite(s.profitFactor)
          ? s.profitFactor.toFixed(2)
          : 'inf';
        lines.push(
          `  ${s.strategy.padEnd(28)} n=${String(s.trades).padStart(3)} win=${(s.winRate * 100).toFixed(0)}%  ${expColored} SOL  net=${formatPnl(s.netPnlSol)} pf=${pfStr}`,
        );
      }
    }
    lines.push('');

    lines.push(chalk.bold.underline('Recent closed positions'));
    const closed = this.db
      .raw()
      .prepare(
        `SELECT symbol, mode, exit_ts, realised_pnl_sol, realised_pnl_pct, reason_closed FROM closed_positions ORDER BY exit_ts DESC LIMIT 10`,
      )
      .all() as Array<{
      symbol: string;
      mode: string;
      exit_ts: number;
      realised_pnl_sol: number;
      realised_pnl_pct: number;
      reason_closed: string;
    }>;
    for (const c of closed) {
      lines.push(
        `  ${chalk.gray(new Date(c.exit_ts).toISOString().slice(11, 19))} ${c.symbol.padEnd(10)} ${c.mode.padEnd(5)} ${formatPnl(c.realised_pnl_sol)} (${c.realised_pnl_pct.toFixed(1)}%) ${chalk.dim(c.reason_closed)}`,
      );
    }
    lines.push('');

    console.clear();
    console.log(lines.join('\n'));
  }
}

function startOfUtcDay(ts: number): number {
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function short(addr: string): string {
  if (addr.length < 10) return addr;
  return addr.slice(0, 4) + '…' + addr.slice(-4);
}

function formatPnl(sol: number): string {
  const s = sol >= 0 ? `+${sol.toFixed(4)}` : sol.toFixed(4);
  return sol >= 0 ? chalk.green(s) : chalk.red(s);
}

function labelColor(l: string): string {
  if (l === 'ELITE_COPYABLE') return chalk.green(l);
  if (l === 'GOOD_BUT_RISKY') return chalk.yellow(l);
  if (l === 'INSIDER_LIKELY' || l === 'DEV_WALLET_LIKELY' || l === 'SNIPER_BOT') return chalk.red(l);
  return chalk.gray(l);
}
