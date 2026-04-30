# Error Log

Track repeated bugs, broken assumptions, failed commands, and recurring issues.

## Format

### Error: short name
- Date:
- Symptom:
- Root cause:
- Fix:
- Prevention rule:

---

## Known Errors

### Error: Exit manager only ticked when held token reappeared in discovery
- Date: 2026-04-29 (fixed in commit `e8b784c`)
- Symptom: User observed 3 paper positions held >330 minutes with no closures despite ladder/trailing/time-based rules.
- Root cause: Loop in `src/index.ts` only called `exits.tick()` from inside the discovery iteration when `p.token.address === snap.address`. Once a held token dropped off Birdeye trending it was never visited again.
- Fix: Always tick every open position every loop with snapshot fallback chain (fresh discovery → DexScreener fetch → cached snapshot → synthetic from entry price).
- Prevention rule: **Add an integration test for the main loop that holds a position whose token is absent from the next discovery batch and verifies time-based exit fires.**

### Error: Master signal mathematically capped at ~43
- Date: 2026-04-25 (fixed in commit `c179e7e`)
- Symptom: Tokens that passed every hard gate received `recommendation = PASS` with `master_score = 43` ceiling.
- Root cause: Master score averaged sub-scores over all 12 components, but only ~4 of them were ever computed (others returned 0). Treating a missing measurement as a measured 0 crushed the average.
- Fix: Normalize over *active* components only (score > 0). Recommendation logic separately requires `active.length >= 3` to act.
- Prevention rule: **Distinguish "not measured" from "measured low" everywhere. A 0 in a sub-score must mean "explicitly low" or be excluded from averaging.**

### Error: Birdeye trending HTTP 400 on limit > 20
- Date: 2026-04-26 (fixed in commit `7d500aa`)
- Symptom: Birdeye trending returned 400 with body "limit should be integer, range 1-20".
- Root cause: API has a hard cap; we requested 30+.
- Fix: Cap at 20 in `BirdeyeAdapter.trendingTokens`.
- Prevention rule: When integrating with a vendor API, always read the cap on every numeric query parameter, not just the auth.

### Error: DexScreener `bestSolanaPair` crash on pairs without liquidity
- Date: 2026-04-26 (fixed in commit `791be74`)
- Symptom: `Cannot read properties of undefined (reading 'usd')`.
- Root cause: Some pairs return without a `liquidity` field.
- Fix: `pair.liquidity?.usd ?? 0`.
- Prevention rule: External-API objects are partial. Default every numeric field with `?? 0` (or explicit guard) before arithmetic.

### Error: Jupiter v6 quote-api endpoint dead
- Date: 2026-04-26 (fixed in commit `e2fb29b`)
- Symptom: `quote-api.jup.ag` DNS no longer resolves.
- Root cause: Jupiter migrated to `lite-api.jup.ag/swap/v1` (free) and `api.jup.ag/swap/v1` (paid).
- Fix: Updated `JupiterAdapter` base URL selection.
- Prevention rule: Pin vendor base URLs in one place per adapter and verify them quarterly or on first 5xx/DNS failure.

### Error: better-sqlite3 11.x failed to compile on Node 24
- Date: 2026-04-25 (fixed by bumping to ^12.9.0)
- Symptom: No prebuilt binary for Node 24 ABI; native build failed without MSVC.
- Root cause: Older better-sqlite3 didn't ship a prebuild for Node 24.
- Fix: `pnpm add better-sqlite3@latest` (12.9.0).
- Prevention rule: When upgrading Node major versions, audit native deps for prebuilt-binary availability before pulling.

### Error: Risk manager logged duplicate rejection reason
- Date: 2026-04-26 (fixed in commit `c179e7e`)
- Symptom: `safety score 29 < threshold 75; safety score 29 < threshold 75`.
- Root cause: Code both pushed to `reasons[]` and called `fail(msg)` which prepended the same message.
- Fix: Call `fail()` only.
- Prevention rule: One mechanism per concern. Either a return-with-reason helper, or a reasons-array, never both.

