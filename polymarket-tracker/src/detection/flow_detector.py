"""Abnormal flow detector.

Compares current wallet positions against the last snapshot to detect:
  - New positions opened
  - Position size increases (adds)
  - Position exits
  - Unusually large single entries
  - Cluster buying (multiple sharp wallets on same side)
"""
from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.gamma_client import GammaClient
from src.api.clob_client import ClobClient
from src.api.data_client import DataClient
from src.config import get_settings
from src.database import SessionLocal, WalletDB, MarketDB, PositionSnapshotDB, TradeDB
from src.scoring.signal_scorer import SignalScorer, TradeContext, SignalScoreResult

log = logging.getLogger(__name__)
settings = get_settings()
_scorer = SignalScorer()


@dataclass
class DetectedTrade:
    """A trade detected from position delta."""
    wallet_address: str
    wallet_sharp_score: float
    wallet_username: str | None

    condition_id: str
    market_question: str
    category: str

    outcome: str
    side: str  # BUY / SELL
    estimated_size_usd: float
    estimated_shares: float
    entry_price: float

    prev_size_usd: float  # before this trade
    prev_shares: float

    current_market_price: float
    spread: float
    liquidity_usd: float
    volume_24h_usd: float

    wallet_avg_trade_usd: float
    wallet_median_trade_usd: float

    detected_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    signal_result: Optional[SignalScoreResult] = None


