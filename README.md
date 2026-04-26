# Solana Meme-Coin Trading Bot Framework

A production-grade scaffolding for **discovering, filtering, and selectively trading Solana meme coins**, built around one principle:

> **Reject ~95% of tokens. Only act when multiple independent signals agree.**

This is not a pump bot. It is a **garbage-rejection machine** with a paper-trading-first workflow, hard risk caps, a kill switch, and full reasoning trails for every accepted *and* rejected trade.

> ⚠️ **No guarantees.** Meme-coin markets are adversarial and reflexive. This framework is designed to limit downside and surface opportunities; it does **not** promise profit. Read the *Common failure modes* section before enabling live trading.

---

## Tech stack

- Node.js ≥ 20 / TypeScript / pnpm
- `@solana/web3.js` for chain interaction
- **Jupiter Swap API** (quote + swap) for execution and route discovery
- **Helius** RPC + Enhanced Transactions + Webhooks for on-chain monitoring
- **Birdeye** + **DexScreener** for prices, liquidity, volume, trending, boosts
- **X API v2** for social signal monitoring
- **SQLite** (better-sqlite3) — Postgres swap-in is straightforward

---

## Install

```bash
pnpm install
cp .env.example .env
# fill in API keys and wallet public key in .env
mkdir -p data keys
```

If you intend to ever enable live trading, place your keypair JSON at the path
referenced by `PRIVATE_KEY_PATH` (default `./keys/trading-wallet.json`).
**Never paste a private key into source code or commit it.** Permissions on the
key file should be `chmod 600`.

---

## Run modes

| Command | What it does |
|---|---|
| `pnpm dev` | Watch-mode boot of the full pipeline in paper mode |
| `pnpm scan` | Run discovery + scoring loop, write signals to DB, do not trade |
| `pnpm paper` | Full pipeline, simulated entries/exits via Jupiter quotes |
| `pnpm backtest` | Replay historical token snapshots through the strategies |
| `pnpm live` | **Locked.** Refuses to run unless `LIVE_TRADING=true` and `PAPER_TRADING=false` |
| `pnpm test` | Vitest suite (safety, risk, scoring, paper accounting) |
| `pnpm typecheck` | TypeScript strict-mode validation |

Default `.env` ships with `PAPER_TRADING=true`, `LIVE_TRADING=false`.
The live path is gated by *multiple* independent flags and runtime checks.

---

## How the pipeline works

```
  ┌──────────────┐   ┌────────────┐   ┌──────────────┐   ┌──────────────┐
  │  Scanners    │──▶│   Scoring  │──▶│  Strategies  │──▶│ Master Score │
  │ (token/X/    │   │ (safety/   │   │ (cluster/    │   │ + Risk Gate  │
  │  wallet/news)│   │  buzz/event│   │  pumpfun/    │   │              │
  │              │   │  narrative)│   │  migration…) │   │              │
  └──────────────┘   └────────────┘   └──────────────┘   └──────┬───────┘
                                                                 │
                              ┌──────────────────────────────────┘
                              ▼
                    ┌────────────────────┐      ┌──────────────────┐
                    │  Paper Trader      │◀────▶│   Exit Manager   │
                    │  Live Trader       │      │  (stops/trails/  │
                    │  (Jupiter Executor)│      │   emergency)     │
                    └────────────────────┘      └──────────────────┘
```

Every accepted **and** rejected token writes a row to the DB explaining *why*
in plain English plus the full score breakdown.

---

## Wallet tracking (`smartWalletScore`)

Tracks public Solana wallets that have shown realised PnL, repeatable cross-token
profits, sane hold times, and survival across regimes. Wallets are scored 0–100 and
**labelled** (`ELITE_COPYABLE`, `INSIDER_LIKELY`, `DEV_WALLET_LIKELY`,
`SNIPER_BOT`, `TOO_FAST_TO_COPY`, …). A single elite wallet entering a token is
**not** enough to live-buy; a *cluster* of unrelated elite wallets, plus volume
+ liquidity + safety, is.

Penalties: tokens received directly from deployer; bot-like sniper patterns;
suspicious funding chains; one-off large wins; high variance; copy-impossible
liquidity.

## X / social monitoring (`x.ts`, `socialScanner`, `buzzScore`)

Listens (via X API v2) for cashtags, contract addresses, and curated phrases
(`"official coin"`, `"CA:"`, `"Raydium"`, `"migration"`…). Buzz score weights:
post velocity, mention acceleration, account credibility, engagement velocity,
duplicate-spam ratio, and bot-like ratio. **Buzz alone never triggers a live
buy** — it must be confirmed by an on-chain CA, Jupiter quote, liquidity, and
volume acceleration.

## Official events (`newsScanner`, `eventScore`, `officialAnnouncementStrategy`)

Verifies celebrity / political / brand / project launches against:
official account → contract address in post → same CA on DexScreener / Birdeye
→ Jupiter route exists → liquidity passes → holder concentration sane.
Verified launches allow **paper buy** immediately and **tiny live buy** only if
all risk filters pass and `LIVE_TRADING=true`.

## Pump.fun / bonding curve (`pumpfunScanner`, `pumpfunBondingCurveStrategy`)

Tracks new launches, curve progress, organic buyer growth, deployer reputation,
and migration readiness. Live launchpad trading is gated *additionally* by
`ENABLE_LIVE_LAUNCHPAD_TRADING=false` (default off).

## Migration tracking (`migrationScanner`, `migrationStrategy`)

Watches for tokens graduating to Raydium / PumpSwap, new Jupiter routes
appearing, and post-migration volume / liquidity confirmation.

