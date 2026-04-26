"""Main orchestrator — coordinates all phases in an async event loop.

Loop structure:
  Every WALLET_REFRESH_INTERVAL_SECONDS:
    - Pull leaderboard
    - Score / update wallets in DB

  Every TRACKER_POLL_INTERVAL_SECONDS:
    - Scan tracked wallets for position changes
    - Score detected trades
    - Fire alerts for signals above threshold
    - Open paper trades if mode == paper
    - Place live orders if mode allows + risk checks pass

  Every 5 minutes:
    - Update backtest checkpoints
    - Update paper-trade prices
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select

from src.api.gamma_client import GammaClient
from src.api.clob_client import ClobClient
from src.api.data_client import DataClient
from src.alerts.alert_manager import AlertManager
from src.backtesting.backtest import Backtester
from src.config import get_settings
from src.database import SessionLocal, WalletDB, MarketDB, init_db
from src.detection.copy_engine import CopyEngine
from src.detection.flow_detector import FlowDetector, DetectedTrade
from src.execution.order_executor import OrderExecutor
from src.execution.paper_trader import PaperTrader
from src.execution.risk_manager import RiskManager
from src.scoring.wallet_scorer import WalletScorer, build_metrics_from_api

log = logging.getLogger(__name__)
settings = get_settings()


class Tracker:

    def __init__(self) -> None:
        self.gamma = GammaClient()
        self.clob = ClobClient()
        self.data = DataClient()

        self.flow_detector = FlowDetector(self.gamma, self.clob, self.data)
        self.wallet_scorer = WalletScorer()
        self.signal_engine = CopyEngine()
        self.alert_manager = AlertManager()
        self.paper_trader = PaperTrader()
        self.order_executor = OrderExecutor()
        self.risk_manager = RiskManager()
        self.backtester = Backtester(self.gamma, self.clob)

        self._last_wallet_refresh: Optional[datetime] = None
        self._running = False

    # ── Entry point ───────────────────────────────────────────────────────────

    async def run(self) -> None:
        log.info("Initialising database…")
        await init_db()

        log.info("Starting tracker (mode=%s, poll=%ds)", settings.execution_mode, settings.tracker_poll_interval_seconds)
        self._running = True

        # Initial wallet load
        await self._refresh_wallets()

        # Initial market snapshot
        await self._refresh_markets()

        # Run all loops concurrently
        await asyncio.gather(
            self._poll_loop(),
            self._wallet_refresh_loop(),
            self._backtest_loop(),
        )

    def stop(self) -> None:
        self._running = False

    # ── Loops ─────────────────────────────────────────────────────────────────

    async def _poll_loop(self) -> None:
        """Core scan loop — detects trades and fires alerts."""
        while self._running:
            try:
                await self._scan_cycle()
            except Exception as exc:
                log.error("Poll cycle error: %s", exc, exc_info=True)
            await asyncio.sleep(settings.tracker_poll_interval_seconds)

    async def _wallet_refresh_loop(self) -> None:
        while self._running:
            await asyncio.sleep(settings.wallet_refresh_interval_seconds)
            try:
                await self._refresh_wallets()
            except Exception as exc:
                log.error("Wallet refresh error: %s", exc, exc_info=True)

    async def _backtest_loop(self) -> None:
        while self._running:
            await asyncio.sleep(300)  # every 5 minutes
            try:
                await self.backtester.update_open_alerts()
            except Exception as exc:
                log.error("Backtest update error: %s", exc, exc_info=True)

    # ── Core scan ─────────────────────────────────────────────────────────────

    async def _scan_cycle(self) -> None:
        log.debug("Starting scan cycle…")
        trades = await self.flow_detector.scan_all_wallets()

        if not trades:
            log.debug("No position changes detected")
            return

        log.info("Processing %d detected trades", len(trades))

        for trade in trades:
            if trade.signal_result is None:
                continue

            signal = trade.signal_result
            decision = self.signal_engine.evaluate(trade, signal)

            if decision.action == "PASS":
                log.debug("PASS: %s (score=%.1f)", trade.condition_id[:12], signal.score)
                continue

            log.info(
                "ALERT: %s | score=%.1f | wallet=%.1f | action=%s",
                trade.market_question[:50],
                signal.score,
                trade.wallet_sharp_score,
                decision.action,
            )

            alert_id = await self.alert_manager.fire(trade, signal, decision)

            # Paper trading
            if settings.execution_mode == "paper" and decision.action in (
                "SMALL_TAIL", "STRONG_WATCH", "MANUAL_APPROVAL"
            ):
                await self.paper_trader.open_trade(
                    alert_id=alert_id,
                    condition_id=trade.condition_id,
                    outcome=trade.outcome,
                    entry_price=trade.current_market_price,
                    size_usd=decision.max_risk_usd,
                )

            # Live execution
            if settings.execution_mode in ("semi_auto", "full_auto"):
                await self._maybe_execute(alert_id, trade, signal, decision)

    async def _maybe_execute(self, alert_id: int, trade: DetectedTrade, signal, decision) -> None:
        """Run risk checks and optionally place a live order."""
        risk = self.risk_manager.check(
            condition_id=trade.condition_id,
            category=trade.category,
            size_usd=decision.max_risk_usd,
            signal_score=signal.score,
            wallet_sharp_score=trade.wallet_sharp_score,
            current_price=trade.current_market_price,
            wallet_entry_price=trade.entry_price,
            spread=trade.spread,
            liquidity_usd=trade.liquidity_usd,
        )
        if not risk.approved:
            log.info("Risk check blocked trade: %s", risk.reason)
            return

        # Manual approval mode — do not auto-execute
        if settings.execution_mode == "semi_auto" and decision.action == "MANUAL_APPROVAL":
            log.info("MANUAL_APPROVAL required for alert %d — skipping auto-exec", alert_id)
            return

        # Auto-execute thresholds
        if (
            signal.score >= settings.min_signal_score_auto
            and trade.wallet_sharp_score >= settings.min_wallet_sharp_score_auto
        ):
            log.info("Auto-executing alert %d ($%.2f)", alert_id, risk.adjusted_size_usd)
            await self.order_executor.place_limit_order(
                alert_id=alert_id,
                condition_id=trade.condition_id,
                token_id="",  # populated from market data lookup in real use
                outcome=trade.outcome,
                side="BUY",
                price=trade.current_market_price,
                size_usd=risk.adjusted_size_usd,
            )
            self.risk_manager.record_entry(
                trade.condition_id, trade.category, risk.adjusted_size_usd
            )

    # ── Wallet discovery / scoring ────────────────────────────────────────────

    async def _refresh_wallets(self) -> None:
        log.info("Refreshing wallet list from leaderboard…")

        entries = await self.data.get_full_leaderboard(max_entries=settings.leaderboard_fetch_limit)
        if not entries:
            log.warning("Leaderboard returned no data — trying gamma endpoint")
            entries = await self.gamma.get_leaderboard()

        log.info("Fetched %d leaderboard entries", len(entries))

        for entry in entries:
            address = (
                entry.get("proxyWallet")
                or entry.get("address")
                or entry.get("walletAddress")
                or ""
            ).lower()
            if not address or len(address) < 10:
                continue

            await self._upsert_wallet(address, entry)

        self._last_wallet_refresh = datetime.now(timezone.utc)
        log.info("Wallet refresh complete")

    async def _upsert_wallet(self, address: str, leaderboard_entry: dict) -> None:
        """Fetch full wallet data, score it, and save to DB."""
        try:
            profile = await self.data.get_profile(address) or leaderboard_entry
            positions = await self.gamma.get_all_positions(address)
            activity = await self.data.get_all_activity(address, max_pages=3)

            metrics = build_metrics_from_api(address, profile, positions, activity)
            result = self.wallet_scorer.score(metrics)

            async with SessionLocal() as db:
                stmt = select(WalletDB).where(WalletDB.address == address)
                row = (await db.execute(stmt)).scalar_one_or_none()

                if row is None:
                    row = WalletDB(address=address)
                    db.add(row)

                row.username = leaderboard_entry.get("username", leaderboard_entry.get("name", ""))
                row.display_name = leaderboard_entry.get("displayName", row.username)
                row.total_profit_usd = metrics.total_profit_usd
                row.total_volume_usd = metrics.total_volume_usd
                row.roi_pct = metrics.roi_pct
                row.markets_traded = metrics.markets_traded
                row.resolved_markets = metrics.resolved_markets
                row.win_count = metrics.win_count
                row.loss_count = metrics.loss_count
                row.win_rate_pct = metrics.win_count / max(1, metrics.win_count + metrics.loss_count) * 100
                row.avg_position_size_usd = metrics.avg_position_size_usd
                row.median_position_size_usd = metrics.median_position_size_usd
                row.largest_position_usd = metrics.largest_position_usd
                row.largest_win_usd = metrics.largest_win_usd
                row.largest_loss_usd = metrics.largest_loss_usd
                row.profit_ex_top_win = metrics.profit_ex_top_win
                row.avg_entry_price = metrics.avg_entry_price
                row.beat_close_rate_pct = metrics.beat_close_rate_pct
                row.early_entry_rate_pct = metrics.early_entry_rate_pct
                row.sharp_score = result.score
                row.last_scored = datetime.now(timezone.utc)

                await db.commit()
                log.debug("Scored wallet %s: %.1f (%s)", address[:10], result.score, result.grade)

        except Exception as exc:
            log.warning("_upsert_wallet %s: %s", address[:10], exc)

    # ── Market snapshot ───────────────────────────────────────────────────────

    async def _refresh_markets(self) -> None:
        log.info("Refreshing active markets…")
        try:
            markets = await self.gamma.get_all_active_markets(max_pages=5)
            log.info("Fetched %d active markets", len(markets))

            async with SessionLocal() as db:
                for m in markets:
                    cid = m.get("conditionId", m.get("id", ""))
                    if not cid:
                        continue

                    stmt = select(MarketDB).where(MarketDB.condition_id == cid)
                    row = (await db.execute(stmt)).scalar_one_or_none()
                    if row is None:
                        row = MarketDB(condition_id=cid)
                        db.add(row)

                    row.question = m.get("question", "")
                    row.category = m.get("category", "")
                    prices = m.get("outcomePrices", [0.5, 0.5])
                    row.yes_price = float(prices[0]) if prices else 0.5
                    row.no_price = float(prices[1]) if len(prices) > 1 else 0.5
                    row.liquidity_usd = float(m.get("liquidity", 0) or 0)
                    row.volume_24h_usd = float(m.get("volume24hr", m.get("volume", 0)) or 0)
                    row.last_updated = datetime.now(timezone.utc)

                await db.commit()

        except Exception as exc:
            log.error("_refresh_markets: %s", exc, exc_info=True)