### Error: Paper-mode produced zero trades for hours
- Date: 2026-04-27 (fixed in commit `d5b9bcf`)
- Symptom: Pipeline ran cleanly but never opened a paper position.
- Root cause: `LIVE_BUY_ALLOWED` required `passingSupports.length >= 1`, but no individual sub-score met its threshold because most scoring modules weren't wired.
- Fix: Loosened the paper-buy gate to require only `master >= LIVE_BUY_THRESHOLD - 10` plus `active.length >= 3`. Live mode still requires ≥2 supporting signals + ≥4 active components.
- Prevention rule: Paper mode exists to validate the pipeline; it should be hard to mistakenly fire a live trade and easy to fire a paper trade.

### Error: User pasted Helius API key into chat (twice)
- Date: 2026-04-25 / 2026-04-27
- Symptom: User pasted raw API keys; both were rotated after Claude flagged them.
- Root cause: User-side workflow.
- Fix: Documented in RUNBOOK that keys must live only in `.env`.
- Prevention rule: When the user shares a credential in chat, immediately tell them to rotate it; do not write it to any file.

### Error: Windows entrypoint detection silently failed
- Date: 2026-04-25 (fixed in commit `07d34ec`)
- Symptom: `pnpm paper` exited cleanly without running `main()`.
- Root cause: `import.meta.url === \`file://${process.argv[1]}\`` never matched on Windows because of backslash paths.
- Fix: Compare `resolve(fileURLToPath(import.meta.url))` to `resolve(process.argv[1])`.
- Prevention rule: Path comparisons across `import.meta.url` and `process.argv[1]` must always go through `fileURLToPath` + `path.resolve`. Never string-compare the raw URL.

### Error: User's .env contained `SOLANA_RPC_URL=SOLANA_RPC_URL=https://...` (double prefix)
- Date: 2026-04-26
- Symptom: Zod parse error: "Endpoint URL must start with http: or https:".
- Root cause: User typo while editing.
- Fix: User-side cleanup.
- Prevention rule: Surface zod parse errors prominently at boot with the exact bad key name; don't swallow.

### Error: Computer sleep paused the bot for hours
- Date: 2026-04-27
- Symptom: Bot was "running" but no progress for 4+ hours.
- Root cause: User's Windows went to sleep.
- Fix: User disabled sleep in Windows power settings.
- Prevention rule: Document this in RUNBOOK. Long-running paper sessions need either disabled sleep or a wake-tolerant restart story.

---

## Open / unresolved (not yet fixed)

### Issue: Most scoring modules in README are not wired into evaluate()
- Date: 2026-04-29 (Phase 1 inspection)
- Symptom: `breakdown.buzz`, `breakdown.event`, `breakdown.pumpfun`, `breakdown.migration`, `breakdown.narrative`, `breakdown.dexscreenerBoost` are always 0 even though the modules exist with passing unit tests.
- Root cause: `src/index.ts evaluate()` only fills 6 of the 14 components.
- Fix: **Pending Phase 3.** Wire each existing scorer into evaluate(); each strategy already has unit-test coverage so the integration risk is contained.
- Prevention rule: Master signal weights and `emptyBreakdown()` should drive the integration: any non-zero weight without a producer is a wiring bug. Add a CI check.

### Issue: watched_wallets is empty by default
- Date: 2026-04-29
- Symptom: New `smartWallet` / `smartWalletCluster` sub-scores are always 0 in production.
- Root cause: Auto-discovery requires hours of wallet observations to propose anything; user has not manually run `pnpm wallet:add`.
- Fix: **Pending.** Either ship a small seed list, document running wallet:discover for several hours, or both. Decision goes in DECISIONS.md once made.

### Issue: Local commit e8b784c not pushed to origin (status says ahead-by-1)
- Date: 2026-04-29
- Symptom: `git status` reports "Your branch is ahead of 'origin/...' by 1 commit" even though earlier `git push` returned exit 0.
- Root cause: Unknown. Possible silent push reject, or git-status reading stale remote-tracking ref.
- Fix: **Pending.** Re-run `git push` and verify with `git log origin/<branch> -1` before starting Phase 3.
