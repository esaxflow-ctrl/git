"""Entry point — start tracker, dashboard, or both."""
from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from pathlib import Path

# Ensure project root is on path
sys.path.insert(0, str(Path(__file__).parent))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
logging.getLogger("aiohttp").setLevel(logging.WARNING)
logging.getLogger("sqlalchemy").setLevel(logging.WARNING)

log = logging.getLogger("main")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="polymarket-tracker",
        description="Polymarket Informed-Flow Tracker",
    )
    sub = p.add_subparsers(dest="command", required=True)

    # tracker — runs the polling loop
    t = sub.add_parser("track", help="Start the tracker polling loop")
    t.add_argument("--mode", choices=["alert_only","paper","manual_approval","semi_auto","full_auto"],
                   help="Override execution mode")

    # dashboard — serves the web UI
    d = sub.add_parser("dashboard", help="Start the web dashboard only")
    d.add_argument("--host", default=None)
    d.add_argument("--port", type=int, default=None)

    # all — tracker + dashboard
    a = sub.add_parser("all", help="Start tracker + dashboard together")
    a.add_argument("--mode", choices=["alert_only","paper","manual_approval","semi_auto","full_auto"],
                   help="Override execution mode")
    a.add_argument("--host", default=None)
    a.add_argument("--port", type=int, default=None)

    # score — score a single wallet and print result
    s = sub.add_parser("score-wallet", help="Score a single wallet address")
    s.add_argument("address", help="Wallet address (0x…)")

    # add-wallet — manually add a wallet to track
    aw = sub.add_parser("add-wallet", help="Manually add a wallet address to track")
    aw.add_argument("address", help="Wallet proxy address from polymarket.com/profile/<address>")

    # backtest — print backtest summary
    sub.add_parser("backtest", help="Print backtest summary from DB")

    # rescore-all — re-run scoring on every wallet currently in the DB
    sub.add_parser("rescore-all", help="Re-score all wallets in DB using current metrics logic")

    return p.parse_args()


async def run_tracker(mode: str | None = None) -> None:
    from src.config import get_settings
    s = get_settings()
    if mode:
        s.execution_mode = mode
    log.info("Execution mode: %s", s.execution_mode)

    from src.tracker import Tracker
    tracker = Tracker()
    try:
        await tracker.run()
    except KeyboardInterrupt:
        log.info("Shutting down tracker…")
        tracker.stop()


async def run_dashboard(host: str | None = None, port: int | None = None) -> None:
    from src.config import get_settings
    from src.database import init_db
    import uvicorn

    await init_db()
    s = get_settings()
    config = uvicorn.Config(
        "dashboard.app:app",
        host=host or s.dashboard_host,
        port=port or s.dashboard_port,
        log_level="info",
        loop="asyncio",
    )
    server = uvicorn.Server(config)
    await server.serve()


async def run_all(mode: str | None = None, host: str | None = None, port: int | None = None) -> None:
    from src.config import get_settings
    s = get_settings()
    if mode:
        s.execution_mode = mode

    from src.tracker import Tracker
    from src.database import init_db
    import uvicorn

    await init_db()

    tracker = Tracker()
    config = uvicorn.Config(
        "dashboard.app:app",
        host=host or s.dashboard_host,
        port=port or s.dashboard_port,
        log_level="warning",
        loop="asyncio",
    )
    server = uvicorn.Server(config)

    try:
        await asyncio.gather(tracker.run(), server.serve())
    except KeyboardInterrupt:
        log.info("Shutting down…")
        tracker.stop()


async def score_wallet(address: str) -> None:
    from src.api.gamma_client import GammaClient
    from src.api.data_client import DataClient
    from src.scoring.wallet_scorer import WalletScorer, build_metrics_from_api

    gamma = GammaClient()
    data  = DataClient()

    log.info("Fetching data for %s…", address)
    profile   = await data.get_profile(address) or {}
    positions = await gamma.get_all_positions(address)
    activity  = await data.get_all_activity(address, max_pages=5)

    metrics = build_metrics_from_api(address, profile, positions, activity)
    result  = WalletScorer().score(metrics)
    print(result)

    await gamma.close()
    await data.close()


async def add_wallet(address: str) -> None:
    from src.database import init_db
    from src.tracker import Tracker
    await init_db()
    t = Tracker()
    await t._refresh_markets()
    log.info("Scoring wallet %s …", address)
    await t._upsert_wallet(address.lower(), {"address": address.lower()})
    log.info("Done — wallet saved. Restart the tracker to begin monitoring it.")
    await t.gamma.close()
    await t.data.close()


async def rescore_all() -> None:
    """Re-score every wallet currently in the DB using the current metrics logic."""
    import asyncio as _asyncio
    from sqlalchemy import select
    from src.database import init_db, SessionLocal, WalletDB
    from src.tracker import Tracker
    from src.config import get_settings

    await init_db()
    t = Tracker()

    async with SessionLocal() as db:
        rows = (await db.execute(select(WalletDB.address))).scalars().all()

    log.info("Re-scoring %d wallets…", len(rows))
    sem = _asyncio.Semaphore(get_settings().wallet_score_concurrency)
    done = 0

    async def _one(addr: str) -> None:
        nonlocal done
        async with sem:
            await t._upsert_wallet(addr, {"address": addr})
        done += 1
        if done % 25 == 0:
            log.info("Re-scored %d/%d…", done, len(rows))

    await _asyncio.gather(*(_one(a) for a in rows), return_exceptions=True)
    log.info("Done — re-scored %d wallets", done)
    await t.gamma.close()
    await t.data.close()


async def print_backtest() -> None:
    from src.database import init_db
    from src.api.gamma_client import GammaClient
    from src.api.clob_client import ClobClient
    from src.backtesting.backtest import Backtester
    import json

    await init_db()
    gamma = GammaClient()
    clob  = ClobClient()
    bt    = Backtester(gamma, clob)
    summary = await bt.compute_summary()
    print(json.dumps(summary, indent=2))
    await gamma.close()
    await clob.close()


def main() -> None:
    args = parse_args()

    # Load .env from tracker directory
    from dotenv import load_dotenv
    env_path = Path(__file__).parent / ".env"
    load_dotenv(dotenv_path=env_path, override=False)

    if args.command == "track":
        asyncio.run(run_tracker(getattr(args, "mode", None)))
    elif args.command == "dashboard":
        asyncio.run(run_dashboard(getattr(args, "host", None), getattr(args, "port", None)))
    elif args.command == "all":
        asyncio.run(run_all(getattr(args, "mode", None), getattr(args, "host", None), getattr(args, "port", None)))
    elif args.command == "score-wallet":
        asyncio.run(score_wallet(args.address))
    elif args.command == "add-wallet":
        asyncio.run(add_wallet(args.address))
    elif args.command == "backtest":
        asyncio.run(print_backtest())
    elif args.command == "rescore-all":
        asyncio.run(rescore_all())


if __name__ == "__main__":
    main()
