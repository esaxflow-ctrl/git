"""Copy Decision Engine.

For each detected trade, decide whether it's worth copying.

Outputs one of:
  PASS                  — ignore, not interesting enough
  WATCH                 — monitor market but don't enter
  SMALL_TAIL            — enter with speculative sizing (0.25% bankroll)
  STRONG_WATCH          — good signal, watch for entry opportunity
  MANUAL_APPROVAL       — high signal, needs human review before acting
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Literal

from src.config import get_settings
from src.detection.flow_detector import DetectedTrade
from src.scoring.signal_scorer import SignalScoreResult

log = logging.getLogger(__name__)
settings = get_settings()

Action = Literal["PASS", "WATCH", "SMALL_TAIL", "STRONG_WATCH", "MANUAL_APPROVAL"]


@dataclass
class CopyDecision:
    action: Action
    max_risk_usd: float
    reasons: list[str]
    vetos: list[str]
    signal_score: float
    wallet_sharp_score: float

    def __str__(self) -> str:
        lines = [
            f"Action: {self.action}",
            f"Max risk: ${self.max_risk_usd:.2f}",
            f"Signal: {self.signal_score:.1f}  Wallet: {self.wallet_sharp_score:.1f}",
        ]
        for r in self.reasons:
            lines.append(f"  + {r}")
        for v in self.vetos:
            lines.append(f"  ✗ {v}")
        return "\n".join(lines)


class CopyEngine:

    def evaluate(self, trade: DetectedTrade, signal: SignalScoreResult) -> CopyDecision:
        vetos: list[str] = []
        reasons: list[str] = []

        score = signal.score
        sharp = trade.wallet_sharp_score

        # ── Hard vetos (PASS immediately) ──────────────────────────────────────

        if sharp < 30:
            vetos.append(f"Wallet too weak (sharp score {sharp:.0f} < 30)")
        if score < settings.min_signal_score_alert:
            vetos.append(f"Signal score {score:.0f} below alert threshold {settings.min_signal_score_alert}")
        if trade.side == "SELL":
            vetos.append("Wallet is exiting, not entering — do not copy exits")
        if trade.spread > settings.max_spread_pct / 100:
            vetos.append(f"Spread too wide ({trade.spread:.1%} > {settings.max_spread_pct:.1f}%)")
        if trade.liquidity_usd < settings.min_liquidity_usd:
            vetos.append(f"Liquidity too low (${trade.liquidity_usd:,.0f} < ${settings.min_liquidity_usd:,.0f})")

        # Price drift check
        if trade.entry_price > 0:
            drift = abs(trade.current_market_price - trade.entry_price) / trade.entry_price
            if drift > settings.max_price_drift_from_entry_pct / 100:
                vetos.append(
                    f"Price drifted {drift:.0%} from wallet's entry — edge likely gone"
                )

        # If hard veto fires, PASS immediately
        if vetos:
            return CopyDecision(
                action="PASS",
                max_risk_usd=0.0,
                reasons=reasons,
                vetos=vetos,
                signal_score=score,
                wallet_sharp_score=sharp,
            )

        # ── Positive factors ────────────────────────────────────────────────────
        if sharp >= 80:
            reasons.append(f"Elite wallet (sharp score {sharp:.0f})")
        if score >= 65:
            reasons.append(f"High signal score ({score:.0f})")
        cluster = getattr(trade, "_cluster_count", 0)
        if cluster >= 2:
            reasons.append(f"{cluster+1} sharp wallets on the same side")

        wallet_size_multiple = (
            trade.estimated_size_usd / trade.wallet_avg_trade_usd
            if trade.wallet_avg_trade_usd > 0
            else 1.0
        )
        if wallet_size_multiple >= 3:
            reasons.append(f"Wallet's trade is {wallet_size_multiple:.1f}x its typical size")

        # ── Determine action ────────────────────────────────────────────────────
        action: Action
        max_risk_usd: float

        if score >= 80 and sharp >= 75:
            if cluster >= 2:
                action = "MANUAL_APPROVAL"
                max_risk_usd = settings.max_position_cluster_usd
                reasons.append("Cluster + high score → manual approval before executing")
            else:
                action = "MANUAL_APPROVAL"
                max_risk_usd = settings.max_position_strong_usd
        elif score >= 65 and sharp >= 60:
            action = "STRONG_WATCH"
            max_risk_usd = settings.max_position_strong_usd
        elif score >= 50 and sharp >= 50:
            action = "SMALL_TAIL"
            max_risk_usd = settings.max_position_speculative_usd
        elif score >= settings.min_signal_score_alert:
            action = "WATCH"
            max_risk_usd = 0.0
        else:
            action = "PASS"
            max_risk_usd = 0.0

        return CopyDecision(
            action=action,
            max_risk_usd=max_risk_usd,
            reasons=reasons,
            vetos=vetos,
            signal_score=score,
            wallet_sharp_score=sharp,
        )
