"""Backtester — tracks alert outcomes over time.

For every open alert, periodically records the market price at:
  5 min, 30 min, 2 hours, 24 hours, and resolution.

Computes simulated P&L for:
  - Immediate copy (bought at alert's current price)
  - Pullback copy (bought 2% below alert price)
  - Fade (sold the move)
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select

from src.api.gamma_client import GammaClient
from src.api.clob_client import ClobClient
from src.database import SessionLocal, AlertDB, PaperTradeDB

log = logging.getLogger(__name__)

# Checkpoints in seconds after alert creation
CHECKPOINTS = {
    "price_5m":   5 * 60,
    "price_30m":  30 * 60,
    "price_2h":   2 * 3600,
    "price_24h":  24 * 3600,
}


class Backtester:

    def __init__(self, gamma: GammaClient, clob: ClobClient) -> None:
        self.gamma = gamma
        self.clob = clob

    async def update_open_alerts(self) -> None:
        """Fill in price checkpoints for all open alerts."""
        async with SessionLocal() as db:
            result = await db.execute(
                select(AlertDB).where(AlertDB.status == "open")
            )
            alerts = result.scalars().all()

        if not alerts:
            return

        now = datetime.now(timezone.utc)

        for alert in alerts:
            if alert.created_at.tzinfo is None:
                created = alert.created_at.replace(tzinfo=timezone.utc)
            else:
                created = alert.created_at

            elapsed = (now - created).total_seconds()
            updated = False

            for field_name, threshold in CHECKPOINTS.items():
                current_val = getattr(alert, field_name, None)
                if current_val is None and elapsed >= threshold:
                    price = await self._fetch_price(alert.condition_id, alert.outcome)
                    if price is not None:
                        setattr(alert, field_name, price)
                        updated = True

            if updated:
                async with SessionLocal() as db:
                    db.add(alert)
                    await db.commit()

    async def _fetch_price(self, condition_id: str, outcome: str) -> Optional[float]:
        try:
            market = await self.gamma.get_market(condition_id)
            if not market:
                return None
            prices = market.get("outcomePrices", [])
            if outcome.upper() in ("NO", "2"):
                return float(prices[1]) if len(prices) > 1 else None
            return float(prices[0]) if prices else None
        except Exception as exc:
            log.debug("_fetch_price %s: %s", condition_id, exc)
            return None

    async def compute_summary(self) -> dict:
        """Return P&L summary across all alerts that have checkpoint data."""
        async with SessionLocal() as db:
            result = await db.execute(select(AlertDB))
            alerts = result.scalars().all()

        rows = []
        for a in alerts:
            entry = a.current_price_at_alert
            if not entry or entry <= 0:
                continue

            checkpoints = {
                "5m":  a.price_5m,
                "30m": a.price_30m,
                "2h":  a.price_2h,
                "24h": a.price_24h,
                "res": a.resolution_price,
            }
            row = {
                "alert_id": a.id,
                "market": (a.market_question or "")[:60],
                "outcome": a.outcome,
                "signal_score": a.signal_score,
                "wallet_score": a.wallet_sharp_score,
                "entry_price": entry,
                "action": a.suggested_action,
            }
            for label, price in checkpoints.items():
                if price is not None and entry > 0:
                    pnl_pct = (price - entry) / entry * 100
                    row[f"pnl_{label}_pct"] = round(pnl_pct, 2)
                    row[f"price_{label}"] = round(price, 4)
            rows.append(row)

        if not rows:
            return {"total_alerts": 0, "rows": []}

        # Aggregate
        def avg_pnl(label: str) -> Optional[float]:
            vals = [r[f"pnl_{label}_pct"] for r in rows if f"pnl_{label}_pct" in r]
            return round(sum(vals) / len(vals), 2) if vals else None

        return {
            "total_alerts": len(alerts),
            "alerts_with_data": len(rows),
            "avg_pnl_5m_pct": avg_pnl("5m"),
            "avg_pnl_30m_pct": avg_pnl("30m"),
            "avg_pnl_2h_pct": avg_pnl("2h"),
            "avg_pnl_24h_pct": avg_pnl("24h"),
            "avg_pnl_res_pct": avg_pnl("res"),
            "rows": rows,
        }

    async def mark_resolved(self, condition_id: str, resolution_price: float) -> None:
        """Set resolution_price on all alerts for a resolved market."""
        async with SessionLocal() as db:
            result = await db.execute(
                select(AlertDB).where(AlertDB.condition_id == condition_id)
            )
            alerts = result.scalars().all()
            for a in alerts:
                a.resolution_price = resolution_price
                if a.status == "open":
                    a.status = "resolved"
            if alerts:
                await db.commit()
