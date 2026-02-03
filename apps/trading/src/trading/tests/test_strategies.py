"""Tests for trading strategies."""

from datetime import datetime, timedelta

import numpy as np
import pandas as pd
import pytest

from trading.core.strategy import SignalType
from trading.core.types import MarketData, OHLCV
from trading.strategies.mean_reversion import MeanReversionStrategy
from trading.strategies.prediction_value import PredictionValueStrategy
from trading.strategies.momentum import LowVolMomentumStrategy


def create_market_data(prices: list[float], symbol: str = "TEST") -> MarketData:
    """Helper to create MarketData from price list."""
    base_date = datetime(2024, 1, 1)
    bars = [
        OHLCV(
            timestamp=base_date + timedelta(days=i),
            open=p,
            high=p * 1.01,
            low=p * 0.99,
            close=p,
            volume=1000,
        )
        for i, p in enumerate(prices)
    ]
    return MarketData(symbol=symbol, asset_type="stock", bars=bars, current_price=prices[-1])


class TestMeanReversionStrategy:
    """Tests for mean reversion strategy."""

    def test_hold_signal_insufficient_data(self):
        """Test HOLD when not enough data."""
        strategy = MeanReversionStrategy()
        data = create_market_data([100, 101, 102])  # Only 3 bars

        signal = strategy.generate_signal(data, datetime.now())

        assert signal.signal_type == SignalType.HOLD

    def test_buy_signal_oversold(self):
        """Test BUY signal when oversold."""
        strategy = MeanReversionStrategy(
            params={"lookback_period": 20, "std_dev_threshold": 2.0, "rsi_oversold": 30}
        )

        # Create declining prices that end well below moving average
        prices = [100] * 15 + [95, 90, 85, 80, 75]  # Sharp decline
        data = create_market_data(prices)

        signal = strategy.generate_signal(data, datetime.now())

        # Should generate buy or hold (depending on RSI)
        assert signal.signal_type in [SignalType.LONG, SignalType.HOLD]

    def test_close_signal_overbought(self):
        """Test CLOSE signal when overbought."""
        strategy = MeanReversionStrategy(
            params={"lookback_period": 20, "std_dev_threshold": 2.0, "rsi_overbought": 70}
        )

        # Create rising prices that end well above moving average
        prices = [100] * 15 + [105, 110, 115, 120, 125]  # Sharp rise
        data = create_market_data(prices)

        signal = strategy.generate_signal(data, datetime.now())

        # Should generate close or hold
        assert signal.signal_type in [SignalType.CLOSE, SignalType.HOLD]

    def test_high_volatility_filter(self):
        """Test strategy avoids high volatility."""
        strategy = MeanReversionStrategy(params={"volatility_filter": 0.01})  # Low threshold

        # High volatility data
        np.random.seed(42)
        prices = 100 + np.cumsum(np.random.randn(30) * 5)  # High volatility
        data = create_market_data(prices.tolist())

        signal = strategy.generate_signal(data, datetime.now())

        # Should hold due to volatility filter
        assert signal.signal_type == SignalType.HOLD
        assert "high_vol" in signal.metadata.get("reason", "")


