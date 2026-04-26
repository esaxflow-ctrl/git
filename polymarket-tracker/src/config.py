from __future__ import annotations

import os
from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Polymarket credentials
    polymarket_api_key: str = ""
    polymarket_api_secret: str = ""
    polymarket_api_passphrase: str = ""
    polymarket_private_key: str = ""
    polymarket_wallet_address: str = ""

    # Execution mode
    execution_mode: Literal[
        "alert_only", "paper", "manual_approval", "semi_auto", "full_auto"
    ] = "alert_only"

    # Risk limits
    bankroll_usd: float = 1000.0
    max_position_speculative_pct: float = 0.25
    max_position_strong_pct: float = 0.50
    max_position_cluster_pct: float = 1.00
    max_category_exposure_pct: float = 5.0
    max_total_exposure_pct: float = 10.0
    max_daily_losses: int = 3
    max_daily_drawdown_pct: float = 3.0
    max_price_drift_from_entry_pct: float = 20.0
    max_spread_pct: float = 5.0
    min_liquidity_usd: float = 5000.0

    # Signal thresholds
    min_signal_score_auto: int = 85
    min_wallet_sharp_score_auto: int = 80
    min_signal_score_alert: int = 40

    # Wallet discovery
    min_markets_traded: int = 10
    min_resolved_markets: int = 5
    leaderboard_fetch_limit: int = 200
    wallet_refresh_interval_seconds: int = 3600
    tracker_poll_interval_seconds: int = 60

    # Alerts
    telegram_bot_token: str = ""
    telegram_chat_id: str = ""
    discord_webhook_url: str = ""
    alert_log_file: str = "alerts.jsonl"

    # Dashboard
    dashboard_host: str = "0.0.0.0"
    dashboard_port: int = 8080

    # Database
    database_url: str = "sqlite+aiosqlite:///polymarket_tracker.db"

    # Polymarket API base URLs
    gamma_api_base: str = "https://gamma-api.polymarket.com"
    clob_api_base: str = "https://clob.polymarket.com"
    data_api_base: str = "https://data-api.polymarket.com"
    leaderboard_api_base: str = "https://data-api.polymarket.com"
    strapi_api_base: str = "https://polymarket-api.polymarket.com"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"

    @property
    def max_position_speculative_usd(self) -> float:
        return self.bankroll_usd * self.max_position_speculative_pct / 100

    @property
    def max_position_strong_usd(self) -> float:
        return self.bankroll_usd * self.max_position_strong_pct / 100

    @property
    def max_position_cluster_usd(self) -> float:
        return self.bankroll_usd * self.max_position_cluster_pct / 100


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    env_file = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env")
    return Settings(_env_file=env_file)
