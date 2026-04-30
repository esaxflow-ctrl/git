# Runbook

## How to Resume This Project

1. Read `CLAUDE.md`.
2. Read `docs/PROJECT_GOAL.md`.
3. Read `docs/FEATURES.json`.
4. Read `docs/PROGRESS.md`.
5. Read `docs/ERROR_LOG.md`.
6. Read `docs/DECISIONS.md`.
7. Pick the highest-impact failing feature.
8. Fix one thing only (Phase 3 = single feature).
9. Run verification (see below).
10. Update docs.
11. Stop and report.

## First-time setup

```bash
pnpm install
cp .env.example .env
# fill in HELIUS_API_KEY, BIRDEYE_API_KEY, X_BEARER_TOKEN, JUPITER_API_KEY,
# WALLET_PUBLIC_KEY (a public key only — never paste a private key into chat).
mkdir -p data keys
```

If you are configuring live trading later, the keypair JSON path is in
`PRIVATE_KEY_PATH` (default `./keys/trading-wallet.json`). Permissions on
that file should be `chmod 600`. **Never paste a private key into chat
or any source file.**

## Verification commands (Phase-3 hard gates)

```bash
pnpm typecheck   # tsc --noEmit, must be clean
pnpm test        # vitest run, must be 75/75 (current baseline)
```

## Run modes

| Command | What it does |
|---|---|
| `pnpm dev` | Watch-mode boot of the full pipeline in paper mode |
| `pnpm scan` | Discovery + scoring loop, write signals to DB, do not trade |
| `pnpm paper` | Full pipeline, simulated entries/exits via Jupiter quotes |
| `pnpm backtest` | Replay historical token snapshots through the strategies |
| `pnpm live` | **Locked.** Refuses to run unless `LIVE_TRADING=true` and `PAPER_TRADING=false` |
| `pnpm test` | Vitest suite |
| `pnpm typecheck` | TypeScript strict-mode validation |

## Wallet management

```bash
pnpm wallet:list                              # current watched_wallets
pnpm wallet:list:proposed                     # auto-discovered candidates
pnpm wallet:add <addr> ELITE_COPYABLE 90      # manual promotion
pnpm wallet:add <addr> GOOD_BUT_RISKY 60      # slower add
pnpm wallet:remove <addr>
pnpm wallet:discover                          # one-shot wallet discovery run
```

## Long-run paper sessions on Windows (avoid the sleep trap)

A previous session lost 4+ hours of expected paper data because Windows went to sleep. Before starting a long `pnpm paper` run:

1. Open Settings → System → Power & battery.
2. Set both "Sleep" timers to **Never** while plugged in.
3. Optional: also set "Screen" to never turn off if you want to glance at the dashboard.
4. Confirm the kill-switch file path is reachable: `STOP_BOT.txt` in the project root halts new entries.

If the laptop closes / suspends despite settings, the bot stops cleanly — restart it with `pnpm paper`. The exit-manager will tick all open positions on the next loop and any time-based exits will fire on resume.

## Inspecting paper-trade results

```sql
-- recent paper trades
SELECT symbol, strategy, side, amount_sol, price_usd, reason,
       datetime(ts/1000, 'unixepoch') as t
  FROM paper_trades ORDER BY ts DESC LIMIT 20;

-- per-strategy expectancy snapshot
SELECT strategy, COUNT(*) AS n,
       SUM(CASE WHEN realised_pnl_sol > 0 THEN 1 ELSE 0 END) AS wins,
       ROUND(SUM(realised_pnl_sol), 4) AS net,
       ROUND(AVG(realised_pnl_sol), 4) AS expectancy
  FROM closed_positions WHERE mode='paper' GROUP BY strategy
  ORDER BY net DESC;

-- latest rejections + reasons (sanity check that filters are firing)
SELECT symbol, strategy, rejection_reason,
       datetime(ts/1000, 'unixepoch') as t
  FROM rejected_trades ORDER BY ts DESC LIMIT 20;
```

## Seeding `x_accounts` for event scoring

`NewsScanner` ingests posts from a curated set of X handles into the `news_events` table, which `eventScore` then reads in `evaluate()`. The seed list is **deliberately empty** in the default install — auto-seeding production data would silently bias the bot toward whoever the seeder trusted.

### Activation gates

NewsScanner activates at boot only when **all three** hold:
1. `cfg.ENABLE_NEWS_EVENTS` is true (config default)
2. `X_BEARER_TOKEN` is set in `.env` (paid X tier strongly recommended; free tier hits monthly read limits fast)
3. The `x_accounts` table has at least one row

If any gate fails, the bot logs `NewsScanner inactive: <reasons>. Seed curated accounts to enable event scoring.` at boot and never starts the polling interval — zero CPU/quota cost.

### Manual seed (recommended)

Pick handles you trust. For each one, run a one-liner against the SQLite DB:

```bash
sqlite3 data/bot.sqlite "INSERT INTO x_accounts(account_id, handle, category, credibility, notes, added_at) VALUES('any-id', 'official_handle_no_at', 'official_project', 90, 'why you trust this account', $(date +%s%3N));"
```

Field meanings:
- `account_id` — any unique string; X numeric ID is ideal but optional.
- `handle` — without the `@`. Used directly in `from:<handle>` queries.
- `category` — one of `official_project`, `founder`, `news_outlet`, `analyst`. Free-form string, used for downstream filtering.
- `credibility` — 0–100. Drives the `sourceCredibility` slot in `eventScore`. **Be conservative.** 90+ should be reserved for accounts you'd risk real SOL on.
- `notes` — your own free-text rationale. Future-you will thank you.

Restart the bot after seeding — gates are evaluated at boot.

### Listing / removing

```bash
sqlite3 data/bot.sqlite "SELECT handle, category, credibility, notes FROM x_accounts;"
sqlite3 data/bot.sqlite "DELETE FROM x_accounts WHERE handle='bad_handle';"
```

### Polling cadence

Default is 30 minutes (`newsPollIntervalMs` in `src/index.ts`). Each tick issues one `searchRecent` call per seeded account. With X free tier (~100 reads/month) even 30-min polling exhausts the quota with 5 seeded accounts in days. Recommendation: paid X tier, or seed only 1–2 highly-credible accounts.

### What gets persisted

Only candidates whose CA is independently confirmed on **at least one** of DexScreener or Birdeye are persisted to `news_events`. Posts mentioning a CA that neither aggregator knows about are dropped (likely fake-CA scam tweets).

## Safety Rules

Do not modify without explicit user approval:
- `.env` files
- API keys
- Live-trading flags or `liveTrader.ts` execution paths
- `keys/` directory
- Deployment / infra configuration
- Anything with the word "live" in the file name without confirming the change is paper-safe

## Standard Stop Point

After one verified improvement (typecheck + tests green, feature evidenced), stop. Update `docs/PROGRESS.md` and `docs/FEATURES.json` with evidence. Wait for the user to direct the next Phase 3.

## Common gotchas

- **API keys in chat:** if a user pastes a key, tell them to rotate it immediately. Do not write it anywhere.
- **`pnpm push` after a long sequence of commits may report success but `git status` shows ahead-by-N.** Always verify with `git log origin/<branch> -1` after pushes.
- **Birdeye trending limit cap is 20.** Do not request more.
- **DexScreener pair objects can lack `liquidity`.** Always optional-chain.
- **Jupiter quote endpoint is `lite-api.jup.ag/swap/v1`** for free tier; the older `quote-api.jup.ag/v6` is dead.
- **Windows path comparisons via `process.argv[1]`** must go through `fileURLToPath` + `path.resolve` or the entrypoint check silently fails.