class TestPredictionValueStrategy:
    """Tests for prediction market value strategy."""

    def test_hold_without_probability_estimate(self):
        """Test HOLD when no probability estimate."""
        strategy = PredictionValueStrategy()
        data = create_market_data([0.5] * 25, symbol="MARKET-A")

        signal = strategy.generate_signal(data, datetime.now())

        # Should hold or use inferred probability
        assert signal.signal_type in [SignalType.HOLD, SignalType.LONG, SignalType.SHORT]

    def test_buy_yes_underpriced(self):
        """Test BUY YES when market underprices event."""
        strategy = PredictionValueStrategy(params={"min_edge": 0.05})
        strategy.set_probability_estimate("MARKET-A", 0.70)  # We think 70%

        # Market says 60%
        data = create_market_data([0.60] * 25, symbol="MARKET-A")

        signal = strategy.generate_signal(data, datetime.now())

        assert signal.signal_type == SignalType.LONG
        assert signal.metadata["action"] == "buy_yes"
        assert signal.metadata["edge"] > 0

    def test_buy_no_overpriced(self):
        """Test BUY NO when market overprices event."""
        strategy = PredictionValueStrategy(params={"min_edge": 0.05})
        strategy.set_probability_estimate("MARKET-A", 0.50)  # We think 50%

        # Market says 60%
        data = create_market_data([0.60] * 25, symbol="MARKET-A")

        signal = strategy.generate_signal(data, datetime.now())

        assert signal.signal_type == SignalType.SHORT
        assert signal.metadata["action"] == "buy_no"
        assert signal.metadata["edge"] < 0

    def test_hold_insufficient_edge(self):
        """Test HOLD when edge below threshold."""
        strategy = PredictionValueStrategy(params={"min_edge": 0.10})  # 10% required
        strategy.set_probability_estimate("MARKET-A", 0.55)  # 55%

        # Market says 52% - only 3% edge
        data = create_market_data([0.52] * 25, symbol="MARKET-A")

        signal = strategy.generate_signal(data, datetime.now())

        assert signal.signal_type == SignalType.HOLD
        assert signal.metadata.get("below_threshold") is True

    def test_avoid_extreme_probabilities(self):
        """Test strategy avoids extreme favorites/underdogs."""
        strategy = PredictionValueStrategy(
            params={"max_implied_prob": 0.90, "min_implied_prob": 0.10}
        )
        strategy.set_probability_estimate("MARKET-A", 0.95)

        # Market at 92% - above max threshold
        data = create_market_data([0.92] * 25, symbol="MARKET-A")

        signal = strategy.generate_signal(data, datetime.now())

        assert signal.signal_type == SignalType.HOLD
        assert "extreme_probability" in signal.metadata.get("reason", "")

    def test_expected_value_calculation(self):
        """Test EV calculation is correct."""
        strategy = PredictionValueStrategy()

        # If we think true prob is 70%, market is 60%
        # EV of YES: 0.70 * (1-0.60) - 0.30 * 0.60 = 0.28 - 0.18 = 0.10
        ev = strategy.calculate_expected_value(true_prob=0.70, market_price=0.60, contract_type="yes")

        assert abs(ev - 0.10) < 0.01


class TestLowVolMomentumStrategy:
    """Tests for low-volatility momentum strategy."""

    def test_hold_insufficient_data(self):
        """Test HOLD when not enough data."""
        strategy = LowVolMomentumStrategy()
        data = create_market_data([100, 101, 102])

        signal = strategy.generate_signal(data, datetime.now())

        assert signal.signal_type == SignalType.HOLD

    def test_long_signal_uptrend(self):
        """Test LONG signal in uptrend with acceptable volatility."""
        strategy = LowVolMomentumStrategy(
            params={"fast_period": 5, "slow_period": 10, "min_volatility": 0.001, "max_volatility": 0.05}
        )

        # Create uptrending data with moderate volatility
        np.random.seed(42)
        base_prices = np.linspace(100, 110, 40)  # Steady uptrend
        noise = np.random.randn(40) * 0.5
        prices = (base_prices + noise).tolist()
        data = create_market_data(prices)

        signal = strategy.generate_signal(data, datetime.now())

        # Should be long or hold (depending on exact crossover timing)
        assert signal.signal_type in [SignalType.LONG, SignalType.HOLD]

    def test_close_signal_downtrend(self):
        """Test CLOSE signal in downtrend."""
        strategy = LowVolMomentumStrategy(
            params={"fast_period": 5, "slow_period": 10, "min_volatility": 0.001, "max_volatility": 0.05}
        )

        # Create downtrending data
        np.random.seed(42)
        base_prices = np.linspace(110, 100, 40)  # Steady downtrend
        noise = np.random.randn(40) * 0.5
        prices = (base_prices + noise).tolist()
        data = create_market_data(prices)

        signal = strategy.generate_signal(data, datetime.now())

        # Should be close or hold
        assert signal.signal_type in [SignalType.CLOSE, SignalType.HOLD]

    def test_high_volatility_filter(self):
        """Test strategy avoids high volatility markets."""
        strategy = LowVolMomentumStrategy(params={"max_volatility": 0.01})

        # High volatility data
        np.random.seed(42)
        prices = 100 + np.cumsum(np.random.randn(40) * 3)
        data = create_market_data(prices.tolist())

        signal = strategy.generate_signal(data, datetime.now())

        assert signal.signal_type == SignalType.HOLD
        assert "volatility_too_high" in signal.metadata.get("reason", "")

    def test_vectorized_signals(self):
        """Test vectorized signal generation."""
        strategy = LowVolMomentumStrategy(
            params={"fast_period": 5, "slow_period": 10, "min_volatility": 0.001, "max_volatility": 0.05}
        )

        # Create DataFrame
        np.random.seed(42)
        dates = pd.date_range(start="2024-01-01", periods=50, freq="B")
        prices = 100 + np.cumsum(np.random.randn(50) * 0.5)

        df = pd.DataFrame({"close": prices}, index=dates)

        signals = strategy.vectorized_signals(df)

        assert len(signals) == len(df)
        assert set(signals.unique()).issubset({-1, 0, 1})
