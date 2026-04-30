# Project Goal

## What this project is supposed to do

A Solana meme-coin **discovery + selective paper-trading framework**. It discovers tokens from multiple sources (DexScreener latest profiles, DexScreener boosts, Birdeye trending, pump.fun migrations), scores them across many independent dimensions (safety, volume, liquidity, smart-wallet activity, source-stack agreement, freshness, too-late penalty, etc.), aggregates the dimensions into a master signal, and only acts when multiple signals agree. Live trading is locked behind multiple flags and explicitly not the goal of this phase.

The thesis is **"garbage rejection machine"**: pass on >95% of tokens, only act on multi-confirmation. Edge — if any — comes from rejection quality and risk control, not from extracting value from other traders. The framework intentionally excludes sandwich attacks, front-running, wash trading, and detection-evasion tooling.

## Core outcome

Reach a state where **paper-trading expectancy is measurable and positive across at least one strategy on a meaningful sample (≥30 closed trades)**. Until that's true, the system is not "working end-to-end" no matter how clean the code is.

## Current priority

1. **Generate enough paper trades to measure expectancy.** Today the bot has produced ~3 paper trades total — too few to draw conclusions. The bottleneck is signal coverage (most scoring modules are not wired into the evaluate path), not trade-decision quality.
2. **Make every signal output measurable.** Per-strategy expectancy is in the dashboard as of `e8b784c`. Per-sub-score expectancy is not yet recorded.
3. **Tune thresholds against measured data, not intuition.** Deferred until (1) is true.
4. **Verify live-trading code paths end-to-end.** Deferred until paper expectancy is positive.

## Non-goals

- No promise of profit. Meme markets are adversarial and reflexive.
- No live trading until paper expectancy is positive on a meaningful sample.
- No sandwich, front-running, wash trading, or manipulation tooling, ever.
- No new feature surface while existing features are unwired or unverified.
- No threshold tuning before there's data to tune against.

## Success metric (when we'd call core "working")

- `pnpm typecheck` clean.
- `pnpm test` ≥75/75 passing (current baseline).
- ≥30 closed paper positions in `closed_positions` over a multi-day run.
- ≥1 strategy with positive expectancy and ≥10 trades.
- Per-strategy expectancy table in dashboard populated and stable across restarts.
- Wallet auto-curation has either auto-promoted or auto-demoted ≥1 wallet on real data.

## What "live ready" would look like (out of scope for this phase)

- Several days of continuous paper trading.
- Documented per-strategy expectancy and drawdown.
- Manual review of every entry in `rejected_trades` confirming rejections look right.
- End-to-end review of `liveTrader.ts` + `jupiterExecutor.ts`.
- Sub-second copy lag (Helius LaserStream / Yellowstone gRPC) — not present today.
- Bundle / common-funder cluster detection — not present today.
