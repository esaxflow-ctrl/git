from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    Integer,
    String,
    Text,
    UniqueConstraint,
    event,
    text,
)
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from src.config import get_settings

settings = get_settings()

engine = create_async_engine(
    settings.database_url,
    echo=False,
    future=True,
    connect_args={"check_same_thread": False} if "sqlite" in settings.database_url else {},
)

SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


class Base(DeclarativeBase):
    pass


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ── ORM Models ────────────────────────────────────────────────────────────────

class WalletDB(Base):
    __tablename__ = "wallets"

    id = Column(Integer, primary_key=True, autoincrement=True)
    address = Column(String(64), unique=True, nullable=False, index=True)
    username = Column(String(128), nullable=True)
    display_name = Column(String(256), nullable=True)

    # PnL metrics
    total_profit_usd = Column(Float, default=0.0)
    total_volume_usd = Column(Float, default=0.0)
    roi_pct = Column(Float, default=0.0)

    # Activity stats
    markets_traded = Column(Integer, default=0)
    resolved_markets = Column(Integer, default=0)
    win_count = Column(Integer, default=0)
    loss_count = Column(Integer, default=0)
    win_rate_pct = Column(Float, default=0.0)

    # Position sizing
    avg_position_size_usd = Column(Float, default=0.0)
    median_position_size_usd = Column(Float, default=0.0)
    largest_position_usd = Column(Float, default=0.0)
    largest_win_usd = Column(Float, default=0.0)
    largest_loss_usd = Column(Float, default=0.0)

    # Entry quality
    avg_entry_price = Column(Float, default=0.0)
    avg_closing_price = Column(Float, default=0.0)
    beat_close_rate_pct = Column(Float, default=0.0)
    early_entry_rate_pct = Column(Float, default=0.0)

    # Scores
    sharp_score = Column(Float, default=0.0)
    profit_ex_top_win = Column(Float, default=0.0)

    # Favorite categories (JSON array)
    favorite_categories_json = Column(Text, default="[]")

    # Metadata
    last_seen_active = Column(DateTime, nullable=True)
    first_seen = Column(DateTime, default=utcnow)
    last_scored = Column(DateTime, nullable=True)
    source = Column(String(64), default="leaderboard")

    @property
    def favorite_categories(self) -> list[str]:
        return json.loads(self.favorite_categories_json or "[]")

    @favorite_categories.setter
    def favorite_categories(self, value: list[str]) -> None:
        self.favorite_categories_json = json.dumps(value)


class MarketDB(Base):
    __tablename__ = "markets"

    id = Column(Integer, primary_key=True, autoincrement=True)
    condition_id = Column(String(128), unique=True, nullable=False, index=True)
    question = Column(Text, nullable=False)
    category = Column(String(128), nullable=True)
    end_date = Column(DateTime, nullable=True)
    is_closed = Column(Boolean, default=False)
    is_resolved = Column(Boolean, default=False)

    # Prices / liquidity (YES outcome unless binary)
    yes_token_id = Column(String(128), nullable=True)
    no_token_id = Column(String(128), nullable=True)
    yes_price = Column(Float, default=0.5)
    no_price = Column(Float, default=0.5)
    spread = Column(Float, default=0.0)
    liquidity_usd = Column(Float, default=0.0)
    volume_24h_usd = Column(Float, default=0.0)
    volume_total_usd = Column(Float, default=0.0)

    # Market intelligence
    sharp_wallet_count = Column(Integer, default=0)
    last_sharp_activity = Column(DateTime, nullable=True)

    last_updated = Column(DateTime, default=utcnow)
    first_seen = Column(DateTime, default=utcnow)


