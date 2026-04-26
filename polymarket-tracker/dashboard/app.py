"""FastAPI dashboard — serves the web UI and exposes REST endpoints."""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, AsyncGenerator

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select, desc, func

from src.config import get_settings
from src.database import SessionLocal, WalletDB, MarketDB, AlertDB, PaperTradeDB, TradeDB
from src.execution.paper_trader import PaperTrader
from src.backtesting.backtest import Backtester
from src.api.gamma_client import GammaClient
from src.api.clob_client import ClobClient

log = logging.getLogger(__name__)
settings = get_settings()

app = FastAPI(title="Polymarket Informed-Flow Tracker", version="1.0.0")

STATIC_DIR = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

_paper_trader = PaperTrader()
_gamma = GammaClient()
_clob = ClobClient()
_backtester = Backtester(_gamma, _clob)

# ── SSE event queue for live alert push ───────────────────────────────────────
_sse_queue: asyncio.Queue = asyncio.Queue(maxsize=100)


def push_sse_event(event: dict) -> None:
    try:
        _sse_queue.put_nowait(event)
    except asyncio.QueueFull:
        pass


# ── HTML ──────────────────────────────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
async def dashboard():
    html_path = STATIC_DIR / "index.html"
    return html_path.read_text()


# ── REST endpoints ────────────────────────────────────────────────────────────

@app.get("/api/wallets")
async def list_wallets(
    limit: int = Query(50, ge=1, le=200),
    min_score: float = Query(0.0),
    sort: str = Query("sharp_score"),
):
    async with SessionLocal() as db:
        col = getattr(WalletDB, sort, WalletDB.sharp_score)
        result = await db.execute(
            select(WalletDB)
            .where(WalletDB.sharp_score >= min_score)
            .order_by(desc(col))
            .limit(limit)
        )
        wallets = result.scalars().all()

    return [
        {
            "address": w.address,
            "username": w.username or w.address[:10],
            "sharp_score": round(w.sharp_score, 1),
            "total_profit_usd": round(w.total_profit_usd, 2),
            "roi_pct": round(w.roi_pct, 2),
            "markets_traded": w.markets_traded,
            "resolved_markets": w.resolved_markets,
            "win_rate_pct": round(w.win_rate_pct, 1),
            "avg_position_size_usd": round(w.avg_position_size_usd, 2),
            "last_scored": w.last_scored.isoformat() if w.last_scored else None,
        }
        for w in wallets
    ]


@app.get("/api/wallets/{address}")
async def get_wallet(address: str):
    async with SessionLocal() as db:
        result = await db.execute(
            select(WalletDB).where(WalletDB.address == address.lower())
        )
        wallet = result.scalar_one_or_none()
    if not wallet:
        raise HTTPException(404, "Wallet not found")

    # Recent trades
    async with SessionLocal() as db:
        trade_result = await db.execute(
            select(TradeDB)
            .where(TradeDB.wallet_address == address.lower())
            .order_by(desc(TradeDB.detected_at))
            .limit(20)
        )
        trades = trade_result.scalars().all()

    return {
        "address": wallet.address,
        "username": wallet.username,
        "sharp_score": round(wallet.sharp_score, 1),
        "total_profit_usd": round(wallet.total_profit_usd, 2),
        "total_volume_usd": round(wallet.total_volume_usd, 2),
        "roi_pct": round(wallet.roi_pct, 2),
        "markets_traded": wallet.markets_traded,
        "resolved_markets": wallet.resolved_markets,
        "win_count": wallet.win_count,
        "loss_count": wallet.loss_count,
        "win_rate_pct": round(wallet.win_rate_pct, 1),
        "avg_position_size_usd": round(wallet.avg_position_size_usd, 2),
        "largest_win_usd": round(wallet.largest_win_usd, 2),
        "largest_loss_usd": round(wallet.largest_loss_usd, 2),
        "profit_ex_top_win": round(wallet.profit_ex_top_win, 2),
        "last_scored": wallet.last_scored.isoformat() if wallet.last_scored else None,
        "recent_trades": [
            {
                "condition_id": t.condition_id,
                "outcome": t.outcome,
                "side": t.side,
                "size_usd": round(t.size_usd, 2),
                "price": round(t.price, 4),
                "detected_at": t.detected_at.isoformat(),
            }
            for t in trades
        ],
    }


