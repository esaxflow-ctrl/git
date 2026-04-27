"""Wallet Sharp Score (0-100).

Scoring philosophy:
  - Long-term profitability across many markets
  - Consistent win rate (not one-hit-wonder)
  - Early entry before price moves
  - Beating closing price
  - Category-specific expertise
  - Low drawdown relative to profit
  - Consistent sizing (not lottery gambling)
"""
from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

log = logging.getLogger(__name__)


@dataclass
class WalletMetrics:
    """Derived metrics needed for scoring — populated from API data."""

    address: str
    total_profit_usd: float = 0.0
    total_volume_usd: float = 0.0
    roi_pct: float = 0.0

    markets_traded: int = 0
    resolved_markets: int = 0
    win_count: int = 0
    loss_count: int = 0

    avg_position_size_usd: float = 0.0
    median_position_size_usd: float = 0.0
    largest_position_usd: float = 0.0
    largest_win_usd: float = 0.0
    largest_loss_usd: float = 0.0

    # Profit excluding biggest single win — detects one-hit-wonders
    profit_ex_top_win: float = 0.0

    avg_entry_price: float = 0.5
    avg_closing_price: float = 0.5
    # Fraction of trades where wallet closed above entry (beat the closer)
    beat_close_rate_pct: float = 0.0
    # Fraction of trades where wallet entered early (before price moved ≥10%)
    early_entry_rate_pct: float = 0.0

    # Category breakdown  {category: profit_usd}
    category_profits: dict[str, float] = field(default_factory=dict)

    days_since_last_active: int = 999
    active_positions_count: int = 0


@dataclass
class SharpScoreResult:
    score: float  # 0-100
    breakdown: dict[str, float]
    flags: list[str]  # human-readable warnings / positives
    grade: str  # F / D / C / B / A / S

    def __str__(self) -> str:
        lines = [f"Sharp Score: {self.score:.1f}/100 ({self.grade})"]
        for k, v in self.breakdown.items():
            lines.append(f"  {k}: {v:+.1f}")
        for flag in self.flags:
            lines.append(f"  ⚑ {flag}")
        return "\n".join(lines)


def _clamp(val: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, val))


