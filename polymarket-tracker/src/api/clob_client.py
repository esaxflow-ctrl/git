"""CLOB API client — order books, trade history, real-time prices."""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Optional

import aiohttp

from src.config import get_settings

log = logging.getLogger(__name__)
settings = get_settings()

_BASE = settings.clob_api_base


class ClobClient:
    def __init__(self) -> None:
        self._session: Optional[aiohttp.ClientSession] = None

    async def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(
                headers={"Accept": "application/json"},
                timeout=aiohttp.ClientTimeout(total=30),
            )
        return self._session

    async def close(self) -> None:
        if self._session and not self._session.closed:
            await self._session.close()

    async def _get(self, path: str, params: dict | None = None) -> Any:
        session = await self._get_session()
        url = f"{_BASE}{path}"
        for attempt in range(3):
            try:
                async with session.get(url, params=params) as resp:
                    if resp.status == 429:
                        await asyncio.sleep(2 ** attempt)
                        continue
                    resp.raise_for_status()
                    return await resp.json()
            except aiohttp.ClientError as exc:
                log.warning("CLOB GET %s attempt %d: %s", path, attempt + 1, exc)
                if attempt == 2:
                    raise
                await asyncio.sleep(1)
        return None

    # ── Markets ───────────────────────────────────────────────────────────────

    async def get_markets(self, next_cursor: str = "") -> dict:
        params = {}
        if next_cursor:
            params["next_cursor"] = next_cursor
        return await self._get("/markets", params=params) or {}

    async def get_market(self, condition_id: str) -> dict | None:
        try:
            return await self._get(f"/markets/{condition_id}")
        except Exception as exc:
            log.warning("clob get_market %s: %s", condition_id, exc)
            return None

    async def get_sampling_markets(self) -> list[dict]:
        data = await self._get("/sampling-markets") or {}
        return data.get("markets", [])

    # ── Order Book ────────────────────────────────────────────────────────────

    async def get_orderbook(self, token_id: str) -> dict | None:
        """Returns bids and asks for a token."""
        try:
            return await self._get("/book", params={"token_id": token_id})
        except Exception as exc:
            log.warning("get_orderbook %s: %s", token_id, exc)
            return None

    async def get_orderbook_summary(self, token_id: str) -> dict:
        """Returns best bid/ask with spread."""
        book = await self.get_orderbook(token_id)
        if not book:
            return {"best_bid": 0.0, "best_ask": 1.0, "spread": 1.0, "mid": 0.5}
        bids = book.get("bids", [])
        asks = book.get("asks", [])
        best_bid = float(bids[0]["price"]) if bids else 0.0
        best_ask = float(asks[0]["price"]) if asks else 1.0
        spread = best_ask - best_bid
        mid = (best_bid + best_ask) / 2
        # Estimate liquidity from top-of-book
        bid_liquidity = sum(float(b["size"]) * float(b["price"]) for b in bids[:5])
        ask_liquidity = sum(float(a["size"]) * float(a["price"]) for a in asks[:5])
        return {
            "best_bid": best_bid,
            "best_ask": best_ask,
            "spread": spread,
            "mid": mid,
            "bid_liquidity_usd": bid_liquidity,
            "ask_liquidity_usd": ask_liquidity,
            "raw_bids": bids[:10],
            "raw_asks": asks[:10],
        }

    async def get_midpoint(self, token_id: str) -> float:
        summary = await self.get_orderbook_summary(token_id)
        return summary.get("mid", 0.5)

    # ── Prices ────────────────────────────────────────────────────────────────

    async def get_last_trade_price(self, token_id: str) -> float | None:
        try:
            data = await self._get("/last-trade-price", params={"token_id": token_id})
            if data and "price" in data:
                return float(data["price"])
        except Exception:
            pass
        return None

    async def get_prices(self, token_ids: list[str]) -> dict[str, float]:
        """Batch price fetch."""
        if not token_ids:
            return {}
        try:
            # Try batch endpoint
            params = [("token_id", tid) for tid in token_ids]
            session = await self._get_session()
            async with session.get(f"{_BASE}/prices", params=params) as resp:
                if resp.ok:
                    data = await resp.json()
                    return {item["asset_id"]: float(item["price"]) for item in (data if isinstance(data, list) else [])}
        except Exception:
            pass
        # Fallback: individual fetches
        results: dict[str, float] = {}
        for tid in token_ids[:20]:
            price = await self.get_last_trade_price(tid)
            if price is not None:
                results[tid] = price
        return results

    # ── Trades ────────────────────────────────────────────────────────────────

    async def get_trades(
        self,
        maker_address: str | None = None,
        taker_address: str | None = None,
        market: str | None = None,
        limit: int = 100,
        before: str | None = None,
        after: str | None = None,
    ) -> list[dict]:
        params: dict[str, Any] = {"limit": limit}
        if maker_address:
            params["maker_address"] = maker_address
        if taker_address:
            params["taker_address"] = taker_address
        if market:
            params["market"] = market
        if before:
            params["before"] = before
        if after:
            params["after"] = after
        try:
            data = await self._get("/trades", params=params)
            if isinstance(data, list):
                return data
            return data.get("data", []) if isinstance(data, dict) else []
        except Exception as exc:
            log.warning("get_trades: %s", exc)
            return []

    async def get_user_trades(self, address: str, limit: int = 200) -> list[dict]:
        """Get all trades for a wallet (maker or taker)."""
        maker = await self.get_trades(maker_address=address, limit=limit)
        taker = await self.get_trades(taker_address=address, limit=limit)
        combined = {t.get("id", i): t for i, t in enumerate(maker + taker)}
        return list(combined.values())

    # ── Open Orders ───────────────────────────────────────────────────────────

    async def get_open_orders(self, maker_address: str) -> list[dict]:
        try:
            data = await self._get("/orders", params={"maker_address": maker_address})
            if isinstance(data, list):
                return data
            return data.get("data", []) if isinstance(data, dict) else []
        except Exception:
            return []
