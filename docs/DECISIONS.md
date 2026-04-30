# Decisions Log

Track important project decisions so future Claude sessions do not repeat debates.

## Format

### Decision: short name
- Date:
- Decision:
- Reason:
- Tradeoff:
- Revisit if:

---

## Decisions

### Decision: Paper-trading first; live locked behind dual flags
- Date: 2026-04-25
- Decision: Default `.env` ships with `PAPER_TRADING=true`, `LIVE_TRADING=false`. Live requires *both* `LIVE_TRADING=true` and `PAPER_TRADING=false`. Ambiguous combinations refuse to start.
- Reason: Single-flag toggles are too easy to flip by accident; the asymmetry between losing real SOL and losing nothing in paper warrants two independent affirmations.
- Tradeoff: Slightly fiddlier to enable live; impossible to enable accidentally.
- Revisit if: Paper expectancy is positive on a meaningful sample AND a separate review of `liveTrader.ts`/`jupiterExecutor.ts` has been completed.

### Decision: ds_boost is a NEGATIVE source-stack signal, not positive
- Date: 2026-04-29 (commit `e8b784c`)
- Decision: `ds_boost` contributes **−30** to `sourceStack`. A standalone boosted token score clamps to 0; a boost cancels weak positive sources.
- Reason: Independent analysis of >3,000 DexScreener boost purchases found an average **−48% return**. Paid promotion correlates with exit liquidity, not opportunity.
- Tradeoff: We will miss the small minority of legitimate boosted tokens that pump.
- Revisit if: Backtest evidence shows boosted tokens with strong on-chain confirmation outperform the average — currently no such evidence.

### Decision: Freshness sweet spot is 1–15 min post-listing
- Date: 2026-04-29 (commit `e8b784c`)
- Decision: `scoreFreshness` peaks at 100 in the 1–15 min window, decays through 60 min / 4h / 12h, returns 0 past 12h.
- Reason: Academic pump.fun success-prediction work (arxiv 2602.14860, 655k tokens) reports median time-to-graduation of ~4.4 min and the strongest predictor is fast vSol accumulation; trader post-mortems converge on 1–15 min as the highest-information window.
- Tradeoff: Ignores opportunities on older tokens unless multiple other signals confirm.
- Revisit if: Per-strategy expectancy tracking shows trades opened in the 60min–4h bucket consistently outperform 1–15min.

### Decision: Auto-promote GOOD_BUT_RISKY → ELITE_COPYABLE on robust track record only
- Date: 2026-04-29
- Decision: Auto-promotion requires ≥5 distinct tokens with realised PnL, ≥60% win rate, ≥2 SOL net realised PnL, and not flagged as sniper or MEV bot.
- Reason: Cheaper thresholds (3 tokens, 50% WR, 0.5 SOL) made too many false positives in early experiments; the MEV-bot detector at >85% WR / 10+ tokens was added because high WR is correlated with sandwich/arb patterns that copy-followers can't capture.
- Tradeoff: Slow auto-promotion early in a deployment when the data sample is small. ELITE label rarely appears for the first ~24h.
- Revisit if: After ≥7 days of running, no auto-promotions have fired despite trending pools showing identifiably profitable wallets.

### Decision: Loosen paper-buy gate so the pipeline can be validated
- Date: 2026-04-27 (commit `d5b9bcf`)
- Decision: Paper-buy fires when `master >= LIVE_BUY_THRESHOLD − 10` and `active.length >= 3`. Live still requires `passingSupports.length >= 2` and `active.length >= 4`.
- Reason: With most scoring modules unwired, no individual sub-score crossed its strategy-specific threshold, so the original gate (`passingSupports >= 1`) never fired. Paper mode's purpose is end-to-end pipeline validation.
- Tradeoff: Paper trades may include tokens that wouldn't qualify as live. That is acceptable in paper mode and makes the per-strategy expectancy table populate faster.
- Revisit if: Once all scoring modules are wired and `active.length` rises naturally, the paper gate should be tightened back to require ≥1 passing support.

### Decision: Master score normalises over active components only
- Date: 2026-04-26 (commit `c179e7e`)
- Decision: Components with `score == 0` are treated as "not measured" and excluded from the weighted average. The recommendation logic separately requires a minimum number of active components to act.
- Reason: Treating a missing measurement as a measured 0 mathematically capped master at ~43 even when every wired sub-score was strong.
- Tradeoff: A token with one strong score and nothing else can have high master, but `active.length` gating prevents it from triggering live.
- Revisit if: Sparse-signal tokens turn out to over-trigger paper buys despite the active.length floor.

### Decision: Conservative wallet labels only — no automatic ELITE for buy-only wallets
- Date: 2026-04-29 (commit `e8b784c`)
- Decision: Wallets with positive *paper* PnL across multiple tokens are NOT promoted unless we've observed actual sells (realised PnL). Buy-only wallets max out at the proposal stage.
- Reason: A wallet that bought at $50K MC and is "up 300%" might never sell — paper PnL is meaningless until chips come off the table. We only count realised SOL flows from `nativeTransfers`.
- Tradeoff: Excludes patient long-hold wallets that genuinely accumulate.
- Revisit if: Enough realised-PnL wallets are auto-promoted that we consistently hit the watch-list cap.

### Decision: No sandwich, front-running, wash, or detection-evasion code
- Date: 2026-04-25 (initial spec)
- Decision: This framework will not include sandwich attacks, front-running, wash trading, market manipulation, or detection-evasion tooling — even if requested.
- Reason: Those activities harm other market participants, are unethical, and in many jurisdictions illegal.
- Tradeoff: Forgoes a category of profitable bot strategies.
- Revisit if: Never.

### Decision: Helius free tier is the assumed RPC budget
- Date: 2026-04-25
- Decision: All adapters (Birdeye, Helius, DexScreener) are coded for free-tier rate limits with caches and rate-limited buckets. Wallet discovery polls top-15 trending pools every 6h to stay polite.
- Reason: User does not have paid API access. Higher tier would unlock LaserStream / Yellowstone gRPC and sub-second copy lag, which is the #1 PnL leak per research, but that's an infrastructure decision for later.
- Tradeoff: Copy-trade lag is in the 1–60s range, far above the <500ms required to actually capture leader entries.
- Revisit if: Paper expectancy turns positive AND the user is willing to upgrade to paid tier.