class WalletScorer:
    """Calculate a sharpness score for a wallet based on its trading history."""

    # ── Component max points ──────────────────────────────────────────────────
    COMPONENT_WEIGHTS = {
        "profitability": 20,
        "sample_size": 15,
        "consistency": 15,
        "profit_ex_top_win": 10,
        "early_entry": 10,
        "beat_close": 8,
        "sizing_discipline": 7,
        "category_expertise": 5,
        "recent_activity": 5,
        "drawdown_ratio": 5,
    }
    # ── Penalty deductions ────────────────────────────────────────────────────
    PENALTY_WEIGHTS = {
        "one_hit_wonder": -20,
        "tiny_longshot_only": -10,
        "poor_win_rate": -8,
        "chases_price": -8,
        "illiquid_markets_only": -5,
        "huge_loss_relative": -5,
        "inactive": -3,
    }

    def score(self, m: WalletMetrics) -> SharpScoreResult:
        components: dict[str, float] = {}
        penalties: dict[str, float] = {}
        flags: list[str] = []

        total_trades = m.win_count + m.loss_count or 1
        win_rate = m.win_count / total_trades

        # ── 1. Profitability (20pts) ──────────────────────────────────────────
        # Logarithmic scale: $10k = ~10pts, $100k = ~20pts
        if m.total_profit_usd > 0:
            profit_score = min(20.0, 20.0 * math.log10(max(1, m.total_profit_usd)) / 5.0)
        else:
            profit_score = max(0.0, 20.0 + m.total_profit_usd / 5000.0)  # negative but bounded
        components["profitability"] = _clamp(profit_score, 0, 20)

        # ── 2. Sample size (15pts) ────────────────────────────────────────────
        # Need many resolved markets to trust the score
        resolved = m.resolved_markets
        if resolved >= 100:
            sample_score = 15.0
        elif resolved >= 50:
            sample_score = 12.0
        elif resolved >= 20:
            sample_score = 8.0
        elif resolved >= 10:
            sample_score = 5.0
        else:
            sample_score = max(0.0, resolved * 0.4)
        components["sample_size"] = sample_score

        if m.resolved_markets < 10:
            flags.append(f"Small sample: only {m.resolved_markets} resolved markets")

        # ── 3. Win-rate consistency (15pts) ───────────────────────────────────
        # Prediction markets: good win rate is 55-70% (depending on avg price)
        # We benchmark against naive 50% (random)
        if win_rate >= 0.65:
            consistency_score = 15.0
        elif win_rate >= 0.55:
            consistency_score = 10.0 + (win_rate - 0.55) * 50.0
        elif win_rate >= 0.45:
            consistency_score = 4.0 + (win_rate - 0.45) * 60.0
        else:
            consistency_score = max(0.0, win_rate * 8.0)
        components["consistency"] = _clamp(consistency_score, 0, 15)

        # ── 4. Profit excluding top win (10pts) ───────────────────────────────
        if m.resolved_markets >= 5:
            if m.profit_ex_top_win > 0:
                ex_score = min(10.0, 10.0 * math.log10(max(1, m.profit_ex_top_win)) / 4.5)
            else:
                ex_score = max(0.0, 5.0 + m.profit_ex_top_win / 5000.0)
        else:
            ex_score = 0.0
        components["profit_ex_top_win"] = _clamp(ex_score, 0, 10)

        # One-hit-wonder penalty
        if m.largest_win_usd > 0 and m.total_profit_usd > 0:
            top_win_fraction = m.largest_win_usd / max(1, m.total_profit_usd)
            if top_win_fraction > 0.8 and m.resolved_markets >= 5:
                penalties["one_hit_wonder"] = self.PENALTY_WEIGHTS["one_hit_wonder"]
                flags.append(
                    f"One-hit-wonder risk: top win is {top_win_fraction:.0%} of total profit"
                )

        # ── 5. Early entry (10pts) ────────────────────────────────────────────
        early_score = m.early_entry_rate_pct / 100.0 * 10.0
        components["early_entry"] = _clamp(early_score, 0, 10)
        if m.early_entry_rate_pct > 60:
            flags.append(f"Strong early entry: {m.early_entry_rate_pct:.0f}% before price moves")

        # ── 6. Beat closing price (8pts) ──────────────────────────────────────
        beat_score = m.beat_close_rate_pct / 100.0 * 8.0
        components["beat_close"] = _clamp(beat_score, 0, 8)

        # ── 7. Sizing discipline (7pts) ───────────────────────────────────────
        # Consistent sizing = not gambling randomly
        if m.avg_position_size_usd > 0 and m.median_position_size_usd > 0:
            size_ratio = m.median_position_size_usd / m.avg_position_size_usd
            # Ratio near 1 = consistent. Fat tail = ratio drops
            sizing_score = size_ratio * 7.0
        else:
            sizing_score = 3.5
        components["sizing_discipline"] = _clamp(sizing_score, 0, 7)

        # Tiny long-shot gambling penalty
        if m.avg_entry_price < 0.05 and m.markets_traded > 10:
            penalties["tiny_longshot_only"] = self.PENALTY_WEIGHTS["tiny_longshot_only"]
            flags.append("Lottery behavior: avg entry price < 5¢")

        # ── 8. Category expertise (5pts) ──────────────────────────────────────
        if m.category_profits:
            top_cat_profit = max(m.category_profits.values())
            cat_score = min(5.0, 5.0 * math.log10(max(1, top_cat_profit)) / 4.0)
        else:
            cat_score = 0.0
        components["category_expertise"] = _clamp(cat_score, 0, 5)

        # ── 9. Recent activity (5pts) ─────────────────────────────────────────
        days = m.days_since_last_active
        if days <= 7:
            activity_score = 5.0
        elif days <= 30:
            activity_score = 3.0
        elif days <= 90:
            activity_score = 1.0
        else:
            activity_score = 0.0
            penalties["inactive"] = self.PENALTY_WEIGHTS["inactive"]
            flags.append(f"Inactive: last seen {days} days ago")
        components["recent_activity"] = activity_score

        # ── 10. Drawdown ratio (5pts) ─────────────────────────────────────────
        if m.total_profit_usd > 0 and m.largest_loss_usd > 0:
            dd_ratio = m.total_profit_usd / abs(m.largest_loss_usd)
            dd_score = min(5.0, 5.0 * math.log10(max(1, dd_ratio + 1)) / 1.5)
        elif m.total_profit_usd > 0:
            dd_score = 5.0
        else:
            dd_score = 0.0
        components["drawdown_ratio"] = _clamp(dd_score, 0, 5)

        # ── Apply extra penalties ─────────────────────────────────────────────
        if win_rate < 0.40 and m.resolved_markets >= 10:
            penalties["poor_win_rate"] = self.PENALTY_WEIGHTS["poor_win_rate"]
            flags.append(f"Poor win rate: {win_rate:.0%}")

        if m.largest_loss_usd > m.total_profit_usd * 2 and m.total_profit_usd > 0:
            penalties["huge_loss_relative"] = self.PENALTY_WEIGHTS["huge_loss_relative"]
            flags.append("Huge loss relative to total profit")

        # ── Final score ───────────────────────────────────────────────────────
        raw = sum(components.values()) + sum(penalties.values())
        score = _clamp(raw, 0.0, 100.0)

        all_components = {**components, **penalties}
        grade = self._grade(score)

        if score >= 75:
            flags.append(f"Elite wallet ({grade})")
        elif score >= 60:
            flags.append(f"Strong wallet ({grade})")
        elif score >= 40:
            flags.append(f"Average wallet ({grade})")
        else:
            flags.append(f"Weak/unproven wallet ({grade})")

        return SharpScoreResult(
            score=round(score, 1),
            breakdown=all_components,
            flags=flags,
            grade=grade,
        )

    @staticmethod
    def _grade(score: float) -> str:
        if score >= 85:
            return "S"
        if score >= 75:
            return "A"
        if score >= 60:
            return "B"
        if score >= 45:
            return "C"
        if score >= 30:
            return "D"
        return "F"


