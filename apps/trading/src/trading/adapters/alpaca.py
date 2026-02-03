"""Alpaca Markets adapter for stocks and crypto."""

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

import pandas as pd

from trading.core.types import AssetType, MarketData, OHLCV, Order, OrderSide, OrderType, Trade


@dataclass
class AlpacaConfig:
    """Alpaca API configuration."""

    api_key: str
    secret_key: str
    paper: bool = True  # Use paper trading by default
    base_url: str = ""

    def __post_init__(self) -> None:
        if not self.base_url:
            self.base_url = (
                "https://paper-api.alpaca.markets"
                if self.paper
                else "https://api.alpaca.markets"
            )


@dataclass
class AlpacaAdapter:
    """
    Adapter for Alpaca Markets API.

    Alpaca provides commission-free trading for stocks and crypto
    with excellent API support for algorithmic trading.

    Key features:
    - Paper trading for testing
    - Real-time and historical market data
    - Fractional shares
    - Extended hours trading
    - Options trading

    API Notes:
    - Uses alpaca-py official SDK
    - Rate limits apply (200 requests/minute for trading)
    - Market data has separate rate limits
    """

    config: AlpacaConfig | None = None
    _trading_client: Any = None
    _data_client: Any = None

    def connect(self) -> None:
        """Initialize connection to Alpaca."""
        if self.config is None:
            raise ValueError("Config not set. Use AlpacaAdapter(config=AlpacaConfig(...))")

        try:
            from alpaca.trading.client import TradingClient
            from alpaca.data.historical import StockHistoricalDataClient

            self._trading_client = TradingClient(
                api_key=self.config.api_key,
                secret_key=self.config.secret_key,
                paper=self.config.paper,
            )

            self._data_client = StockHistoricalDataClient(
                api_key=self.config.api_key,
                secret_key=self.config.secret_key,
            )
        except ImportError:
            raise ImportError("alpaca-py not installed. Run: pip install alpaca-py")

    def disconnect(self) -> None:
        """Cleanup connections."""
        self._trading_client = None
        self._data_client = None

    def get_account(self) -> dict[str, Any]:
        """Get account information."""
        if not self._trading_client:
            raise RuntimeError("Not connected. Call connect() first.")

        account = self._trading_client.get_account()
        return {
            "cash": float(account.cash),
            "buying_power": float(account.buying_power),
            "portfolio_value": float(account.portfolio_value),
            "equity": float(account.equity),
            "last_equity": float(account.last_equity),
            "status": account.status.value,
        }

    def get_positions(self) -> list[dict[str, Any]]:
        """Get current positions."""
        if not self._trading_client:
            raise RuntimeError("Not connected. Call connect() first.")

        positions = self._trading_client.get_all_positions()
        return [
            {
                "symbol": p.symbol,
                "quantity": float(p.qty),
                "avg_cost": float(p.avg_entry_price),
                "current_price": float(p.current_price),
                "market_value": float(p.market_value),
                "unrealized_pnl": float(p.unrealized_pl),
                "unrealized_pnl_pct": float(p.unrealized_plpc) * 100,
            }
            for p in positions
        ]

    def get_historical_bars(
        self,
        symbol: str,
        start: datetime,
        end: datetime | None = None,
        timeframe: str = "1Day",
    ) -> pd.DataFrame:
        """
        Get historical bar data.

        Args:
            symbol: Stock symbol
            start: Start datetime
            end: End datetime (default: now)
            timeframe: Bar timeframe ("1Min", "5Min", "1Hour", "1Day")

        Returns:
            DataFrame with OHLCV data
        """
        if not self._data_client:
            raise RuntimeError("Not connected. Call connect() first.")

        from alpaca.data.requests import StockBarsRequest
        from alpaca.data.timeframe import TimeFrame

        timeframe_map = {
            "1Min": TimeFrame.Minute,
            "5Min": TimeFrame(5, "Min"),
            "15Min": TimeFrame(15, "Min"),
            "1Hour": TimeFrame.Hour,
            "1Day": TimeFrame.Day,
        }

        tf = timeframe_map.get(timeframe, TimeFrame.Day)

        request = StockBarsRequest(
            symbol_or_symbols=symbol,
            start=start,
            end=end or datetime.now(),
            timeframe=tf,
        )

        bars = self._data_client.get_stock_bars(request)

        # Convert to DataFrame
        df = bars.df
        if isinstance(df.index, pd.MultiIndex):
            df = df.loc[symbol]

        df = df.rename(
            columns={
                "open": "open",
                "high": "high",
                "low": "low",
                "close": "close",
                "volume": "volume",
            }
        )

        df.attrs["asset_type"] = AssetType.STOCK
        return df

    def submit_order(self, order: Order) -> dict[str, Any]:
        """
        Submit an order to Alpaca.

        Args:
            order: Order to submit

        Returns:
            Order response with order ID and status
        """
        if not self._trading_client:
            raise RuntimeError("Not connected. Call connect() first.")

        from alpaca.trading.requests import MarketOrderRequest, LimitOrderRequest
        from alpaca.trading.enums import OrderSide as AlpacaSide, TimeInForce

        side = AlpacaSide.BUY if order.side == OrderSide.BUY else AlpacaSide.SELL

        if order.order_type == OrderType.MARKET:
            request = MarketOrderRequest(
                symbol=order.symbol,
                qty=order.quantity,
                side=side,
                time_in_force=TimeInForce.DAY,
            )
        else:
            request = LimitOrderRequest(
                symbol=order.symbol,
                qty=order.quantity,
                side=side,
                time_in_force=TimeInForce.DAY,
                limit_price=order.limit_price,
            )

        response = self._trading_client.submit_order(request)

        return {
            "order_id": response.id,
            "symbol": response.symbol,
            "side": response.side.value,
            "quantity": float(response.qty),
            "status": response.status.value,
            "filled_qty": float(response.filled_qty) if response.filled_qty else 0,
            "filled_avg_price": float(response.filled_avg_price)
            if response.filled_avg_price
            else None,
        }

    def bars_to_market_data(self, df: pd.DataFrame, symbol: str) -> MarketData:
        """Convert DataFrame to MarketData."""
        bars = []
        for timestamp, row in df.iterrows():
            bars.append(
                OHLCV(
                    timestamp=pd.Timestamp(timestamp).to_pydatetime(),
                    open=float(row["open"]),
                    high=float(row["high"]),
                    low=float(row["low"]),
                    close=float(row["close"]),
                    volume=float(row["volume"]),
                )
            )

        return MarketData(
            symbol=symbol,
            asset_type=AssetType.STOCK,
            bars=bars,
            current_price=bars[-1].close if bars else 0.0,
        )

    # Simulated data for backtesting (when API not available)
    @staticmethod
    def generate_sample_data(
        symbol: str = "SPY",
        days: int = 252,
        initial_price: float = 450.0,
        annual_return: float = 0.08,
        annual_volatility: float = 0.15,
    ) -> pd.DataFrame:
        """
        Generate sample stock data for backtesting.

        Uses geometric Brownian motion to simulate realistic price movements.

        Args:
            symbol: Stock symbol
            days: Number of trading days
            initial_price: Starting price
            annual_return: Expected annual return (drift)
            annual_volatility: Annual volatility

        Returns:
            DataFrame with OHLCV data
        """
        import numpy as np

        np.random.seed(42)

        # Daily parameters
        daily_return = annual_return / 252
        daily_vol = annual_volatility / np.sqrt(252)

        # Generate returns using GBM
        returns = np.random.normal(daily_return, daily_vol, days)

        # Generate prices
        prices = initial_price * np.exp(np.cumsum(returns))
        prices = np.insert(prices, 0, initial_price)[:days]

        # Generate OHLC from close prices
        timestamps = pd.date_range(start="2024-01-01", periods=days, freq="B")

        # Simulate intraday movement
        high_factors = 1 + np.abs(np.random.normal(0, daily_vol * 0.5, days))
        low_factors = 1 - np.abs(np.random.normal(0, daily_vol * 0.5, days))

        df = pd.DataFrame(
            {
                "open": prices * (1 + np.random.normal(0, daily_vol * 0.1, days)),
                "high": prices * high_factors,
                "low": prices * low_factors,
                "close": prices,
                "volume": np.random.randint(1_000_000, 100_000_000, days),
            },
            index=timestamps,
        )

        df.attrs["asset_type"] = AssetType.STOCK
        df.attrs["symbol"] = symbol
        return df