## Narrative rotation (`narrativeScore`, `narrativeRotationStrategy`)

Tracks active narratives (political, celebrity, animal, AI, sports, gaming,
exchange-listing, ecosystem, migration, viral). Used as **supporting
confirmation only**, never as a sole trigger.

## Too-late rejection

Possibly the single most important module. Rejects already-exhausted tokens:
parabolic moves with no consolidation, social peaking and declining, smart
wallets selling, buy/sell ratio weakening, late-retail-only posters.

---

## Reading the dashboard

Run `pnpm paper` in one terminal. The CLI dashboard shows:

- **System**: mode, wallet balance, kill-switch status, RPC latency, daily PnL
- **Signals**: new tokens, elite-wallet buys, X buzz leaders, narrative leaders
- **Trading**: open paper/live trades, recent closes, **rejected trades with
  reasons**, emergency exits, cooldown state
- **Wallets**: top 25 tracked wallets, labels, latest trades, score deltas

---

## Enabling live trading (deliberately fiddly)

This is intentionally annoying. Read every step.

1. Run `pnpm paper` for at least several days. Examine `daily_reports` and
   `closed_positions` in the DB. Confirm **positive expectancy** across a
   meaningful sample. If paper isn't profitable, live won't be either.
2. Review every entry in `rejected_trades` — make sure the bot is rejecting
   tokens you would have rejected manually.
3. Drop a fresh keypair JSON into `keys/`, give it ≤ a small SOL amount you can
   afford to lose, and `chmod 600` the file.
4. Lower `MAX_TRADE_SOL` to a tiny figure (e.g. `0.01`) until you trust the
   stack.
5. Set `LIVE_TRADING=true` and `PAPER_TRADING=false`.
6. Run `pnpm live`. The bot prints a multi-line warning and re-validates every
   gate before each trade.
7. Keep `STOP_BOT.txt` ready to drop in the project root — its presence
   immediately halts new entries and triggers exit-manager review.

---

## Common failure modes (read before going live)

- **Fake contract address.** Scammers post lookalikes. Verified-launch logic
  helps but isn't infallible — verify CAs against multiple official sources.
- **Late entry.** Most retail-visible signals are already exhausted. The
  too-late module rejects many of these; some still slip through.
- **Insider / dev wallet.** A "smart wallet" with three giant wins may simply
  be the deployer. `smartWalletScore` penalises deployer-chain funding.
- **Botted social buzz.** Mention spikes can be cheap to manufacture. Buzz
  needs verified-account weighting and CA confirmation to count.
- **Liquidity disappears.** LP rugs are silent — `liquidityScanner` and the
  exit manager watch for drains and trigger emergency exits.
- **Jupiter route fails / API delay.** Quote freshness is validated; missing
  routes aborts the trade.
- **Copy trade too late.** If an elite wallet bought 30s ago and the price
  already moved 25%, the trade is rejected.
- **Celebrity dumps post-hype.** Verified launches require fast partial
  profits and aggressive trailing stops.
- **Launchpad rugs.** Live launchpad trading is off by default for a reason.
- **Market-regime change.** Strategies that worked last month die. Periodically
  re-run the backtester and re-evaluate score thresholds.
- **Paid DexScreener boost.** A boost without volume / unique buyers / smart
  wallet activity is labelled `PAID_BOOST_NO_CONFIRMATION` and ignored.
- **Crowded smart wallet.** Once a wallet is widely copied, its edge erodes.
  Rotate the watch list and recompute scores regularly.

---

## Project layout

```
src/
  config.ts            # env parsing + invariants
  types.ts             # shared types
  index.ts             # entrypoint / mode dispatcher
  adapters/            # external API clients
  scanners/            # discovery sources
  scoring/             # 0–100 score modules
  strategies/          # combine signals into actionable recs
  execution/           # paper + live + exit + jupiter execution
  risk/                # risk manager, kill switch, position sizing
  db/                  # schema + better-sqlite3 wrapper
  dashboard/           # CLI dashboard
  backtest/            # historical replay
  tests/               # vitest unit tests
```

---

## What this framework cannot do

- It cannot guarantee profit.
- It cannot detect every honeypot or rug — only the on-chain heuristics it has
  access to.
- It cannot verify offline real-world identities. "Verified launch" means
  *cryptographic + multi-source* verification of the post + CA, not personal
  identity.
- It cannot replace human judgment in fast-moving markets. The dashboard is
  designed for **human-in-the-loop** monitoring.

---

## Status / what still needs human review

This is a **framework**. Several modules deliberately ship as
production-shaped scaffolding rather than fully tuned production code:

- Strategy thresholds (in `scoring/*` and `strategies/*`) are reasonable
  starting values; they require backtest tuning per regime.
- Smart-wallet seed list is empty — you must populate `watched_wallets` with
  candidates before tracking is useful.
- The pumpfun scanner uses public on-chain heuristics; precise program-account
  parsing should be reviewed against the latest pump.fun program.
- The X account credibility list is configurable; a curated seed list is
  required.
- `liveTrader.ts` performs full risk-gate validation but should be reviewed
  end-to-end before any real-money use.

See *Riskiest parts of the system* in `docs/RISKS.md` (created on first run).

---

## Why we don't implement certain things

This framework intentionally **does not** include sandwich attacks,
front-running, spam, wash trading, market manipulation, or detection-evasion
tooling. Those activities harm other market participants, are unethical, and
in many jurisdictions illegal. Our edge — if any — comes from rejection
quality and risk control, not from extracting value from other traders.