def build_metrics_from_api(address: str, profile: dict, positions: list[dict], activity: list[dict]) -> WalletMetrics:
    """Convert raw API data into WalletMetrics for scoring.

    Positions are the source of truth (Gamma /positions returns cashPnl,
    realizedPnl, initialValue, etc. per position). Profile/activity are
    optional augmentation when the Data API actually responds.
    """
    m = WalletMetrics(address=address)

    # ── Primary: per-position PnL aggregation (always works) ──────────────────
    if positions:
        pos_pnls: list[float] = []
        sizes: list[float] = []
        entry_prices: list[float] = []
        condition_ids: set[str] = set()
        category_pnl: dict[str, float] = {}
        resolved_count = 0
        active_count = 0
        most_recent_ts: Optional[datetime] = None

        for pos in positions:
            init_val = float(pos.get("initialValue", 0) or 0)
            curr_val = float(pos.get("currentValue", 0) or 0)
            cash_pnl = float(pos.get("cashPnl", 0) or 0)
            real_pnl = float(pos.get("realizedPnl", 0) or 0)
            entry_price = float(pos.get("avgPrice", 0) or 0)
            cid = pos.get("conditionId") or pos.get("market") or ""
            redeemed = bool(pos.get("redeemed", False))
            redeemable = bool(pos.get("redeemable", False))
            size = float(pos.get("size", 0) or 0)

            # Some Gamma payloads omit cashPnl — derive from currentValue - initialValue
            if cash_pnl == 0 and (curr_val or init_val):
                cash_pnl = curr_val - init_val

            pnl = cash_pnl + real_pnl
            pos_pnls.append(pnl)

            if init_val > 0:
                sizes.append(init_val)
            if 0 < entry_price < 1:
                entry_prices.append(entry_price)
            if cid:
                condition_ids.add(cid)

            # A position is "resolved" if it was redeemed or is currently redeemable
            # (market closed). Anything still open with size>0 is active.
            if redeemed or redeemable:
                resolved_count += 1
            elif size > 0:
                active_count += 1

            # Per-category PnL — Gamma uses "category" or "eventSlug" as proxy
            cat = pos.get("category") or pos.get("eventSlug") or "uncategorized"
            category_pnl[cat] = category_pnl.get(cat, 0.0) + pnl

            # Last-active hint — most recent position end/update timestamp
            for ts_field in ("endDate", "updatedAt", "lastInteraction"):
                ts_str = pos.get(ts_field)
                if not ts_str:
                    continue
                try:
                    from dateutil.parser import parse as dtparse
                    ts_dt = dtparse(ts_str)
                    if ts_dt.tzinfo is None:
                        ts_dt = ts_dt.replace(tzinfo=timezone.utc)
                    if most_recent_ts is None or ts_dt > most_recent_ts:
                        most_recent_ts = ts_dt
                except Exception:
                    pass

        m.total_profit_usd = sum(pos_pnls)
        m.total_volume_usd = sum(sizes)
        if m.total_volume_usd > 0:
            m.roi_pct = m.total_profit_usd / m.total_volume_usd * 100

        m.win_count = sum(1 for p in pos_pnls if p > 0)
        m.loss_count = sum(1 for p in pos_pnls if p < 0)
        m.markets_traded = len(condition_ids)
        # If we found explicit resolved markers, trust them; else fall back to win+loss
        m.resolved_markets = resolved_count or (m.win_count + m.loss_count)
        m.active_positions_count = active_count
        m.category_profits = {k: v for k, v in category_pnl.items() if v != 0}

        if sizes:
            m.avg_position_size_usd = sum(sizes) / len(sizes)
            sorted_sizes = sorted(sizes)
            m.median_position_size_usd = sorted_sizes[len(sorted_sizes) // 2]
            m.largest_position_usd = max(sizes)

        if entry_prices:
            m.avg_entry_price = sum(entry_prices) / len(entry_prices)

        if pos_pnls:
            top = max(pos_pnls)
            bot = min(pos_pnls)
            m.largest_win_usd = top if top > 0 else 0.0
            m.largest_loss_usd = abs(bot) if bot < 0 else 0.0
            m.profit_ex_top_win = m.total_profit_usd - m.largest_win_usd

        if most_recent_ts:
            m.days_since_last_active = (datetime.now(timezone.utc) - most_recent_ts).days

    # ── Secondary: profile data overrides if it actually returned numbers ─────
    # The Data API is mostly 404-ing right now, but if it ever works, it gives
    # an authoritative aggregate that's more accurate than per-position math.
    if profile:
        profile_pnl = float(profile.get("pnl", profile.get("profitLoss", 0)) or 0)
        profile_vol = float(profile.get("volume", profile.get("totalVolume", 0)) or 0)
        profile_markets = int(profile.get("marketsTraded", profile.get("numMarkets", 0)) or 0)
        if profile_pnl != 0:
            m.total_profit_usd = profile_pnl
        if profile_vol > 0:
            m.total_volume_usd = profile_vol
            m.roi_pct = m.total_profit_usd / m.total_volume_usd * 100
        if profile_markets > m.markets_traded:
            m.markets_traded = profile_markets

        last_active_str = profile.get("lastActive", profile.get("updatedAt", ""))
        if last_active_str:
            try:
                from dateutil.parser import parse as dtparse
                last_dt = dtparse(last_active_str)
                if last_dt.tzinfo is None:
                    last_dt = last_dt.replace(tzinfo=timezone.utc)
                days = (datetime.now(timezone.utc) - last_dt).days
                if days < m.days_since_last_active:
                    m.days_since_last_active = days
            except Exception:
                pass

    # ── Tertiary: activity hints early-entry / beat-close (best-effort) ───────
    if activity:
        early_entries = beat_closes = total_acts = 0
        for act in activity:
            entry_p = float(act.get("price", 0) or 0)
            close_p = float(act.get("outcomePrice", 0) or 0)
            if 0 < entry_p < 1:
                total_acts += 1
                # Entered at extremes (≤25¢ or ≥75¢) = early conviction
                if entry_p <= 0.25 or entry_p >= 0.75:
                    early_entries += 1
                # Beat the closer if direction-aligned outcome > entry
                if 0 < close_p < 1 and abs(close_p - 0.5) > abs(entry_p - 0.5):
                    beat_closes += 1
        if total_acts > 0:
            m.early_entry_rate_pct = early_entries / total_acts * 100
            m.beat_close_rate_pct = beat_closes / total_acts * 100

    return m
