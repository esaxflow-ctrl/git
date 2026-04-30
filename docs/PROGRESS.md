# Progress Log

## Current Status

**Headline:** `core-pipeline: failing` — paper trade volume is too low to measure expectancy. Code quality is healthy (typecheck clean, 75/75 tests pass) but the live `evaluate()` path only wires ~6 of the 12+ scoring/strategy modules the README promises. Result: master signal is artificially capped, paper-buy gate (`active.length >= 3`) clears too rarely, the user has observed only ~3 paper trades total before stalling.

**Branch:** `claude/solana-trading-bot-8F0kL`
**Last commit:** `e8b784c` — research-backed PnL upgrades (exit-manager fix, smart-wallet wiring, sourceStack, freshness, ELITE auto-promotion, MEV detector, per-strategy expectancy)
**Origin sync:** local is **1 ahead of origin**. `git push` reported success but `git status` says ahead-by-1. May be a fetch lag; should be re-pushed and verified before any new work.

## Latest Update (2026-04-29 — Phase 4 #1)

**Wired `eventScore` into `evaluate()` with safe-default behaviour.** This is the second of four orphaned scoring modules called out in Phase 1.

What was missing: `eventScore` had unit-test coverage but its score never reached the master signal. `breakdown.event` was always 0 because no caller invoked `scoreEvent()` from the live pipeline.

How it now enters `evaluate()`:
1. New DB helper `Db.recentNewsEventForToken(addr, windowMin=360)` queries `news_events` for the most recent matching row by `tokens_json LIKE '%addr%'` within the time window.
2. When a row exists, `evaluate()` calls `scoreEvent()` with the snapshot, safety, smart-wallet, and volume sub-scores already computed earlier in the function.
3. The result populates `breakdown.event` and its `reasons[]` are merged into the master signal `risks` field.

Default behaviour when event data is missing: `recentNewsEventForToken()` returns `null`, the score branch is skipped, and `breakdown.event` stays at its `emptyBreakdown()` default of 0. **Production today: news_events is empty** because `NewsScanner` is not yet instantiated in the main loop — wiring is dormant until that separate integration is done. Documented in DECISIONS.md.

Files changed:
- `src/db/database.ts` — added `recentNewsEventForToken()`.
- `src/index.ts` — added `scoreEvent` import; conditionally compute event score when a news row exists; populate `breakdown.event`; merge reasons into risks.
- `src/tests/eventWiring.test.ts` — new file, 4 tests covering the DB helper's empty-DB, multi-row, time-window, and production-default cases.

Verification:
```
pnpm typecheck         # clean
pnpm test              # 79/79 passing (16 test files; +4 vs Phase 3)
```

## Phase 3 #1 (2026-04-29) — migration

**Wired `migrationStrategy` into `evaluate()` for tokens whose discovery sources include `'migration'`.** This is one of the four orphaned scoring modules called out in Phase 1. Migration tokens (graduated from a launchpad to a real DEX) now contribute to `breakdown.migration` instead of always reading 0.

Inputs the strategy needs that aren't yet wired (buzz) default to neutral. Heuristic proxies for optional inputs:
- `preMigrationOrganic`: `uniqueBuyers5m >= 5 && unique/totalTx >= 0.5`
- `alreadyExhausted`: `priceChange1hPct > 100`

Verification:
```
pnpm typecheck         # clean
pnpm test              # 75/75 passing (15 test files)
```

Files changed:
- `src/index.ts` — added migrationStrategy import; conditionally compute migration score when discovery sources include 'migration'; added migration confirmations/warnings into the master-signal payload.

Real-world evidence (master score lift, trade count change) cannot be captured in this session — requires a `pnpm paper` run that surfaces a migration-tagged token. Mark the feature `unknown` with the test-pass evidence until production data exists.

## Phase 1 + 2 (2026-04-29)

- Phase 1 inspection completed.
- Phase 2 docs written: PROJECT_GOAL, FEATURES.json, EVALS, PROGRESS, ERROR_LOG, DECISIONS, RUNBOOK.
- No code changes in Phase 1/2.

## Repo state at Phase 2 inspection

- `git status`: clean working tree. Untracked: `CLAUDE.md`, `docs/`, `node/` — all dropped in by user, not Claude edits.
- `git stash list`: empty.
- No `iter-B` branch or folder anywhere in the repo. Sibling Claude branches (`short-form-video-system`, `polymarket-tracker`, `fix-*`) are unrelated projects.

## Unreviewed In-Flight Edits

**None in the working tree.** No modified files, no uncommitted changes.

The only "in-flight" item is the local-only commit `e8b784c` which appears not to have reached origin despite the earlier push exit code 0. **Recommendation: re-push and verify with `git log origin/claude/solana-trading-bot-8F0kL` before starting Phase 3.** This is not a code change — just a sync issue.

## Iter-B comparison

There is no `iter-B` branch, folder, tag, or worktree anywhere in this repo. Nothing to compare. Skipping.

## Next Best Action

Move to Phase 3 with the highest-impact fix identified below. Make the smallest useful change, run verification, update docs, stop.

## Completed in this session (Phase 1 + 2)

- Read CLAUDE.md and confirmed phase rules.
- Inspected README.md, package.json, src/ tree, all docs/* placeholders.
- Audited which scoring/strategy modules are wired vs orphaned.
- Confirmed test baseline: 75/75 vitest passing, typecheck clean.
- Wrote Phase 2 documents.

## In Progress

Awaiting approval to start Phase 3.

## Blocked

- Per-strategy expectancy table is empty until paper trade volume rises (depends on Phase 3 fix).
- Wallet auto-promotion has no real-world track record yet (depends on `watched_wallets` being populated, which depends on either manual `pnpm wallet:add` or the auto-discovery loop firing on Birdeye trending data over hours).
- Backtester compatibility with new `ScoreBreakdown` fields (`sourceStack`, `freshness`) is unverified; running it may surface schema errors.
