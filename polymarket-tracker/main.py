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

    # backtest — print backtest summary
    sub.add_parser("backtest", help="Print backtest summary from DB")

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
    elif args.command == "backtest":
        asyncio.run(print_backtest())


if __name__ == "__main__":
    main()
