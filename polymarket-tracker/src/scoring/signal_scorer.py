"""Informed-Flow Signal Score (0-100).

Scoring components (sum to 100):
  wallet_sharpness    : 25 — quality of the wallet making the trade
  abnormal_size       : 20 — trade is large vs wallet's own history and market depth
  early_entry         : 20 — wallet entered before obvious news or price movement
  market_randomness   : 10 — market is low-attention / quiet
  cluster_buying      : 15 — multiple sharp wallets on same side
  liquidity_quality   :  5 — market has enough depth to be real
  price_still_good    :  5 — edge has not yet evaporated
"""
from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

log = logging.getLogger(__name__)


@dataclass
class TradeContext:
    """All context needed to score a detected trade."""

    # Wallet
    wallet_address: str
    wallet_sharp_score: float  # 0-100
    wallet_avg_trade_size_usd: float  # wallet's typical trade
    wallet_median_trade_size_usd: float

    # Trade
    trade_size_usd: float
    trade_outcome: str  # YES / NO / token name
    entry_price: float  # price wallet paid

    # Market
    condition_id: str
    market_question: str
    category: str
    current_price: float  # best available price NOW
    spread: float  # ask - bid as fraction (0-1)
    liquidity_usd: float  # total available liquidity
    volume_24h_usd: float
    volume_total_usd: float
    seconds_to_resolution: float  # 0 if unknown

    # Price move since wallet entered
    price_at_detection: float  # snapshot when alert fires
    price_before_wallet_entry: float = 0.0  # estimated price just before entry

    # Cluster
    other_sharp_wallets_same_side: int = 0  # count of other sharp wallets on same side

    # Market attention indicators
    estimated_social_volume: float = 0.0  # 0-1, higher = more public discussion
    has_obvious_public_news: bool = False

    # Order book aggression
    filled_through_book: bool = False  # wallet ate through multiple levels


@dataclass
class SignalScoreResult:
    score: float  # 0-100
    breakdown: dict[str, float]
    label: str  # NOISE / LOW / MEDIUM / HIGH / VERY_HIGH
    interpretation: str
    why_interesting: str
    why_informed: str
    why_noise: str

    def __str__(self) -> str:
        return (
            f"Signal Score: {self.score:.1f}/100 [{self.label}]\n"
            f"  {self.interpretation}\n"
            + "\n".join(f"  {k}: {v:+.1f}" for k, v in self.breakdown.items())
        )


def _clamp(v: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, v))