class PositionSnapshotDB(Base):
    """Point-in-time snapshot of a wallet's position in a market."""

    __tablename__ = "position_snapshots"
    __table_args__ = (
        UniqueConstraint("wallet_address", "condition_id", "snapshot_time", name="uq_snapshot"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    wallet_address = Column(String(64), nullable=False, index=True)
    condition_id = Column(String(128), nullable=False, index=True)
    outcome = Column(String(16), nullable=False)  # YES / NO / token_id

    shares = Column(Float, default=0.0)
    avg_price = Column(Float, default=0.0)
    current_value_usd = Column(Float, default=0.0)
    initial_value_usd = Column(Float, default=0.0)

    snapshot_time = Column(DateTime, default=utcnow, index=True)


class TradeDB(Base):
    """Individual trade event detected from position changes."""

    __tablename__ = "trades"

    id = Column(Integer, primary_key=True, autoincrement=True)
    wallet_address = Column(String(64), nullable=False, index=True)
    condition_id = Column(String(128), nullable=False, index=True)
    outcome = Column(String(16), nullable=False)
    side = Column(String(8), nullable=False)  # BUY / SELL

    size_usd = Column(Float, default=0.0)
    shares = Column(Float, default=0.0)
    price = Column(Float, default=0.0)

    detected_at = Column(DateTime, default=utcnow, index=True)
    tx_hash = Column(String(128), nullable=True)


class AlertDB(Base):
    __tablename__ = "alerts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    condition_id = Column(String(128), nullable=False, index=True)
    wallet_address = Column(String(64), nullable=False, index=True)
    outcome = Column(String(16), nullable=False)

    # Scores
    signal_score = Column(Float, default=0.0)
    wallet_sharp_score = Column(Float, default=0.0)

    # Trade details at alert time
    wallet_entry_price = Column(Float, default=0.0)
    current_price_at_alert = Column(Float, default=0.0)
    trade_size_usd = Column(Float, default=0.0)
    market_question = Column(Text, nullable=True)

    # Copy decision
    suggested_action = Column(String(32), default="WATCH")
    max_risk_usd = Column(Float, default=0.0)

    # Alert text
    alert_text = Column(Text, nullable=True)

    # Status
    status = Column(String(32), default="open")  # open / approved / rejected / executed / watching
    created_at = Column(DateTime, default=utcnow, index=True)

    # Backtest tracking
    price_5m = Column(Float, nullable=True)
    price_30m = Column(Float, nullable=True)
    price_2h = Column(Float, nullable=True)
    price_24h = Column(Float, nullable=True)
    resolution_price = Column(Float, nullable=True)


class PaperTradeDB(Base):
    __tablename__ = "paper_trades"

    id = Column(Integer, primary_key=True, autoincrement=True)
    alert_id = Column(Integer, nullable=False, index=True)
    condition_id = Column(String(128), nullable=False)
    outcome = Column(String(16), nullable=False)

    entry_price = Column(Float, nullable=False)
    size_usd = Column(Float, nullable=False)
    shares = Column(Float, nullable=False)

    exit_price = Column(Float, nullable=True)
    pnl_usd = Column(Float, nullable=True)
    pnl_pct = Column(Float, nullable=True)

    entered_at = Column(DateTime, default=utcnow)
    exited_at = Column(DateTime, nullable=True)
    status = Column(String(16), default="open")  # open / closed / resolved


class LiveTradeDB(Base):
    __tablename__ = "live_trades"

    id = Column(Integer, primary_key=True, autoincrement=True)
    alert_id = Column(Integer, nullable=False, index=True)
    condition_id = Column(String(128), nullable=False)
    outcome = Column(String(16), nullable=False)

    order_id = Column(String(128), nullable=True)
    order_type = Column(String(16), default="limit")
    side = Column(String(8), default="BUY")

    requested_price = Column(Float, nullable=False)
    filled_price = Column(Float, nullable=True)
    requested_size_usd = Column(Float, nullable=False)
    filled_size_usd = Column(Float, nullable=True)
    shares = Column(Float, nullable=True)

    status = Column(String(32), default="pending")  # pending / filled / partial / canceled / failed
    error_msg = Column(Text, nullable=True)

    submitted_at = Column(DateTime, default=utcnow)
    filled_at = Column(DateTime, nullable=True)


# ── DB lifecycle ──────────────────────────────────────────────────────────────

async def init_db() -> None:
    async with engine.begin() as conn:
        await conn.execute(text("PRAGMA journal_mode=WAL"))
        await conn.run_sync(Base.metadata.create_all)


async def get_session() -> AsyncSession:
    async with SessionLocal() as session:
        yield session
