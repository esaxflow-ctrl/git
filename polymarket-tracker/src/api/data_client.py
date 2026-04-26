"""Data API + Leaderboard API client — user profiles, activity, leaderboard."""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Optional

import aiohttp

from src.config import get_settings

log = logging.getLogger(__name__)
settings = get_settings()

_DATA_BASE = settings.data_api_base
_LB_BASE = settings.leaderboard_api_base


class DataClient:
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

    async def _get(self, base: str, path: str, params: dict | None = None) -> Any:
        session = await self._get_session()
        url = f"{base}{path}"
        for attempt in range(3):
            try:
                async with session.get(url, params=params) as resp:
                    if resp.status == 429:
                        await asyncio.sleep(2 ** attempt)
                        continue
                    if resp.status == 404:
                        return None
                    resp.raise_for_status()
                    return await resp.json()
            except aiohttp.ClientError as exc:
                log.warning("DataClient GET %s attempt %d: %s", url, attempt + 1, exc)
                if attempt == 2:
                    return None
                await asyncio.sleep(1)
        return None

    # ── Profile ───────────────────────────────────────────────────────────────

    async def get_profile(self, address: str) -> dict | None:
        """Get public profile for a wallet address."""
        data = await self._get(_DATA_BASE, "/profile", params={"address": address})
        if not data:
            # Try alternate endpoint
            data = await self._get(_DATA_BASE, f"/profiles/{address}")
        return data if isinstance(data, dict) else None

    async def get_pnl(self, address: str) -> dict | None:
        """Get P&L summary for a wallet."""
        data = await self._get(_DATA_BASE, "/pnl", params={"address": address})
        if not data:
            data = await self._get(_DATA_BASE, "/portfolio", params={"user": address})
        return data if isinstance(data, dict) else None

    # ── Activity ──────────────────────────────────────────────────────────────

    async def get_activity(
        self,
        user: str,
        limit: int = 50,
        offset: int = 0,
    ) -> list[dict]:
        """Get recent trading activity for a wallet."""
        data = await self._get(
            _DATA_BASE,
            "/activity",
            params={"user": user, "limit": limit, "offset": offset},
        )
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            return data.get("history", data.get("activity", data.get("data", [])))
        return []

    async def get_all_activity(self, user: str, max_pages: int = 10) -> list[dict]:
        all_acts: list[dict] = []
        for page in range(max_pages):
            batch = await self.get_activity(user=user, limit=100, offset=page * 100)
            if not batch:
                break
            all_acts.extend(batch)
            if len(batch) < 100:
                break
        return all_acts

    # ── Positions ─────────────────────────────────────────────────────────────

    async def get_positions(self, user: str, limit: int = 100, offset: int = 0) -> list[dict]:
        data = await self._get(
            _DATA_BASE,
            "/positions",
            params={"user": user, "limit": limit, "offset": offset},
        )
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            return data.get("positions", data.get("data", []))
        return []

    # ── Leaderboard ───────────────────────────────────────────────────────────

    async def get_leaderboard(
        self,
        window: str = "all",
        limit: int = 100,
        offset: int = 0,
        sort_by: str = "profitLoss",
    ) -> list[dict]:
        """Primary leaderboard endpoint — tries several known URLs in order."""
        params = {"window": window, "limit": limit, "offset": offset, "sortBy": sort_by}
        # Try multiple known endpoint / parameter combinations
        attempts = [
            (_DATA_BASE, "/leaderboard",            {"limit": limit, "offset": offset}),
            (_DATA_BASE, "/leaderboard",            {"limit": limit, "offset": offset, "window": "allTime"}),
            (_DATA_BASE, "/leaderboard",            params),
            (_DATA_BASE, "/portfolio-leaderboard",  params),
            (_LB_BASE,   "/portfolio-leaderboard",  params),
        ]
        for base, path, p in attempts:
            try:
                data = await self._get(base, path, params=p)
                if data is None:
                    continue
                if isinstance(data, list) and data:
                    return data
                if isinstance(data, dict):
                    entries = data.get("data", data.get("leaderboard", data.get("results", [])))
                    if entries:
                        return entries
            except Exception:
                continue
        return []

    async def get_full_leaderboard(self, max_entries: int = 500) -> list[dict]:
        """Fetch multiple pages of leaderboard."""
        all_entries: list[dict] = []
        page_size = min(100, max_entries)
        for page in range(max_entries // page_size + 1):
            batch = await self.get_leaderboard(limit=page_size, offset=page * page_size)
            if not batch:
                break
            all_entries.extend(batch)
            if len(batch) < page_size or len(all_entries) >= max_entries:
                break
            await asyncio.sleep(0.2)
        return all_entries[:max_entries]

    async def get_category_leaderboard(self, category: str, limit: int = 50) -> list[dict]:
        data = await self._get(
            _LB_BASE,
            "/portfolio-leaderboard",
            params={"category": category, "limit": limit},
        )
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            return data.get("data", [])
        return []

    # ── Market user data ──────────────────────────────────────────────────────

    async def get_market_holders(self, condition_id: str) -> list[dict]:
        """Get significant position holders for a market."""
        data = await self._get(_DATA_BASE, f"/markets/{condition_id}/holders")
        if isinstance(data, list):
            return data
        return []

    async def search_users(self, query: str) -> list[dict]:
        data = await self._get(_DATA_BASE, "/search", params={"q": query, "type": "user"})
        if isinstance(data, dict):
            return data.get("users", data.get("results", []))
        return []