@app.get("/api/alerts")
async def list_alerts(
    limit: int = Query(50, ge=1, le=200),
    min_score: float = Query(0.0),
    status: str = Query(""),
    action: str = Query(""),
):
    async with SessionLocal() as db:
        query = select(AlertDB).order_by(desc(AlertDB.created_at)).limit(limit)
        if min_score > 0:
            query = query.where(AlertDB.signal_score >= min_score)
        if status:
            query = query.where(AlertDB.status == status)
        if action:
            query = query.where(AlertDB.suggested_action == action)
        result = await db.execute(query)
        alerts = result.scalars().all()

    return [_alert_to_dict(a) for a in alerts]


@app.get("/api/alerts/{alert_id}")
async def get_alert(alert_id: int):
    async with SessionLocal() as db:
        result = await db.execute(select(AlertDB).where(AlertDB.id == alert_id))
        alert = result.scalar_one_or_none()
    if not alert:
        raise HTTPException(404, "Alert not found")
    return _alert_to_dict(alert, include_text=True)


@app.post("/api/alerts/{alert_id}/approve")
async def approve_alert(alert_id: int):
    async with SessionLocal() as db:
        result = await db.execute(select(AlertDB).where(AlertDB.id == alert_id))
        alert = result.scalar_one_or_none()
        if not alert:
            raise HTTPException(404, "Alert not found")
        alert.status = "approved"
        await db.commit()

    if settings.execution_mode == "manual_approval":
        # Paper trade as confirmation until live execution is enabled
        await _paper_trader.open_trade(
            alert_id=alert_id,
            condition_id=alert.condition_id,
            outcome=alert.outcome,
            entry_price=alert.current_price_at_alert,
            size_usd=alert.max_risk_usd or settings.max_position_speculative_usd,
        )

    return {"status": "approved", "alert_id": alert_id}


@app.post("/api/alerts/{alert_id}/reject")
async def reject_alert(alert_id: int):
    async with SessionLocal() as db:
        result = await db.execute(select(AlertDB).where(AlertDB.id == alert_id))
        alert = result.scalar_one_or_none()
        if not alert:
            raise HTTPException(404, "Alert not found")
        alert.status = "rejected"
        await db.commit()
    return {"status": "rejected", "alert_id": alert_id}


@app.get("/api/markets")
async def list_markets(
    limit: int = Query(50, ge=1, le=200),
    sort: str = Query("volume_24h_usd"),
    sharp_only: bool = Query(False),
):
    async with SessionLocal() as db:
        col = getattr(MarketDB, sort, MarketDB.volume_24h_usd)
        query = select(MarketDB).where(MarketDB.is_closed == False).order_by(desc(col)).limit(limit)
        if sharp_only:
            query = query.where(MarketDB.sharp_wallet_count > 0)
        result = await db.execute(query)
        markets = result.scalars().all()

    return [
        {
            "condition_id": m.condition_id,
            "question": m.question,
            "category": m.category,
            "yes_price": round(m.yes_price, 4),
            "no_price": round(m.no_price, 4),
            "spread": round(m.spread, 4),
            "liquidity_usd": round(m.liquidity_usd, 2),
            "volume_24h_usd": round(m.volume_24h_usd, 2),
            "sharp_wallet_count": m.sharp_wallet_count,
            "last_updated": m.last_updated.isoformat() if m.last_updated else None,
        }
        for m in markets
    ]


