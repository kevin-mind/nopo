"""Kalshi prediction markets adapter."""

import asyncio
import hashlib
import hmac
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import httpx
import pandas as pd

from trading.core.types import AssetType, KalshiMarket, MarketData, OHLCV


@dataclass
class KalshiConfig:
    """Kalshi API configuration."""

    api_key: str
    private_key: str  # RSA private key for signing
    base_url: str = "https://api.elections.kalshi.com/trade-api/v2"
    demo_url: str = "https://demo-api.kalshi.co/trade-api/v2"
    use_demo: bool = True

    @property
    def url(self) -> str:
        return self.demo_url if self.use_demo else self.base_url


@dataclass
class KalshiAdapter:
    """
    Adapter for Kalshi prediction markets API.

    Kalshi is a CFTC-regulated exchange for event contracts.
    Contracts settle at $1 if the event occurs, $0 otherwise.
    Prices are quoted in cents (0-100).

    Key features:
    - Binary outcomes (YES/NO contracts)
    - Known maximum loss (contract price)
    - Time-bounded events
    - High implied volatility near expiration

    API Notes:
    - Tokens expire every 30 minutes
    - Rate limiting applies
    - REST API with WebSocket for real-time data
    """

    config: KalshiConfig | None = None
    _client: httpx.AsyncClient | None = None
    _token: str | None = None
    _token_expiry: float = 0.0

    async def connect(self) -> None:
        """Initialize connection and authenticate."""
        if self.config is None:
            raise ValueError("Config not set. Use KalshiAdapter(config=KalshiConfig(...))")

        self._client = httpx.AsyncClient(timeout=30.0)

        # Authenticate and get token
        await self._authenticate()

    async def disconnect(self) -> None:
        """Close connection."""
        if self._client:
            await self._client.aclose()
            self._client = None

    async def _authenticate(self) -> None:
        """Authenticate with Kalshi API."""
        # Note: Kalshi uses RSA signing for authentication
        # This is a simplified version - real implementation needs RSA
        timestamp = int(time.time() * 1000)

        # In production, sign with RSA private key
        headers = {
            "KALSHI-ACCESS-KEY": self.config.api_key,
            "KALSHI-ACCESS-TIMESTAMP": str(timestamp),
            # "KALSHI-ACCESS-SIGNATURE": signature,  # RSA signature
        }

        # For demo, we might use simpler auth
        self._token = "demo_token"
        self._token_expiry = time.time() + 1800  # 30 minutes

    def _get_headers(self) -> dict[str, str]:
        """Get authenticated headers."""
        return {
            "Authorization": f"Bearer {self._token}",
            "Content-Type": "application/json",
        }

    async def get_markets(
        self,
        series_ticker: str | None = None,
        status: str = "active",
        limit: int = 100,
    ) -> list[KalshiMarket]:
        """
        Get available markets.

        Args:
            series_ticker: Filter by series (e.g., "KXBTC" for Bitcoin)
            status: Market status ("active", "settled", "closed")
            limit: Maximum number of markets

        Returns:
            List of KalshiMarket objects
        """
        if not self._client:
            raise RuntimeError("Not connected. Call connect() first.")

        params: dict[str, Any] = {"status": status, "limit": limit}
        if series_ticker:
            params["series_ticker"] = series_ticker

        response = await self._client.get(
            f"{self.config.url}/markets",
            params=params,
            headers=self._get_headers(),
        )
        response.raise_for_status()

        markets = []
        for m in response.json().get("markets", []):
            markets.append(
                KalshiMarket(
                    ticker=m["ticker"],
                    title=m["title"],
                    subtitle=m.get("subtitle", ""),
                    yes_price=m.get("yes_bid", 50),  # Cents
                    no_price=m.get("no_bid", 50),
                    volume=m.get("volume", 0),
                    open_interest=m.get("open_interest", 0),
                    expiration=datetime.fromisoformat(m["close_time"].replace("Z", "+00:00")),
                    result=m.get("result"),
                )
            )

        return markets

    async def get_market(self, ticker: str) -> KalshiMarket:
        """Get a specific market by ticker."""
        if not self._client:
            raise RuntimeError("Not connected. Call connect() first.")

        response = await self._client.get(
            f"{self.config.url}/markets/{ticker}",
            headers=self._get_headers(),
        )
        response.raise_for_status()

        m = response.json()["market"]
        return KalshiMarket(
            ticker=m["ticker"],
            title=m["title"],
            subtitle=m.get("subtitle", ""),
            yes_price=m.get("yes_bid", 50),
            no_price=m.get("no_bid", 50),
            volume=m.get("volume", 0),
            open_interest=m.get("open_interest", 0),
            expiration=datetime.fromisoformat(m["close_time"].replace("Z", "+00:00")),
            result=m.get("result"),
        )

    async def get_market_history(
        self,
        ticker: str,
        start_ts: datetime | None = None,
        end_ts: datetime | None = None,
    ) -> pd.DataFrame:
        """
        Get historical price data for a market.

        Returns DataFrame with columns: timestamp, yes_price, no_price, volume
        """
        if not self._client:
            raise RuntimeError("Not connected. Call connect() first.")

        params: dict[str, Any] = {}
        if start_ts:
            params["min_ts"] = int(start_ts.timestamp())
        if end_ts:
            params["max_ts"] = int(end_ts.timestamp())

        response = await self._client.get(
            f"{self.config.url}/markets/{ticker}/history",
            params=params,
            headers=self._get_headers(),
        )
        response.raise_for_status()

        history = response.json().get("history", [])

        df = pd.DataFrame(history)
        if not df.empty:
            df["timestamp"] = pd.to_datetime(df["ts"], unit="s")
            df = df.set_index("timestamp")
            df = df.rename(columns={"yes_price": "close"})

        return df

    def market_to_market_data(self, market: KalshiMarket) -> MarketData:
        """Convert KalshiMarket to generic MarketData."""
        return MarketData(
            symbol=market.ticker,
            asset_type=AssetType.PREDICTION,
            current_price=market.yes_price / 100.0,  # Convert cents to dollars
            bid=market.yes_price / 100.0,
            ask=(100 - market.no_price) / 100.0,
            spread=(100 - market.no_price - market.yes_price) / 100.0,
        )

    # Simulated data for backtesting (when API not available)
    @staticmethod
    def generate_sample_data(
        days: int = 30,
        initial_prob: float = 0.5,
        volatility: float = 0.1,
    ) -> pd.DataFrame:
        """
        Generate sample prediction market data for backtesting.

        Simulates a market with mean-reverting price around true probability.

        Args:
            days: Number of days of data
            initial_prob: Starting implied probability
            volatility: Daily volatility

        Returns:
            DataFrame with timestamp index and price columns
        """
        import numpy as np

        np.random.seed(42)

        n_points = days * 24  # Hourly data
        timestamps = pd.date_range(start="2024-01-01", periods=n_points, freq="h")

        # Mean-reverting process around initial probability
        prices = [initial_prob]
        for _ in range(n_points - 1):
            # Ornstein-Uhlenbeck process
            mean_reversion = 0.1 * (initial_prob - prices[-1])
            noise = volatility * np.random.randn() / np.sqrt(24)
            new_price = prices[-1] + mean_reversion + noise
            # Clamp to valid range
            new_price = max(0.01, min(0.99, new_price))
            prices.append(new_price)

        df = pd.DataFrame(
            {
                "close": prices,
                "open": prices,
                "high": [p + volatility * 0.5 for p in prices],
                "low": [p - volatility * 0.5 for p in prices],
                "volume": np.random.randint(100, 10000, n_points),
            },
            index=timestamps,
        )

        df.attrs["asset_type"] = AssetType.PREDICTION
        return df