class SignalScorer:

    def score(self, ctx: TradeContext) -> SignalScoreResult:
        breakdown: dict[str, float] = {}
        interesting_points: list[str] = []
        informed_points: list[str] = []
        noise_points: list[str] = []

        # ── 1. Wallet sharpness (25pts) ───────────────────────────────────────
        wallet_pts = ctx.wallet_sharp_score / 100.0 * 25.0
        breakdown["wallet_sharpness"] = wallet_pts
        if ctx.wallet_sharp_score >= 80:
            interesting_points.append(f"Elite wallet (score {ctx.wallet_sharp_score:.0f}/100)")
            informed_points.append("High-scoring wallet with proven long-term profitability")
        elif ctx.wallet_sharp_score >= 60:
            interesting_points.append(f"Strong wallet (score {ctx.wallet_sharp_score:.0f}/100)")
        elif ctx.wallet_sharp_score < 30:
            noise_points.append(f"Weak wallet quality (score {ctx.wallet_sharp_score:.0f}/100)")

        # ── 2. Abnormal trade size (20pts) ────────────────────────────────────
        size_pts = 0.0
        if ctx.wallet_avg_trade_size_usd > 0:
            size_multiple = ctx.trade_size_usd / ctx.wallet_avg_trade_size_usd
            # 1x = baseline, 3x = half points, 10x = full points
            if size_multiple >= 10:
                size_pts = 20.0
            elif size_multiple >= 5:
                size_pts = 15.0 + (size_multiple - 5) / 5.0 * 5.0
            elif size_multiple >= 3:
                size_pts = 10.0 + (size_multiple - 3) / 2.0 * 5.0
            elif size_multiple >= 1.5:
                size_pts = (size_multiple - 1.5) / 1.5 * 10.0
            else:
                size_pts = 0.0

            if size_multiple >= 5:
                interesting_points.append(
                    f"Trade is {size_multiple:.1f}x the wallet's typical size (${ctx.trade_size_usd:,.0f})"
                )
                informed_points.append("Abnormally large relative to wallet's own history")
            elif size_multiple < 1.0:
                noise_points.append("Trade is smaller than wallet's typical size")

        # Market depth: trade large relative to market
        if ctx.liquidity_usd > 0:
            market_fraction = ctx.trade_size_usd / ctx.liquidity_usd
            if market_fraction > 0.1:
                size_pts = min(20.0, size_pts + market_fraction * 10.0)
                interesting_points.append(
                    f"Trade is {market_fraction:.0%} of market liquidity — aggressive"
                )
        breakdown["abnormal_size"] = _clamp(size_pts, 0, 20)

        # ── 3. Early entry (20pts) ────────────────────────────────────────────
        early_pts = 0.0
        if ctx.has_obvious_public_news:
            early_pts = 0.0
            noise_points.append("Obvious public news already explains the move")
        else:
            # Score based on price move since entry
            if ctx.price_before_wallet_entry > 0:
                price_move = abs(ctx.current_price - ctx.price_before_wallet_entry)
                # Wallet entry price vs current — how much has already moved
                entry_move = abs(ctx.entry_price - ctx.price_before_wallet_entry)
                # Large total move with small initial move = entered early
                if price_move > 0.02:
                    early_fraction = entry_move / price_move
                    early_pts = max(0.0, (1.0 - early_fraction)) * 20.0
                else:
                    early_pts = 12.0  # small price move — still reasonably early

                if early_pts > 12:
                    interesting_points.append("Wallet entered before significant price movement")
                    informed_points.append(
                        "Early entry suggests conviction before information became public"
                    )
            else:
                # Unknown pre-entry price — use social volume as proxy
                early_pts = max(0.0, (1.0 - ctx.estimated_social_volume) * 20.0)

        breakdown["early_entry"] = _clamp(early_pts, 0, 20)

        # ── 4. Market randomness / low attention (10pts) ──────────────────────
        # Low volume markets get higher score (less public interest = more edge)
        if ctx.volume_24h_usd < 1000:
            market_pts = 10.0
            interesting_points.append("Very low-volume market — not on everyone's radar")
        elif ctx.volume_24h_usd < 10_000:
            market_pts = 7.0
        elif ctx.volume_24h_usd < 50_000:
            market_pts = 4.0
        elif ctx.volume_24h_usd < 200_000:
            market_pts = 2.0
        else:
            market_pts = 0.0
            noise_points.append("High-volume market — widely followed")

        social_penalty = ctx.estimated_social_volume * 5.0
        market_pts = max(0.0, market_pts - social_penalty)
        breakdown["market_randomness"] = _clamp(market_pts, 0, 10)

        # ── 5. Cluster buying (15pts) ─────────────────────────────────────────
        n = ctx.other_sharp_wallets_same_side
        if n >= 3:
            cluster_pts = 15.0
            interesting_points.append(f"{n+1} sharp wallets on the same side — strong cluster")
            informed_points.append("Multiple independent sharp wallets agreeing suggests shared edge")
        elif n == 2:
            cluster_pts = 11.0
            interesting_points.append("3 sharp wallets on same side")
        elif n == 1:
            cluster_pts = 6.0
            interesting_points.append("2 sharp wallets on same side")
        else:
            cluster_pts = 0.0
        breakdown["cluster_buying"] = cluster_pts

        # ── 6. Liquidity quality (5pts) ───────────────────────────────────────
        if ctx.liquidity_usd >= 50_000 and ctx.spread <= 0.02:
            liq_pts = 5.0
        elif ctx.liquidity_usd >= 10_000 and ctx.spread <= 0.05:
            liq_pts = 3.0
        elif ctx.liquidity_usd >= 1_000:
            liq_pts = 1.0
        else:
            liq_pts = 0.0
            noise_points.append(f"Low liquidity (${ctx.liquidity_usd:,.0f}) — easy to manipulate")
        breakdown["liquidity_quality"] = liq_pts

        # ── 7. Price still good (5pts) ────────────────────────────────────────
        if ctx.entry_price > 0:
            drift = abs(ctx.current_price - ctx.entry_price) / ctx.entry_price
            if drift <= 0.05:
                price_pts = 5.0
            elif drift <= 0.10:
                price_pts = 3.0
            elif drift <= 0.20:
                price_pts = 1.0
            else:
                price_pts = 0.0
                noise_points.append(
                    f"Price already drifted {drift:.0%} from wallet's entry — edge may be gone"
                )
        else:
            price_pts = 2.5
        breakdown["price_still_good"] = price_pts

        # ── Bonus: book aggression ─────────────────────────────────────────────
        if ctx.filled_through_book:
            breakdown["book_aggression_bonus"] = 5.0
            interesting_points.append("Wallet accepted slippage — high-urgency entry")

        # ── Near-resolution penalty ───────────────────────────────────────────
        if 0 < ctx.seconds_to_resolution < 3600:  # < 1 hour
            breakdown["near_resolution_penalty"] = -10.0
            noise_points.append("Market resolves in < 1 hour — no time to enter")

        # ── Final ─────────────────────────────────────────────────────────────
        raw = sum(breakdown.values())
        score = _clamp(raw, 0.0, 100.0)
        label = self._label(score)

        interesting_pts_text = "; ".join(interesting_points) if interesting_points else "Standard trade."
        informed_pts_text = "; ".join(informed_points) if informed_points else "No strong informed-flow indicators."
        noise_pts_text = "; ".join(noise_points) if noise_points else "No major red flags."

        interpretation = (
            f"{label} signal from {'elite' if ctx.wallet_sharp_score >= 75 else 'average'} wallet. "
            f"Trade is ${ctx.trade_size_usd:,.0f} in {ctx.market_question[:60]}."
        )

        return SignalScoreResult(
            score=round(score, 1),
            breakdown=breakdown,
            label=label,
            interpretation=interpretation,
            why_interesting=interesting_pts_text,
            why_informed=informed_pts_text,
            why_noise=noise_pts_text,
        )

    @staticmethod
    def _label(score: float) -> str:
        if score >= 80:
            return "VERY_HIGH"
        if score >= 65:
            return "HIGH"
        if score >= 50:
            return "MEDIUM"
        if score >= 35:
            return "LOW"
        return "NOISE"