@app.get("/api/paper-trades")
async def list_paper_trades():
    summary = await _paper_trader.get_summary()
    open_trades = await _paper_trader.get_open_trades()
    closed_trades = await _paper_trader.get_closed_trades()
    return {
        "summary": summary,
        "open_trades": [
            {
                "id": t.id,
                "condition_id": t.condition_id,
                "outcome": t.outcome,
                "entry_price": round(t.entry_price, 4),
                "size_usd": round(t.size_usd, 2),
                "entered_at": t.entered_at.isoformat(),
            }
            for t in open_trades
        ],
        "closed_trades": [
            {
                "id": t.id,
                "condition_id": t.condition_id,
                "outcome": t.outcome,
                "entry_price": round(t.entry_price, 4),
                "exit_price": round(t.exit_price, 4) if t.exit_price else None,
                "size_usd": round(t.size_usd, 2),
                "pnl_usd": round(t.pnl_usd, 2) if t.pnl_usd is not None else None,
                "pnl_pct": round(t.pnl_pct, 2) if t.pnl_pct is not None else None,
                "status": t.status,
                "entered_at": t.entered_at.isoformat(),
                "exited_at": t.exited_at.isoformat() if t.exited_at else None,
            }
            for t in closed_trades
        ],
    }


@app.get("/api/backtest")
async def get_backtest():
    return await _backtester.compute_summary()


@app.get("/api/stats")
async def get_stats():
    async with SessionLocal() as db:
        n_wallets = (await db.execute(select(func.count(WalletDB.id)))).scalar()
        n_sharp = (await db.execute(
            select(func.count(WalletDB.id)).where(WalletDB.sharp_score >= 60)
        )).scalar()
        n_alerts = (await db.execute(select(func.count(AlertDB.id)))).scalar()
        n_high = (await db.execute(
            select(func.count(AlertDB.id)).where(AlertDB.signal_score >= 65)
        )).scalar()
        n_markets = (await db.execute(
            select(func.count(MarketDB.id)).where(MarketDB.is_closed == False)
        )).scalar()

    paper = await _paper_trader.get_summary()

    return {
        "wallets_tracked": n_wallets,
        "sharp_wallets": n_sharp,
        "total_alerts": n_alerts,
        "high_signal_alerts": n_high,
        "active_markets": n_markets,
        "paper_pnl_usd": round(paper.get("total_pnl_usd", 0), 2),
        "paper_win_rate_pct": round(paper.get("win_rate_pct", 0), 1),
    }


# ── SSE live feed ─────────────────────────────────────────────────────────────

from sse_starlette.sse import EventSourceResponse


@app.get("/api/stream")
async def event_stream():
    async def generator():
        while True:
            try:
                event = await asyncio.wait_for(_sse_queue.get(), timeout=30)
                yield {"data": json.dumps(event)}
            except asyncio.TimeoutError:
                yield {"data": json.dumps({"type": "heartbeat"})}
    return EventSourceResponse(generator())


# ── Helpers ───────────────────────────────────────────────────────────────────

def _alert_to_dict(a: AlertDB, include_text: bool = False) -> dict:
    d = {
        "id": a.id,
        "condition_id": a.condition_id,
        "market_question": a.market_question,
        "wallet_address": a.wallet_address,
        "outcome": a.outcome,
        "signal_score": round(a.signal_score, 1),
        "wallet_sharp_score": round(a.wallet_sharp_score, 1),
        "wallet_entry_price": round(a.wallet_entry_price, 4),
        "current_price_at_alert": round(a.current_price_at_alert, 4),
        "trade_size_usd": round(a.trade_size_usd, 2),
        "suggested_action": a.suggested_action,
        "max_risk_usd": round(a.max_risk_usd, 2),
        "status": a.status,
        "created_at": a.created_at.isoformat(),
        "price_5m": a.price_5m,
        "price_30m": a.price_30m,
        "price_2h": a.price_2h,
        "price_24h": a.price_24h,
    }
    if include_text:
        d["alert_text"] = a.alert_text
    return d
