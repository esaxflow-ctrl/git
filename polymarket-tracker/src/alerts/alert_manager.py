"""Alert manager — formats, stores, and delivers alerts."""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import aiohttp

from src.config import get_settings
from src.database import SessionLocal, AlertDB
from src.detection.flow_detector import DetectedTrade
from src.detection.copy_engine import CopyDecision
from src.scoring.signal_scorer import SignalScoreResult

log = logging.getLogger(__name__)
settings = get_settings()


def format_alert(
    trade: DetectedTrade,
    signal: SignalScoreResult,
    decision: CopyDecision,
) -> str:
    wallet_label = trade.wallet_username or trade.wallet_address[:10] + "…"
    drift = (
        abs(trade.current_market_price - trade.entry_price) / trade.entry_price * 100
        if trade.entry_price > 0
        else 0.0
    )
    cluster = getattr(trade, "_cluster_count", 0)

    lines = [
        "=" * 60,
        "  ⚡  INFORMED FLOW ALERT",
        "=" * 60,
        "",
        f"MARKET:",
        f"  {trade.market_question}",
        f"  Category: {trade.category}",
        "",
        f"CURRENT PRICE:  {trade.current_market_price:.3f}  ({trade.current_market_price*100:.1f}¢)",
        f"SPREAD:         {trade.spread*100:.2f}¢",
        f"LIQUIDITY:      ${trade.liquidity_usd:,.0f}",
        f"VOLUME 24H:     ${trade.volume_24h_usd:,.0f}",
        "",
        f"WALLET:",
        f"  {wallet_label}",
        f"  Address: {trade.wallet_address}",
        "",
        f"WALLET QUALITY: {trade.wallet_sharp_score:.1f}/100",
        "",
        f"TRADE DETECTED:",
        f"  {trade.side} {trade.outcome} at {trade.entry_price:.3f} ({trade.entry_price*100:.1f}¢)",
        "",
        f"ESTIMATED SIZE: ${trade.estimated_size_usd:,.0f}  ({trade.estimated_shares:.1f} shares)",
        f"  (wallet's typical: ${trade.wallet_avg_trade_usd:,.0f})",
        f"  (multiple of avg: {trade.estimated_size_usd/max(1,trade.wallet_avg_trade_usd):.1f}x)",
        "",
    ]

    if cluster > 0:
        lines += [
            f"CLUSTER:  {cluster+1} sharp wallets on {trade.outcome} side  ⚡",
            "",
        ]

    lines += [
        "WHY THIS IS INTERESTING:",
        f"  {signal.why_interesting}",
        "",
        "WHY THIS COULD BE INFORMED:",
        f"  {signal.why_informed}",
        "",
        "WHY THIS COULD BE NOISE:",
        f"  {signal.why_noise}",
        "",
        "PRICE COMPARISON:",
        f"  Wallet entry:      {trade.entry_price:.4f}",
        f"  Current best ask:  {trade.current_market_price:.4f}",
        f"  Drift:             {drift:.1f}%",
        "",
        f"SIGNAL SCORE:   {signal.score:.1f}/100  [{signal.label}]",
        "",
        "SIGNAL BREAKDOWN:",
    ]
    for component, pts in signal.breakdown.items():
        lines.append(f"  {component:<28} {pts:+.1f}")

    lines += [
        "",
        f"SUGGESTED ACTION:  {decision.action}",
        f"MAX RISK:          ${decision.max_risk_usd:.2f}",
    ]
    if decision.reasons:
        lines.append("REASONS:")
        for r in decision.reasons:
            lines.append(f"  + {r}")
    if decision.vetos:
        lines.append("VETOS:")
        for v in decision.vetos:
            lines.append(f"  ✗ {v}")

    lines += ["", "=" * 60, ""]
    return "\n".join(lines)


class AlertManager:

    def __init__(self) -> None:
        self._log_path = Path(settings.alert_log_file)
        self._session: Optional[aiohttp.ClientSession] = None

    async def _get_http(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=15))
        return self._session

    async def fire(
        self,
        trade: DetectedTrade,
        signal: SignalScoreResult,
        decision: CopyDecision,
    ) -> int:
        """Persist alert, write to log file, and push to configured channels. Returns alert DB id."""
        text = format_alert(trade, signal, decision)

        # Persist to DB
        alert_id = await self._persist(trade, signal, decision, text)

        # Write to JSONL log
        self._write_log(alert_id, trade, signal, decision)

        # Console
        log.info("\n%s", text)

        # External notifications
        await self._notify_telegram(text)
        await self._notify_discord(text)

        return alert_id

    async def _persist(
        self,
        trade: DetectedTrade,
        signal: SignalScoreResult,
        decision: CopyDecision,
        text: str,
    ) -> int:
        async with SessionLocal() as db:
            alert = AlertDB(
                condition_id=trade.condition_id,
                wallet_address=trade.wallet_address,
                outcome=trade.outcome,
                signal_score=signal.score,
                wallet_sharp_score=trade.wallet_sharp_score,
                wallet_entry_price=trade.entry_price,
                current_price_at_alert=trade.current_market_price,
                trade_size_usd=trade.estimated_size_usd,
                market_question=trade.market_question,
                suggested_action=decision.action,
                max_risk_usd=decision.max_risk_usd,
                alert_text=text,
                status="open",
            )
            db.add(alert)
            await db.commit()
            await db.refresh(alert)
            return alert.id

    def _write_log(
        self,
        alert_id: int,
        trade: DetectedTrade,
        signal: SignalScoreResult,
        decision: CopyDecision,
    ) -> None:
        record = {
            "id": alert_id,
            "ts": datetime.now(timezone.utc).isoformat(),
            "market": trade.market_question,
            "condition_id": trade.condition_id,
            "wallet": trade.wallet_address,
            "wallet_score": trade.wallet_sharp_score,
            "outcome": trade.outcome,
            "side": trade.side,
            "entry_price": trade.entry_price,
            "current_price": trade.current_market_price,
            "size_usd": trade.estimated_size_usd,
            "signal_score": signal.score,
            "signal_label": signal.label,
            "action": decision.action,
            "max_risk_usd": decision.max_risk_usd,
        }
        try:
            with self._log_path.open("a") as f:
                f.write(json.dumps(record) + "\n")
        except Exception as exc:
            log.warning("Failed to write alert log: %s", exc)

    async def _notify_telegram(self, text: str) -> None:
        if not settings.telegram_bot_token or not settings.telegram_chat_id:
            return
        # Truncate to Telegram limit
        msg = text[:4000]
        url = f"https://api.telegram.org/bot{settings.telegram_bot_token}/sendMessage"
        try:
            session = await self._get_http()
            async with session.post(url, json={"chat_id": settings.telegram_chat_id, "text": msg}) as resp:
                if not resp.ok:
                    log.warning("Telegram notify failed: %s", await resp.text())
        except Exception as exc:
            log.warning("Telegram error: %s", exc)

    async def _notify_discord(self, text: str) -> None:
        if not settings.discord_webhook_url:
            return
        # Discord 2000 char limit per message
        chunks = [text[i:i+1990] for i in range(0, len(text), 1990)]
        try:
            session = await self._get_http()
            for chunk in chunks[:3]:
                async with session.post(
                    settings.discord_webhook_url,
                    json={"content": f"```\n{chunk}\n```"},
                ) as resp:
                    if not resp.ok:
                        log.warning("Discord notify failed: %s", await resp.text())
        except Exception as exc:
            log.warning("Discord error: %s", exc)

    async def close(self) -> None:
        if self._session and not self._session.closed:
            await self._session.close()