class FlowDetector:
    """
    Polls tracked wallets and detects abnormal position changes.
    """

    def __init__(
        self,
        gamma: GammaClient,
        clob: ClobClient,
        data: DataClient,
    ) -> None:
        self.gamma = gamma
        self.clob = clob
        self.data = data
        # In-memory cache of last known positions per wallet
        # {wallet_address: {condition_id: {outcome: {"shares": float, "usd": float}}}}
        self._position_cache: dict[str, dict[str, dict[str, dict]]] = {}
        # Market info cache: {condition_id: (info_dict, fetched_at_timestamp)}
        self._market_cache: dict[str, tuple[dict, float]] = {}
        self._market_cache_ttl: float = 300.0  # 5 minutes

    # ── Public API ────────────────────────────────────────────────────────────

    async def scan_all_wallets(self) -> list[DetectedTrade]:
        """Scan all tracked wallets and return detected trades."""
        async with SessionLocal() as db:
            result = await db.execute(
                select(WalletDB).where(WalletDB.sharp_score >= 30).order_by(WalletDB.sharp_score.desc())
            )
            wallets = result.scalars().all()

        if not wallets:
            log.info("No wallets to scan yet")
            return []

        log.info("Scanning %d wallets for position changes...", len(wallets))

        all_trades: list[DetectedTrade] = []
        # Batch concurrently but throttle to avoid hammering APIs
        chunk_size = 10
        for i in range(0, len(wallets), chunk_size):
            chunk = wallets[i : i + chunk_size]
            tasks = [self._scan_wallet(w) for w in chunk]
            results = await asyncio.gather(*tasks, return_exceptions=True)
            for res in results:
                if isinstance(res, Exception):
                    log.warning("Wallet scan error: %s", res)
                elif isinstance(res, list):
                    all_trades.extend(res)
            await asyncio.sleep(0.5)

        # Cluster detection: mark which trades have multiple sharp wallets
        all_trades = self._annotate_clusters(all_trades)

        # Score each trade
        for trade in all_trades:
            trade.signal_result = self._score_trade(trade, all_trades)

        # Persist detected trades
        await self._persist_trades(all_trades)

        log.info("Detected %d trades this scan cycle", len(all_trades))
        return all_trades

    async def _scan_wallet(self, wallet: WalletDB) -> list[DetectedTrade]:
        """Detect position changes for a single wallet."""
        try:
            positions = await self.gamma.get_all_positions(wallet.address)
        except Exception as exc:
            log.warning("get_positions %s: %s", wallet.address, exc)
            return []

        prev = self._position_cache.get(wallet.address, {})
        curr: dict[str, dict[str, dict]] = {}
        trades: list[DetectedTrade] = []

        for pos in positions:
            cid = pos.get("conditionId", pos.get("market", ""))
            outcome = pos.get("outcome", pos.get("side", "YES"))
            shares = float(pos.get("size", pos.get("shares", 0)) or 0)
            avg_price = float(pos.get("avgPrice", pos.get("price", 0)) or 0)
            usd = shares * avg_price

            if not cid:
                continue
            if cid not in curr:
                curr[cid] = {}
            curr[cid][outcome] = {"shares": shares, "usd": usd, "price": avg_price}

            prev_pos = prev.get(cid, {}).get(outcome, {})
            prev_shares = float(prev_pos.get("shares", 0))
            prev_usd = float(prev_pos.get("usd", 0))

            delta_shares = shares - prev_shares
            delta_usd = usd - prev_usd

            # Minimum threshold to count as a real trade
            if abs(delta_shares) < 0.01 or abs(delta_usd) < 1.0:
                continue

            side = "BUY" if delta_shares > 0 else "SELL"

            # Get market info
            market_info = await self._get_market_info(cid)
            market_question = market_info.get("question", f"Market {cid[:12]}...")
            category = market_info.get("category", "unknown")
            current_price = market_info.get("yes_price", avg_price)
            spread = market_info.get("spread", 0.05)
            liquidity = market_info.get("liquidity_usd", 0.0)
            vol_24h = market_info.get("volume_24h_usd", 0.0)

            trade = DetectedTrade(
                wallet_address=wallet.address,
                wallet_sharp_score=wallet.sharp_score,
                wallet_username=wallet.username,
                condition_id=cid,
                market_question=market_question,
                category=category,
                outcome=outcome,
                side=side,
                estimated_size_usd=abs(delta_usd),
                estimated_shares=abs(delta_shares),
                entry_price=avg_price,
                prev_size_usd=prev_usd,
                prev_shares=prev_shares,
                current_market_price=current_price,
                spread=spread,
                liquidity_usd=liquidity,
                volume_24h_usd=vol_24h,
                wallet_avg_trade_usd=wallet.avg_position_size_usd or 100.0,
                wallet_median_trade_usd=wallet.median_position_size_usd or 100.0,
            )
            trades.append(trade)

        # Update cache
        self._position_cache[wallet.address] = curr
        return trades

    async def _get_market_info(self, condition_id: str) -> dict:
        now = time.monotonic()
        cached = self._market_cache.get(condition_id)
        if cached is not None:
            info, fetched_at = cached
            if now - fetched_at < self._market_cache_ttl:
                return info

        try:
            market = await self.gamma.get_market(condition_id)
            if market:
                import json as _json
                raw_prices = market.get("outcomePrices", [0.5, 0.5])
                if isinstance(raw_prices, str):
                    try:
                        raw_prices = _json.loads(raw_prices)
                    except Exception:
                        raw_prices = [0.5, 0.5]
                prices = raw_prices if isinstance(raw_prices, list) else [0.5, 0.5]
                yes_price = float(prices[0] or 0.5) if prices else 0.5

                # Extract token IDs so we can fetch real spread from CLOB
                tokens = market.get("clobTokenIds", market.get("tokens", []))
                yes_token_id = ""
                if isinstance(tokens, list) and len(tokens) >= 1:
                    yes_token_id = str(tokens[0]) if tokens[0] else ""
                elif isinstance(tokens, list) and tokens and isinstance(tokens[0], dict):
                    for tok in tokens:
                        if tok.get("outcome", "").upper() in ("YES", "1"):
                            yes_token_id = tok.get("token_id", "")
                            break

                # Fetch real spread from CLOB if we have a token_id
                spread = 0.03
                if yes_token_id:
                    try:
                        ob = await self.clob.get_orderbook_summary(yes_token_id)
                        spread = ob.get("spread", 0.03)
                        # Also use CLOB mid as a more accurate price
                        clob_mid = ob.get("mid", 0.0)
                        if 0.01 <= clob_mid <= 0.99:
                            yes_price = clob_mid
                    except Exception:
                        pass

                info = {
                    "question": market.get("question", ""),
                    "category": market.get("category", ""),
                    "yes_price": yes_price,
                    "yes_token_id": yes_token_id,
                    "spread": spread,
                    "liquidity_usd": float(market.get("liquidity", 0) or 0),
                    "volume_24h_usd": float(market.get("volume24hr", market.get("volume", 0)) or 0),
                }
                self._market_cache[condition_id] = (info, now)
                return info
        except Exception as exc:
            log.debug("_get_market_info %s: %s", condition_id, exc)

        default = {
            "question": f"Market {condition_id[:12]}",
            "category": "unknown",
            "yes_price": 0.5,
            "yes_token_id": "",
            "spread": 0.05,
            "liquidity_usd": 0.0,
            "volume_24h_usd": 0.0,
        }
        self._market_cache[condition_id] = (default, now)
        return default

    def _annotate_clusters(self, trades: list[DetectedTrade]) -> list[DetectedTrade]:
        """Count how many other sharp wallets are on the same side."""
        # Group by (condition_id, outcome, side)
        from collections import Counter
        key_counts: Counter = Counter()
        for t in trades:
            if t.wallet_sharp_score >= 50:
                key_counts[(t.condition_id, t.outcome, t.side)] += 1

        # Annotate: other wallets = total - 1 (self)
        for t in trades:
            key = (t.condition_id, t.outcome, t.side)
            t._cluster_count = max(0, key_counts[key] - 1)
        return trades

    def _score_trade(self, trade: DetectedTrade, all_trades: list[DetectedTrade]) -> SignalScoreResult:
        cluster_count = getattr(trade, "_cluster_count", 0)
        ctx = TradeContext(
            wallet_address=trade.wallet_address,
            wallet_sharp_score=trade.wallet_sharp_score,
            wallet_avg_trade_size_usd=trade.wallet_avg_trade_usd,
            wallet_median_trade_size_usd=trade.wallet_median_trade_usd,
            trade_size_usd=trade.estimated_size_usd,
            trade_outcome=trade.outcome,
            entry_price=trade.entry_price,
            condition_id=trade.condition_id,
            market_question=trade.market_question,
            category=trade.category,
            current_price=trade.current_market_price,
            spread=trade.spread,
            liquidity_usd=trade.liquidity_usd,
            volume_24h_usd=trade.volume_24h_usd,
            volume_total_usd=0.0,
            seconds_to_resolution=0.0,
            price_at_detection=trade.current_market_price,
            price_before_wallet_entry=0.0,
            other_sharp_wallets_same_side=cluster_count,
            estimated_social_volume=0.1,
            has_obvious_public_news=False,
            filled_through_book=trade.estimated_size_usd > trade.liquidity_usd * 0.05,
        )
        return _scorer.score(ctx)

    async def _persist_trades(self, trades: list[DetectedTrade]) -> None:
        if not trades:
            return
        async with SessionLocal() as db:
            for t in trades:
                db.add(TradeDB(
                    wallet_address=t.wallet_address,
                    condition_id=t.condition_id,
                    outcome=t.outcome,
                    side=t.side,
                    size_usd=t.estimated_size_usd,
                    shares=t.estimated_shares,
                    price=t.entry_price,
                ))
            await db.commit()
