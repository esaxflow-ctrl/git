"""Risk manager — guards every trade against hard limits."""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import Optional

from src.config import get_settings

log = logging.getLogger(__name__)
settings = get_settings()


@dataclass
class RiskState:
    """Mutable daily state. Reset at midnight."""
    date: date = field(default_factory=date.today)
    daily_losses: int = 0
    daily_pnl_usd: float = 0.0
    open_positions_usd: dict[str, float] = field(default_factory=dict)  # condition_id → USD
    category_exposure_usd: dict[str, float] = field(default_factory=dict)

    def maybe_reset(self) -> None:
        today = date.today()
        if today != self.date:
            self.date = today
            self.daily_losses = 0
            self.daily_pnl_usd = 0.0

    @property
    def total_open_usd(self) -> float:
        return sum(self.open_positions_usd.values())

    @property
    def daily_drawdown_pct(self) -> float:
        if settings.bankroll_usd <= 0:
            return 0.0
        return abs(min(0.0, self.daily_pnl_usd)) / settings.bankroll_usd * 100


@dataclass
class RiskCheck:
    approved: bool
    reason: str
    adjusted_size_usd: float


class RiskManager:

    def __init__(self) -> None:
        self.state = RiskState()

    def check(
        self,
        condition_id: str,
        category: str,
        size_usd: float,
        signal_score: float,
        wallet_sharp_score: float,
        current_price: float,
        wallet_entry_price: float,
        spread: float,
        liquidity_usd: float,
        seconds_to_resolution: float = 0,
    ) -> RiskCheck:
        self.state.maybe_reset()
        s = settings

        # ── Hard stops ────────────────────────────────────────────────────────
        if self.state.daily_losses >= s.max_daily_losses:
            return RiskCheck(False, f"Daily loss limit hit ({self.state.daily_losses} losses)", 0.0)

        if self.state.daily_drawdown_pct >= s.max_daily_drawdown_pct:
            return RiskCheck(
                False,
                f"Daily drawdown limit hit ({self.state.daily_drawdown_pct:.1f}%)",
                0.0,
            )

        # Price drift
        if wallet_entry_price > 0:
            drift = abs(current_price - wallet_entry_price) / wallet_entry_price * 100
            if drift > s.max_price_drift_from_entry_pct:
                return RiskCheck(
                    False,
                    f"Price drifted {drift:.1f}% from wallet entry (max {s.max_price_drift_from_entry_pct}%)",
                    0.0,
                )

        # Spread
        if spread > s.max_spread_pct / 100:
            return RiskCheck(
                False,
                f"Spread {spread:.1%} exceeds max {s.max_spread_pct:.1f}%",
                0.0,
            )

        # Liquidity
        if liquidity_usd < s.min_liquidity_usd:
            return RiskCheck(
                False,
                f"Liquidity ${liquidity_usd:,.0f} below min ${s.min_liquidity_usd:,.0f}",
                0.0,
            )

        # Signal / wallet quality thresholds for auto mode
        if s.execution_mode in ("semi_auto", "full_auto"):
            if signal_score < s.min_signal_score_auto:
                return RiskCheck(
                    False,
                    f"Signal score {signal_score:.0f} below auto threshold {s.min_signal_score_auto}",
                    0.0,
                )
            if wallet_sharp_score < s.min_wallet_sharp_score_auto:
                return RiskCheck(
                    False,
                    f"Wallet score {wallet_sharp_score:.0f} below auto threshold {s.min_wallet_sharp_score_auto}",
                    0.0,
                )

        # Market near resolution
        if 0 < seconds_to_resolution < 3600 and s.execution_mode == "full_auto":
            return RiskCheck(False, "Market resolves in < 1 hour — auto-trade blocked", 0.0)

        # ── Position sizing caps ───────────────────────────────────────────────
        max_allowed = s.max_position_speculative_usd
        reason_suffix = "(speculative)"
        if wallet_sharp_score >= 80 and signal_score >= 65:
            max_allowed = s.max_position_strong_usd
            reason_suffix = "(strong single-wallet)"
        if signal_score >= 80 and wallet_sharp_score >= 75:
            max_allowed = s.max_position_cluster_usd
            reason_suffix = "(cluster)"

        size_usd = min(size_usd, max_allowed)

        # Category exposure cap
        cat_exposure = self.state.category_exposure_usd.get(category, 0.0)
        max_cat = s.bankroll_usd * s.max_category_exposure_pct / 100
        if cat_exposure + size_usd > max_cat:
            size_usd = max(0.0, max_cat - cat_exposure)
            if size_usd < 1.0:
                return RiskCheck(False, f"Category '{category}' exposure maxed out", 0.0)

        # Total portfolio cap
        max_total = s.bankroll_usd * s.max_total_exposure_pct / 100
        open_usd = self.state.total_open_usd
        if open_usd + size_usd > max_total:
            size_usd = max(0.0, max_total - open_usd)
            if size_usd < 1.0:
                return RiskCheck(False, "Total portfolio exposure maxed out", 0.0)

        return RiskCheck(True, f"Approved ${size_usd:.2f} {reason_suffix}", size_usd)

    def record_entry(self, condition_id: str, category: str, size_usd: float) -> None:
        self.state.open_positions_usd[condition_id] = (
            self.state.open_positions_usd.get(condition_id, 0) + size_usd
        )
        self.state.category_exposure_usd[category] = (
            self.state.category_exposure_usd.get(category, 0) + size_usd
        )

    def record_exit(self, condition_id: str, category: str, pnl_usd: float) -> None:
        size = self.state.open_positions_usd.pop(condition_id, 0.0)
        self.state.category_exposure_usd[category] = max(
            0.0, self.state.category_exposure_usd.get(category, 0) - size
        )
        self.state.daily_pnl_usd += pnl_usd
        if pnl_usd < 0:
            self.state.daily_losses += 1
