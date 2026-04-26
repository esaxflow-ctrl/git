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

from sqlalchemy import select, and_

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


def _parse_prices(raw) -> list:
    """Gamma API sometimes returns outcomePrices as a JSON string instead of a list."""
    import json
    if isinstance(raw, list):
        return raw
    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except Exception:
            pass
    return [0.5, 0.5]


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

        # Markets must load before wallet discovery (token IDs needed for CLOB trade lookup)
        await self._refresh_markets()

        # Initial wallet load
        await self._refresh_wallets()

        # Run all loops concurrently
        await asyncio.gather(
            self._poll_loop(),
            self._wallet_refresh_loop(),
            self._backtest_loop(),
            self._resolution_loop(),
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

    async def _resolution_loop(self) -> None:
        while self._running:
            await asyncio.sleep(900)  # every 15 minutes
            try:
                await self._check_resolved_markets()
            except Exception as exc:
                log.error("Resolution check error: %s", exc, exc_info=True)

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
            # Look up token_id for the correct outcome side
            token_id = await self._get_token_id(trade.condition_id, trade.outcome)
            if not token_id:
                log.warning("No token_id found for %s %s — skipping live order", trade.condition_id[:12], trade.outcome)
                return

            log.info("Auto-executing alert %d ($%.2f)", alert_id, risk.adjusted_size_usd)
            await self.order_executor.place_limit_order(
                alert_id=alert_id,
                condition_id=trade.condition_id,
                token_id=token_id,
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

        if not entries:
            log.warning("All leaderboard endpoints failed — discovering wallets from market holders")
            entries = await self._discover_wallets_from_markets()

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

    async def _discover_wallets_from_markets(self) -> list[dict]:
        """Fallback wallet discovery: try several public API endpoints for wallet addresses."""
        seen: set[str] = set()
        entries: list[dict] = []

        def _extract(rows: list) -> None:
            for row in rows:
                addr = (
                    row.get("proxyWallet") or row.get("user") or
                    row.get("address") or row.get("userId") or
                    row.get("maker") or ""
                ).lower()
                if addr and len(addr) >= 10 and addr not in seen:
                    seen.add(addr)
                    entries.append({"address": addr})

        # Attempt 1: Data API global positions (no user filter)
        for params in [
            {"sizeThreshold": 10, "limit": 500},
            {"limit": 500},
        ]:
            try:
                data = await self.data._get(self.data._DATA_BASE, "/positions", params=params)
                rows = data if isinstance(data, list) else (data or {}).get("positions", (data or {}).get("data", []))
                if rows:
                    _extract(rows)
                    log.info("Data API /positions (no user) → %d addresses", len(entries))
                    break
            except Exception:
                pass

        # Attempt 2: Data API recent activity (no user filter)
        if len(entries) < 50:
            for params in [{"limit": 500}, {"limit": 200, "type": "TRADE"}]:
                try:
                    data = await self.data._get(self.data._DATA_BASE, "/activity", params=params)
                    rows = data if isinstance(data, list) else (data or {}).get("activity", (data or {}).get("data", []))
                    if rows:
                        _extract(rows)
                        log.info("Data API /activity (no user) → %d addresses", len(entries))
                        break
                except Exception:
                    pass

        # Attempt 3: Gamma positions with no user filter
        if len(entries) < 50:
            try:
                data = await self.gamma._get("/positions", params={"limit": 500, "sizeThreshold": 10})
                rows = data if isinstance(data, list) else (data or {}).get("positions", [])
                if rows:
                    _extract(rows)
                    log.info("Gamma /positions (no user) → %d addresses", len(entries))
            except Exception:
                pass

        log.info("Wallet discovery found %d unique addresses (manual seeding may be needed if 0)", len(entries))
        return entries

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
                    prices = _parse_prices(m.get("outcomePrices", [0.5, 0.5]))
                    row.yes_price = float(prices[0]) if prices else 0.5
                    row.no_price = float(prices[1]) if len(prices) > 1 else 0.5
                    row.liquidity_usd = float(m.get("liquidity", 0) or 0)
                    row.volume_24h_usd = float(m.get("volume24hr", m.get("volume", 0)) or 0)
                    row.last_updated = datetime.now(timezone.utc)

                    # Extract token IDs for CLOB order placement
                    import json as _json
                    tokens = m.get("clobTokenIds", m.get("tokens", []))
                    if isinstance(tokens, str):
                        try:
                            tokens = _json.loads(tokens)
                        except Exception:
                            tokens = []
                    if isinstance(tokens, list) and tokens and isinstance(tokens[0], dict):
                        for tok in tokens:
                            outcome = tok.get("outcome", "").upper()
                            if outcome in ("YES", "1"):
                                row.yes_token_id = tok.get("token_id", row.yes_token_id)
                            elif outcome in ("NO", "2"):
                                row.no_token_id = tok.get("token_id", row.no_token_id)
                    else:
                        if isinstance(tokens, list) and len(tokens) >= 1:
                            row.yes_token_id = str(tokens[0]) if tokens[0] else row.yes_token_id
                        if isinstance(tokens, list) and len(tokens) >= 2:
                            row.no_token_id = str(tokens[1]) if tokens[1] else row.no_token_id

                    # End date and resolution status
                    end_date_str = m.get("endDate") or m.get("end_date_iso") or m.get("end")
                    if end_date_str:
                        try:
                            from datetime import timezone as _tz
                            import dateutil.parser as _dp
                            row.end_date = _dp.parse(end_date_str).astimezone(_tz.utc).replace(tzinfo=None)
                        except Exception:
                            pass

                    if m.get("resolved") or m.get("isResolved"):
                        row.is_resolved = True
                        row.is_closed = True
                    elif m.get("closed") or m.get("isClosed"):
                        row.is_closed = True

                await db.commit()

        except Exception as exc:
            log.error("_refresh_markets: %s", exc, exc_info=True)

    async def _check_resolved_markets(self) -> None:
        """Detect newly resolved markets and close out paper trades / backtest records."""
        now = datetime.now(timezone.utc)
        async with SessionLocal() as db:
            stmt = select(MarketDB).where(
                and_(
                    MarketDB.is_resolved == False,
                    MarketDB.is_closed == False,
                    MarketDB.end_date != None,
                    MarketDB.end_date <= now,
                )
            ).limit(50)
            result = await db.execute(stmt)
            candidates = result.scalars().all()

        if not candidates:
            return

        log.info("Checking %d markets past end_date for resolution", len(candidates))
        for market in candidates:
            try:
                data = await self.gamma.get_market(market.condition_id)
                if not data:
                    continue
                resolved = data.get("resolved", False) or data.get("isResolved", False)
                if not resolved:
                    continue

                # Determine resolution price (YES = 1.0, NO = 0.0)
                resolution_outcome = (data.get("resolutionOutcome") or "").upper()
                winners = data.get("winners", [])
                if resolution_outcome == "YES" or "YES" in winners:
                    resolution_price = 1.0
                elif resolution_outcome == "NO" or "NO" in winners:
                    resolution_price = 0.0
                else:
                    prices = data.get("outcomePrices", [])
                    resolution_price = float(prices[0]) if prices else 0.5

                log.info(
                    "Market resolved: %s → %.0f (%.60s)",
                    market.condition_id[:16],
                    resolution_price,
                    market.question,
                )

                # Close paper trades and fill backtest resolution price
                await self.paper_trader.mark_resolved(market.condition_id, resolution_price)
                await self.backtester.mark_resolved(market.condition_id, resolution_price)

                # Mark market as resolved in DB
                async with SessionLocal() as db:
                    stmt = select(MarketDB).where(MarketDB.condition_id == market.condition_id)
                    row = (await db.execute(stmt)).scalar_one_or_none()
                    if row:
                        row.is_resolved = True
                        row.is_closed = True
                        await db.commit()

            except Exception as exc:
                log.warning("_check_resolved_markets %s: %s", market.condition_id[:12], exc)

    async def _get_token_id(self, condition_id: str, outcome: str) -> str:
        """Return the CLOB token_id for a given market outcome."""
        async with SessionLocal() as db:
            stmt = select(MarketDB).where(MarketDB.condition_id == condition_id)
            row = (await db.execute(stmt)).scalar_one_or_none()
        if row:
            if outcome.upper() in ("YES", "1"):
                return row.yes_token_id or ""
            return row.no_token_id or ""
        # Fallback: fetch live from gamma
        try:
            m = await self.gamma.get_market(condition_id)
            if m:
                tokens = m.get("clobTokenIds", m.get("tokens", []))
                if isinstance(tokens, list) and outcome.upper() in ("NO", "2") and len(tokens) >= 2:
                    return str(tokens[1])
                if isinstance(tokens, list) and len(tokens) >= 1:
                    return str(tokens[0])
        except Exception:
            pass
        return ""
