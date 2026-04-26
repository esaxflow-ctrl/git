"""Gamma API client — markets, events, user positions."""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Optional
from datetime import datetime

import aiohttp

from src.config import get_settings

log = logging.getLogger(__name__)
settings = get_settings()

_BASE = settings.gamma_api_base


class GammaClient:
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
                log.warning("Gamma GET %s attempt %d failed: %s", path, attempt + 1, exc)
                if attempt == 2:
                    raise
                await asyncio.sleep(1)
        return None

    # ── Markets ───────────────────────────────────────────────────────────────

    async def get_markets(
        self,
        closed: bool = False,
        limit: int = 100,
        offset: int = 0,
        order: str = "volume",
        ascending: bool = False,
    ) -> list[dict]:
        data = await self._get(
            "/markets",
            params={
                "closed": str(closed).lower(),
                "limit": limit,
                "offset": offset,
                "order": order,
                "ascending": str(ascending).lower(),
            },
        )
        if isinstance(data, list):
            return data
        return data.get("markets", []) if isinstance(data, dict) else []

    async def get_all_active_markets(self, max_pages: int = 20) -> list[dict]:
        """Paginate through all active markets."""
        all_markets: list[dict] = []
        for page in range(max_pages):
            batch = await self.get_markets(closed=False, limit=100, offset=page * 100)
            if not batch:
                break
            all_markets.extend(batch)
            if len(batch) < 100:
                break
        return all_markets

    async def get_market(self, condition_id: str) -> dict | None:
        try:
            return await self._get(f"/markets/{condition_id}")
        except Exception as exc:
            log.warning("get_market %s: %s", condition_id, exc)
            return None

    # ── Events ────────────────────────────────────────────────────────────────

    async def get_events(self, closed: bool = False, limit: int = 100, offset: int = 0) -> list[dict]:
        data = await self._get(
            "/events",
            params={"closed": str(closed).lower(), "limit": limit, "offset": offset},
        )
        if isinstance(data, list):
            return data
        return data.get("events", []) if isinstance(data, dict) else []

    # ── Positions ─────────────────────────────────────────────────────────────

    async def get_positions(
        self,
        user: str,
        limit: int = 100,
        offset: int = 0,
        size_threshold: float = 0.0,
    ) -> list[dict]:
        try:
            data = await self._get(
                "/positions",
                params={
                    "user": user,
                    "limit": limit,
                    "offset": offset,
                    "sizeThreshold": size_threshold,
                },
            )
            if isinstance(data, list):
                return data
            return data.get("positions", []) if isinstance(data, dict) else []
        except Exception as exc:
            log.warning("get_positions %s: %s", user, exc)
            return []

    async def get_all_positions(self, user: str) -> list[dict]:
        all_pos: list[dict] = []
        for page in range(20):
            batch = await self.get_positions(user=user, limit=100, offset=page * 100)
            if not batch:
                break
            all_pos.extend(batch)
            if len(batch) < 100:
                break
        return all_pos

    # ── User P&L / profile ────────────────────────────────────────────────────

    async def get_user_pnl(self, user: str) -> dict | None:
        """Fetch aggregated P&L for a user (if endpoint exists)."""
        try:
            return await self._get("/portfolios", params={"user": user})
        except Exception as exc:
            log.debug("get_user_pnl %s: %s", user, exc)
            return None

    async def get_leaderboard(
        self,
        window: str = "all",
        limit: int = 100,
        offset: int = 0,
    ) -> list[dict]:
        """Try gamma leaderboard endpoint."""
        try:
            data = await self._get(
                "/leaderboard",
                params={"window": window, "limit": limit, "offset": offset},
            )
            if isinstance(data, list):
                return data
            return data.get("data", data.get("leaderboard", [])) if isinstance(data, dict) else []
        except Exception as exc:
            log.debug("gamma leaderboard: %s", exc)
            return []
