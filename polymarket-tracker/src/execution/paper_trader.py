"""Paper trading — simulates trades and tracks P&L without real money."""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select

from src.config import get_settings
from src.database import SessionLocal, AlertDB, PaperTradeDB

log = logging.getLogger(__name__)
settings = get_settings()


class PaperTrader:

    async def open_trade(
        self,
        alert_id: int,
        condition_id: str,
        outcome: str,
        entry_price: float,
        size_usd: float,
    ) -> Optional[PaperTradeDB]:
        """Log a simulated entry."""
        if entry_price <= 0 or size_usd <= 0:
            log.warning("Invalid paper trade params: price=%s size=%s", entry_price, size_usd)
            return None
        shares = size_usd / entry_price
        async with SessionLocal() as db:
            trade = PaperTradeDB(
                alert_id=alert_id,
                condition_id=condition_id,
                outcome=outcome,
                entry_price=entry_price,
                size_usd=size_usd,
                shares=shares,
            )
            db.add(trade)
            await db.commit()
            await db.refresh(trade)
            log.info(
                "Paper trade opened: %s %s @ %.4f ($%.2f) [alert %d]",
                outcome,
                condition_id[:12],
                entry_price,
                size_usd,
                alert_id,
            )
            return trade

    async def close_trade(self, paper_trade_id: int, exit_price: float) -> Optional[PaperTradeDB]:
        """Mark a paper trade as closed."""
        async with SessionLocal() as db:
            result = await db.execute(
                select(PaperTradeDB).where(PaperTradeDB.id == paper_trade_id)
            )
            trade = result.scalar_one_or_none()
            if not trade:
                return None

            trade.exit_price = exit_price
            trade.pnl_usd = (exit_price - trade.entry_price) * trade.shares
            trade.pnl_pct = (exit_price - trade.entry_price) / trade.entry_price * 100
            trade.exited_at = datetime.now(timezone.utc)
            trade.status = "closed"
            await db.commit()
            await db.refresh(trade)
            log.info(
                "Paper trade closed: %s @ %.4f → PnL $%.2f (%.1f%%)",
                trade.condition_id[:12],
                exit_price,
                trade.pnl_usd,
                trade.pnl_pct,
            )
            return trade

    async def mark_resolved(self, condition_id: str, resolution_price: float) -> None:
        """Resolve all open paper trades for a market."""
        async with SessionLocal() as db:
            result = await db.execute(
                select(PaperTradeDB).where(
                    PaperTradeDB.condition_id == condition_id,
                    PaperTradeDB.status == "open",
                )
            )
            trades = result.scalars().all()
            for trade in trades:
                trade.exit_price = resolution_price
                trade.pnl_usd = (resolution_price - trade.entry_price) * trade.shares
                trade.pnl_pct = (resolution_price - trade.entry_price) / trade.entry_price * 100
                trade.exited_at = datetime.now(timezone.utc)
                trade.status = "resolved"
            if trades:
                await db.commit()
                log.info("Resolved %d paper trades for %s", len(trades), condition_id[:12])

    async def get_summary(self) -> dict:
        """Summarize paper trading performance."""
        async with SessionLocal() as db:
            result = await db.execute(select(PaperTradeDB))
            trades = result.scalars().all()

        if not trades:
            return {"total_trades": 0, "open": 0, "closed": 0, "total_pnl_usd": 0.0, "win_rate_pct": 0.0}

        closed = [t for t in trades if t.status in ("closed", "resolved")]
        wins = [t for t in closed if (t.pnl_usd or 0) > 0]

        return {
            "total_trades": len(trades),
            "open": len([t for t in trades if t.status == "open"]),
            "closed": len(closed),
            "total_pnl_usd": sum(t.pnl_usd or 0 for t in closed),
            "win_rate_pct": len(wins) / len(closed) * 100 if closed else 0.0,
            "avg_pnl_usd": sum(t.pnl_usd or 0 for t in closed) / len(closed) if closed else 0.0,
            "best_trade_usd": max((t.pnl_usd or 0 for t in closed), default=0.0),
            "worst_trade_usd": min((t.pnl_usd or 0 for t in closed), default=0.0),
        }

    async def get_open_trades(self) -> list[PaperTradeDB]:
        async with SessionLocal() as db:
            result = await db.execute(
                select(PaperTradeDB).where(PaperTradeDB.status == "open")
            )
            return result.scalars().all()

    async def get_closed_trades(self, limit: int = 50) -> list[PaperTradeDB]:
        from sqlalchemy import desc
        async with SessionLocal() as db:
            result = await db.execute(
                select(PaperTradeDB)
                .where(PaperTradeDB.status.in_(["closed", "resolved"]))
                .order_by(desc(PaperTradeDB.exited_at))
                .limit(limit)
            )
            return result.scalars().all()
