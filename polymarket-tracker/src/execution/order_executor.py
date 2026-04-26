"""Order executor — places real limit orders via Polymarket CLOB API.

Start in paper/alert_only mode. Only enable after proven performance.
Never hardcode private keys — use environment variables.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from src.config import get_settings
from src.database import SessionLocal, LiveTradeDB

log = logging.getLogger(__name__)
settings = get_settings()


class OrderExecutor:

    def __init__(self) -> None:
        self._client = None  # lazy-init to avoid import errors if py-clob-client not installed

    def _get_client(self):
        if self._client is not None:
            return self._client
        try:
            from py_clob_client.client import ClobClient
            from py_clob_client.clob_types import ApiCreds
            creds = ApiCreds(
                api_key=settings.polymarket_api_key,
                api_secret=settings.polymarket_api_secret,
                api_passphrase=settings.polymarket_api_passphrase,
            )
            self._client = ClobClient(
                host=settings.clob_api_base,
                key=settings.polymarket_private_key,
                chain_id=137,  # Polygon
                creds=creds,
            )
            return self._client
        except ImportError:
            log.error("py-clob-client not installed — live execution unavailable")
            raise
        except Exception as exc:
            log.error("CLOB client init failed: %s", exc)
            raise

    async def place_limit_order(
        self,
        alert_id: int,
        condition_id: str,
        token_id: str,
        outcome: str,
        side: str,  # BUY / SELL
        price: float,
        size_usd: float,
        max_slippage_pct: float = 2.0,
    ) -> Optional[LiveTradeDB]:
        """Place a limit order. Logs the attempt regardless of outcome."""
        if settings.execution_mode in ("alert_only", "paper"):
            log.info("Execution mode is %s — skipping live order", settings.execution_mode)
            return None

        if not settings.polymarket_private_key:
            log.error("POLYMARKET_PRIVATE_KEY not set — cannot place orders")
            return None

        max_price = price * (1 + max_slippage_pct / 100) if side == "BUY" else price * (1 - max_slippage_pct / 100)
        shares = size_usd / price

        trade_record = LiveTradeDB(
            alert_id=alert_id,
            condition_id=condition_id,
            outcome=outcome,
            order_type="limit",
            side=side,
            requested_price=price,
            requested_size_usd=size_usd,
            status="pending",
            submitted_at=datetime.now(timezone.utc),
        )

        async with SessionLocal() as db:
            db.add(trade_record)
            await db.commit()
            await db.refresh(trade_record)

        try:
            client = self._get_client()

            from py_clob_client.clob_types import OrderArgs, OrderType
            order_args = OrderArgs(
                token_id=token_id,
                price=round(price, 4),
                size=round(shares, 4),
                side=side,
            )
            resp = client.create_and_post_order(order_args)
            order_id = resp.get("orderID") or resp.get("id", "")

            async with SessionLocal() as db:
                trade_record.order_id = order_id
                trade_record.status = "submitted"
                db.add(trade_record)
                await db.commit()

            log.info("Order submitted: %s %s @ %.4f ($%.2f) → id=%s", side, outcome, price, size_usd, order_id)

            # Check fill status
            filled = await self._poll_fill(client, order_id)
            async with SessionLocal() as db:
                if filled:
                    trade_record.status = "filled"
                    trade_record.filled_price = filled.get("price", price)
                    trade_record.filled_size_usd = filled.get("matched_amount", size_usd)
                    trade_record.filled_at = datetime.now(timezone.utc)
                    log.info("Order filled: %s @ %.4f", order_id, trade_record.filled_price)
                else:
                    trade_record.status = "canceled"
                    # Cancel if not filled within window
                    try:
                        client.cancel(order_id)
                    except Exception:
                        pass
                    log.info("Order %s canceled — not filled in time", order_id)
                db.add(trade_record)
                await db.commit()

            return trade_record

        except Exception as exc:
            log.error("Order placement failed: %s", exc)
            async with SessionLocal() as db:
                trade_record.status = "failed"
                trade_record.error_msg = str(exc)[:512]
                db.add(trade_record)
                await db.commit()
            return trade_record

    async def _poll_fill(self, client, order_id: str, timeout_seconds: int = 30) -> Optional[dict]:
        import asyncio
        for _ in range(timeout_seconds // 5):
            await asyncio.sleep(5)
            try:
                order = client.get_order(order_id)
                status = order.get("status", "")
                if status in ("MATCHED", "FILLED"):
                    return order
                if status in ("CANCELLED", "EXPIRED"):
                    return None
            except Exception:
                pass
        return None

    async def cancel_order(self, order_id: str) -> bool:
        try:
            client = self._get_client()
            client.cancel(order_id)
            log.info("Canceled order %s", order_id)
            return True
        except Exception as exc:
            log.warning("Cancel failed for %s: %s", order_id, exc)
            return False
