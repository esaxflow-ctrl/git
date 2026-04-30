# Progress Log

## Current Status

**Headline:** `core-pipeline: failing` — paper trade volume is still too low to measure expectancy. Code quality is healthy (typecheck clean, 86/86 tests pass) and the evaluate() path now reaches ~9 of the 14 weighted breakdown components. The remaining orphans (`buzz`, `narrative`, `pumpfun`, standalone `dexscreenerBoost`) keep the master signal partially capped. NewsScanner is now wired but inactive until `x_accounts` is seeded.

**Branch:** `claude/solana-trading-bot-8F0kL` — synced with origin after Phase 4 rebase.
**Latest pushed commit:** `69307d4` (Phase 4 #1) — Phase 5 commit pending below.

## Latest Update (2026-04-29 — Phase 5)

**Wired `NewsScanner` into the main loop.** This closes the dormant half of Phase 4 #1: `eventScore` now has a real ingestion path (NewsScanner → news_events → recentNewsEventForToken → evaluate → breakdown.event), and the chain is fully test-covered.

What was missing: NewsScanner existed with `fetchCuratedPosts()` and `persistEvent()` but was never instantiated in `src/index.ts`. The eventScore wiring shipped in Phase 4 was correct but always dormant because `news_events` was empty.

How NewsScanner now enters the main loop:
1. Two new methods on `NewsScanner`:
   - `persistConfirmedCandidates(candidates)`: filters to candidates with at least one external CA confirmation (DexScreener or Birdeye), maps to `NewsEvent`, persists. Returns count persisted.
   - `runOnce()`: calls `fetchCuratedPosts()` then `persistConfirmedCandidates()`. Short-circuits with `{accounts:0, fetched:0, persisted:0}` when X is unconfigured or `x_accounts` is empty.
2. `index.ts` instantiates NewsScanner alongside the other scanners. At boot, queries `x_accounts` count and `x.isConfigured()`. When all three preconditions hold (`ENABLE_NEWS_EVENTS && x.isConfigured() && x_accounts.length > 0`), starts a 30-minute setInterval calling `newsScanner.runOnce()`.
3. When inactive, logs a yellow `NewsScanner inactive: <reasons>. Seed curated accounts to enable event scoring.` warning at boot — and never starts the interval (zero CPU/quota cost).

What happens when x_accounts is empty: bot starts cleanly, prints the inactive warning, all other features run normally. `breakdown.event` stays at its `emptyBreakdown()` default of 0. Verified by `src/tests/newsScannerWiring.test.ts` (7/7 passing).

How eventScore becomes non-zero: when a curated x_account posts a CA, the next 30-minute tick fetches the post via `XAdapter.searchRecent`, confirms it on DexScreener or Birdeye, and persists it. The next time `evaluate()` runs against that token's snapshot, `recentNewsEventForToken()` returns the row and `scoreEvent()` is invoked, populating `breakdown.event`.

Polling cadence: 30 minutes. Reasoning: X free tier is brutal (~100 reads/month). 30-min × N curated accounts is already a meaningful share of a free user's budget; lower it only with paid X access. Documented in DECISIONS.md.

Files changed:
- `src/scanners/newsScanner.ts` — added `persistConfirmedCandidates()` and `runOnce()`.
- `src/index.ts` — added `NewsScanner` import, instantiation, boot-time inactive warning, conditional interval.
- `src/tests/newsScannerWiring.test.ts` — new file, 7 tests covering empty-x_accounts inactive behaviour, candidate filtering, tokens_json shape, recentNewsEventForToken roundtrip, and the chain to non-zero scoreEvent.
- `docs/FEATURES.json` — `scoring-event` flipped to `passing` with chain-test evidence; new `news-scanner-loop` feature added.
- `docs/DECISIONS.md` — added entry for "NewsScanner inactive when seed empty" + "30-min polling default".
- `docs/RUNBOOK.md` — added "Seeding x_accounts for event scoring" section.
- `docs/EVALS.md` — added Phase 5 evidence template.

Verification:
```
pnpm typecheck    # clean
pnpm test         # 86/86 passing across 17 files
```

## Phase 4 #1 (2026-04-29)

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
