"""Tests for backtesting engine."""

from datetime import datetime

import numpy as np
import pandas as pd
import pytest

from trading.core.backtest import Backtest, BacktestResult
from trading.core.strategy import Signal, SignalType, Strategy
from trading.core.types import MarketData


class AlwaysBuyStrategy(Strategy):
    """Test strategy that always buys."""

    name = "AlwaysBuy"

    def generate_signal(self, data: MarketData | pd.DataFrame, timestamp: datetime) -> Signal:
        if isinstance(data, MarketData):
            symbol = data.symbol
        else:
            symbol = "TEST"
        return Signal(SignalType.LONG, symbol, strength=1.0, confidence=1.0)


class AlwaysHoldStrategy(Strategy):
    """Test strategy that never trades."""

    name = "AlwaysHold"

    def generate_signal(self, data: MarketData | pd.DataFrame, timestamp: datetime) -> Signal:
        return Signal(SignalType.HOLD, "TEST")


class TestBacktest:
    """Tests for backtesting engine."""

    def _create_sample_data(self, n_days: int = 100, trend: float = 0.0005) -> pd.DataFrame:
        """Create sample price data."""
        np.random.seed(42)
        dates = pd.date_range(start="2024-01-01", periods=n_days, freq="B")
        returns = np.random.normal(trend, 0.01, n_days)
        prices = 100 * np.exp(np.cumsum(returns))

        return pd.DataFrame(
            {
                "open": prices * 0.999,
                "high": prices * 1.01,
                "low": prices * 0.99,
                "close": prices,
                "volume": np.random.randint(1000, 10000, n_days),
            },
            index=dates,
        )

    def test_backtest_runs(self):
        """Test basic backtest execution."""
        data = self._create_sample_data()
        strategy = AlwaysBuyStrategy()
        backtest = Backtest(strategy=strategy, initial_capital=10000)

        result = backtest.run(data, symbol="TEST")

        assert isinstance(result, BacktestResult)
        assert result.initial_capital == 10000
        assert result.final_equity > 0

    def test_backtest_hold_strategy_no_trades(self):
        """Test that hold strategy makes no trades."""
        data = self._create_sample_data()
        strategy = AlwaysHoldStrategy()
        backtest = Backtest(strategy=strategy, initial_capital=10000)

        result = backtest.run(data, symbol="TEST")

        assert len(result.trades) == 0
        assert result.final_equity == 10000  # No change

    def test_backtest_equity_curve(self):
        """Test equity curve is properly recorded."""
        data = self._create_sample_data(n_days=50)
        strategy = AlwaysHoldStrategy()  # Use hold strategy to avoid commission effects
        backtest = Backtest(strategy=strategy, initial_capital=10000)

        result = backtest.run(data, symbol="TEST")

        assert len(result.equity_curve) == 50
        # First equity should be initial capital (no trades yet)
        assert abs(result.equity_curve["equity"].iloc[0] - 10000) < 1  # Allow small precision diff

    def test_backtest_metrics_calculated(self):
        """Test that metrics are calculated."""
        data = self._create_sample_data()
        strategy = AlwaysBuyStrategy()
        backtest = Backtest(strategy=strategy, initial_capital=10000)

        result = backtest.run(data, symbol="TEST")

        assert "total_return_pct" in result.metrics
        assert "sharpe_ratio" in result.metrics
        assert "max_drawdown_pct" in result.metrics

    def test_backtest_summary(self):
        """Test summary generation."""
        data = self._create_sample_data()
        strategy = AlwaysBuyStrategy()
        backtest = Backtest(strategy=strategy, initial_capital=10000)

        result = backtest.run(data, symbol="TEST")
        summary = result.summary()

        assert "Backtest Results" in summary
        assert "Total Return" in summary
        assert "Sharpe Ratio" in summary

    def test_vectorized_backtest(self):
        """Test vectorized backtest mode."""
        data = self._create_sample_data(trend=0.002)  # Use uptrend for clearer result
        strategy = AlwaysBuyStrategy()
        backtest = Backtest(strategy=strategy, initial_capital=10000)

        # Simple signal function: always long
        def signal_func(df: pd.DataFrame) -> pd.Series:
            return pd.Series(1, index=df.index)

        result = backtest.run_vectorized(data, signal_func, symbol="TEST")

        assert isinstance(result, BacktestResult)
        # With commission and always-long, equity should change
        assert result.final_equity > 0

    def test_backtest_with_uptrend(self):
        """Test backtest in uptrending market."""
        data = self._create_sample_data(trend=0.002)  # Strong uptrend
        strategy = AlwaysBuyStrategy()
        backtest = Backtest(strategy=strategy, initial_capital=10000)

        result = backtest.run(data, symbol="TEST")

        # Should be profitable in uptrend
        assert result.total_return_pct > 0

    def test_backtest_with_downtrend(self):
        """Test backtest in downtrending market."""
        data = self._create_sample_data(trend=-0.002)  # Strong downtrend
        strategy = AlwaysBuyStrategy()
        backtest = Backtest(strategy=strategy, initial_capital=10000)

        result = backtest.run(data, symbol="TEST")

        # Buying in downtrend should lose money
        assert result.total_return_pct < 0


class TestBacktestResult:
    """Tests for BacktestResult."""

    def test_result_properties(self):
        """Test result property accessors."""
        result = BacktestResult(
            strategy_name="Test",
            start_date=datetime(2024, 1, 1),
            end_date=datetime(2024, 12, 31),
            initial_capital=10000,
            final_equity=11000,
            metrics={
                "total_return_pct": 10.0,
                "sharpe_ratio": 1.5,
                "max_drawdown_pct": 5.0,
            },
            equity_curve=pd.DataFrame(),
            trades=[],
            signals=[],
        )

        assert result.total_return_pct == 10.0
        assert result.sharpe_ratio == 1.5
        assert result.max_drawdown_pct == 5.0
