# Evals and Verification

## Hard gates (must pass before any "done" claim)

```bash
pnpm typecheck   # tsc --noEmit, must be clean
pnpm test        # vitest run, must be 75/75 (current baseline) or higher
```

If either fails, the task is not done — fix the failure or document it in `ERROR_LOG.md` before stopping.

## Functional evidence required per feature

A feature in `FEATURES.json` may only be marked `passing` with one of:

- A passing unit test in `src/tests/` whose name maps to the feature.
- A captured `pnpm scan` / `pnpm paper` log showing the feature firing on real data, plus a SQL query result confirming the expected DB rows (e.g. `closed_positions`, `rejected_trades`, `wallet_pnl_summary`).
- A captured CLI dashboard screenshot/text showing the feature surfaced.

Test passing alone is **not sufficient** for any feature whose value is "wired into the live pipeline" — that requires the `pnpm paper` evidence.

## Status definitions

- `passing` — has the evidence above. Module is wired into `evaluate()` (when applicable) and produces non-zero output on real data.
- `failing` — evidence shows the module is not wired into the live pipeline OR a verification command crashes.
- `unknown` — the module exists and (where applicable) its unit tests pass, but we have no production evidence yet. Default for anything that depends on a populated DB or live API.

## Project-level success metric

The bot is considered "core working end-to-end" only when **all** of these hold simultaneously:

1. `pnpm typecheck` clean
2. `pnpm test` ≥75/75
3. ≥30 closed positions in `closed_positions` (mode=paper) over a multi-day continuous run
4. `perStrategyExpectancy('paper')` returns ≥1 strategy with ≥10 trades and positive expectancy
5. Dashboard renders without errors during a 1+ hour run
6. `rejected_trades` reasons are human-readable and look like real rejections, not error fallbacks

Until all 6 are true, the headline status in `PROGRESS.md` is `core-pipeline: failing`.

## Manual sanity checks

- App starts without crashing (`pnpm paper` boots and prints first dashboard tick).
- No repeating identical errors in stderr over a 5-minute window.
- `data/bot.sqlite` grows: `token_snapshots`, `combined_signals`, `rejected_trades` accumulate.
- Latency line in dashboard shows sane RPC numbers (typically <500ms).
- No exposure of API keys or wallet private keys in logs.

## Phase 4 #1 evidence template (eventScore wiring)

`scoring-event` is `passing` based on test evidence (Phase 5):

- `pnpm test src/tests/eventScore.test.ts` (4 tests on the pure scorer)
- `pnpm test src/tests/eventWiring.test.ts` (4 tests on the DB helper)
- `pnpm test src/tests/newsScannerWiring.test.ts` (7 tests covering NewsScanner.runOnce inactive-on-empty + persistConfirmedCandidates filtering + persisted-event roundtrip + non-zero scoreEvent chain)

Production confirmation (separate, optional) requires this query to return rows after seeding `x_accounts` and running `pnpm paper`:

```sql
SELECT token_address, master_score,
       json_extract(breakdown_json, '$.event') AS event_score,
       recommendation
  FROM combined_signals
  WHERE json_extract(breakdown_json, '$.event') > 0
  ORDER BY generated_at DESC LIMIT 10;
```

## Phase 5 evidence template (NewsScanner main-loop wiring)

`news-scanner-loop` is `passing` based on:

- `pnpm test src/tests/newsScannerWiring.test.ts` (7/7 passing)
- Boot smoke test: with empty `x_accounts` the bot prints `NewsScanner inactive: ...` and proceeds without crashing.

Production confirmation requires a seeded `x_accounts` row, a 30-min wait, and:

```sql
SELECT id, source, published_at, credibility, tokens_json
  FROM news_events ORDER BY published_at DESC LIMIT 5;
```
followed by the `combined_signals` query above.

## SQL spot checks (run against `./data/bot.sqlite`)

```sql
-- closed-trade volume since a commit
SELECT COUNT(*), SUM(realised_pnl_sol) FROM closed_positions
  WHERE mode='paper' AND exit_ts >= <ts_ms>;

-- per-strategy expectancy
SELECT strategy, COUNT(*) AS n,
       SUM(CASE WHEN realised_pnl_sol>0 THEN 1 ELSE 0 END) AS wins,
       SUM(realised_pnl_sol) AS net,
       AVG(realised_pnl_sol) AS expectancy
  FROM closed_positions WHERE mode='paper' GROUP BY strategy;

-- rejection reasons sanity
SELECT rejection_reason, COUNT(*) FROM rejected_trades
  GROUP BY rejection_reason ORDER BY 2 DESC LIMIT 20;

-- watched-wallet status distribution
SELECT label, COUNT(*) FROM watched_wallets GROUP BY label;

-- wallet auto-discovery proposals
SELECT * FROM wallet_pnl_summary ORDER BY net_realised_pnl_sol DESC LIMIT 10;
```

## What "evidence" looks like in a Phase 3 commit

When marking any feature `passing`, paste the relevant SQL result (or test output, or dashboard line) into `PROGRESS.md` under "Latest Update" with the commit SHA. Without that paste, leave the feature as `unknown`.
