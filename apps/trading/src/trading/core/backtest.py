"""Vectorized backtesting engine."""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Callable

import numpy as np
import pandas as pd

from trading.core.portfolio import Portfolio
from trading.core.risk import RiskManager
from trading.core.strategy import Signal, SignalType, Strategy
from trading.core.types import MarketData, OHLCV, Order, OrderSide


@dataclass
class BacktestResult:
    """Results from a backtest run."""

    strategy_name: str
    start_date: datetime
    end_date: datetime
    initial_capital: float
    final_equity: float
    metrics: dict[str, float]
    equity_curve: pd.DataFrame
    trades: list[dict[str, Any]]
    signals: list[tuple[datetime, Signal]]

    @property
    def total_return_pct(self) -> float:
        """Total return percentage."""
        return self.metrics.get("total_return_pct", 0.0)

    @property
    def sharpe_ratio(self) -> float:
        """Sharpe ratio."""
        return self.metrics.get("sharpe_ratio", 0.0)

    @property
    def max_drawdown_pct(self) -> float:
        """Maximum drawdown percentage."""
        return self.metrics.get("max_drawdown_pct", 0.0)

    def summary(self) -> str:
        """Generate a summary string."""
        return f"""
Backtest Results: {self.strategy_name}
{'=' * 50}
Period: {self.start_date.date()} to {self.end_date.date()}
Initial Capital: ${self.initial_capital:,.2f}
Final Equity: ${self.final_equity:,.2f}

Performance Metrics:
  Total Return: {self.total_return_pct:.2f}%
  Sharpe Ratio: {self.sharpe_ratio:.2f}
  Sortino Ratio: {self.metrics.get('sortino_ratio', 0):.2f}
  Max Drawdown: {self.max_drawdown_pct:.2f}%

Trade Statistics:
  Total Trades: {self.metrics.get('num_trades', 0)}
  Win Rate: {self.metrics.get('win_rate', 0):.1f}%
  Profit Factor: {self.metrics.get('profit_factor', 0):.2f}
  Avg Trade P&L: ${self.metrics.get('avg_trade_pnl', 0):.2f}
"""


@dataclass
class Backtest:
    """
    Vectorized backtesting engine optimized for speed.

    Supports both event-driven and vectorized backtesting modes.
    Integrates with RiskManager for position sizing and risk controls.
    """

    strategy: Strategy
    initial_capital: float = 10000.0
    risk_manager: RiskManager = field(default_factory=RiskManager)
    commission_rate: float = 0.001  # 0.1% default commission

    # Internal state
    _portfolio: Portfolio | None = None

    def run(
        self,
        data: pd.DataFrame,
        symbol: str = "ASSET",
        price_col: str = "close",
    ) -> BacktestResult:
        """
        Run backtest on historical data.

        Args:
            data: DataFrame with OHLCV data (must have DatetimeIndex)
            symbol: Symbol being traded
            price_col: Column name for prices

        Returns:
            BacktestResult with performance metrics
        """
        if not isinstance(data.index, pd.DatetimeIndex):
            raise ValueError("Data must have DatetimeIndex")

        # Initialize portfolio
        self._portfolio = Portfolio(initial_capital=self.initial_capital)
        self.risk_manager.peak_equity = self.initial_capital

        # Track statistics for position sizing
        wins: list[float] = []
        losses: list[float] = []

        for i, (timestamp, row) in enumerate(data.iterrows()):
            timestamp = pd.Timestamp(timestamp).to_pydatetime()
            current_price = float(row[price_col])

            # Update position prices
            self._portfolio.update_prices({symbol: current_price})

            # Create market data for strategy
            historical_bars = self._create_bars(data.iloc[: i + 1])
            market_data = MarketData(
                symbol=symbol,
                asset_type=data.attrs.get("asset_type", "stock"),
                bars=historical_bars,
                current_price=current_price,
            )

            # Check if we can trade (risk limits)
            if not self.risk_manager.can_trade(self._portfolio.total_equity):
                self._portfolio.record_equity(timestamp)
                continue

            # Generate signal
            signal = self.strategy.generate_signal(market_data, timestamp)
            self.strategy.record_signal(timestamp, signal)

            # Calculate position size
            position_size = self._calculate_position_size(
                signal, current_price, wins, losses
            )

            if position_size > 0 and signal.signal_type != SignalType.HOLD:
                # Create and execute order
                order = signal.to_order(position_size)
                if order is not None:
                    trade = self._portfolio.execute_order(order, current_price, timestamp)

                    # Track win/loss for future position sizing
                    if trade.side == OrderSide.SELL and symbol in self._portfolio.positions:
                        pnl = trade.value - self._portfolio.positions[symbol].cost_basis
                        if pnl > 0:
                            wins.append(pnl)
                        else:
                            losses.append(abs(pnl))

            # Record equity
            self._portfolio.record_equity(timestamp)

            # Update risk manager state
            self.risk_manager.update_state(
                current_equity=self._portfolio.total_equity,
                daily_pnl=0.0,  # Simplified - would need daily tracking
                open_positions=len(self._portfolio.positions),
            )

        # Calculate final metrics
        metrics = self._portfolio.get_metrics()

        return BacktestResult(
            strategy_name=self.strategy.name,
            start_date=data.index[0].to_pydatetime(),
            end_date=data.index[-1].to_pydatetime(),
            initial_capital=self.initial_capital,
            final_equity=self._portfolio.total_equity,
            metrics=metrics,
            equity_curve=self._portfolio.to_dataframe(),
            trades=[self._trade_to_dict(t) for t in self._portfolio.trades],
            signals=self.strategy.get_signal_history(),
        )

    def run_vectorized(
        self,
        data: pd.DataFrame,
        signal_func: Callable[[pd.DataFrame], pd.Series],
        symbol: str = "ASSET",
        price_col: str = "close",
    ) -> BacktestResult:
        """
        Run vectorized backtest for maximum speed.

        This mode is faster but less accurate (no proper fill simulation).

        Args:
            data: DataFrame with OHLCV data
            signal_func: Function that takes DataFrame and returns signals Series
            symbol: Symbol being traded
            price_col: Column name for prices

        Returns:
            BacktestResult with performance metrics
        """
        if not isinstance(data.index, pd.DatetimeIndex):
            raise ValueError("Data must have DatetimeIndex")

        # Generate all signals at once
        signals = signal_func(data)

        # Calculate returns
        prices = data[price_col].values
        returns = np.diff(prices) / prices[:-1]

        # Position: 1 for long, 0 for flat
        positions = np.where(signals.values[:-1] == 1, 1, 0)

        # Strategy returns
        strategy_returns = positions * returns

        # Apply commission on position changes
        # position_changes tracks when we enter/exit positions
        position_changes = np.abs(np.diff(np.concatenate([[0], positions, [0]])))
        # Slice to match returns length, commission applies on entry at each bar
        commission_costs = position_changes[:len(returns)] * self.commission_rate
        strategy_returns -= commission_costs

        # Build equity curve
        equity = self.initial_capital * np.cumprod(1 + strategy_returns)
        equity = np.concatenate([[self.initial_capital], equity])

        # Create equity DataFrame
        equity_df = pd.DataFrame(
            {"equity": equity},
            index=data.index,
        )

        # Calculate metrics
        metrics = self._calculate_vectorized_metrics(strategy_returns, equity)

        return BacktestResult(
            strategy_name=f"{self.strategy.name}_vectorized",
            start_date=data.index[0].to_pydatetime(),
            end_date=data.index[-1].to_pydatetime(),
            initial_capital=self.initial_capital,
            final_equity=float(equity[-1]),
            metrics=metrics,
            equity_curve=equity_df,
            trades=[],  # No individual trades in vectorized mode
            signals=[],
        )

    def _create_bars(self, data: pd.DataFrame) -> list[OHLCV]:
        """Create OHLCV bars from DataFrame."""
        bars = []
        for timestamp, row in data.iterrows():
            bars.append(
                OHLCV(
                    timestamp=pd.Timestamp(timestamp).to_pydatetime(),
                    open=float(row.get("open", row.get("close", 0))),
                    high=float(row.get("high", row.get("close", 0))),
                    low=float(row.get("low", row.get("close", 0))),
                    close=float(row.get("close", 0)),
                    volume=float(row.get("volume", 0)),
                )
            )
        return bars

    def _calculate_position_size(
        self,
        signal: Signal,
        price: float,
        wins: list[float],
        losses: list[float],
    ) -> float:
        """Calculate position size based on Kelly criterion and risk management."""
        if signal.signal_type == SignalType.HOLD:
            return 0.0

        # Need minimum history for Kelly
        if len(wins) + len(losses) < 10:
            # Use fixed fraction initially
            return (self._portfolio.cash * 0.02) / price

        win_rate = len(wins) / (len(wins) + len(losses))
        avg_win = np.mean(wins) if wins else 0.0
        avg_loss = np.mean(losses) if losses else 1.0

        # Get risk-adjusted size from risk manager
        position_value = self.risk_manager.calculate_position_size(
            win_rate=win_rate,
            avg_win=avg_win,
            avg_loss=avg_loss,
            capital=self._portfolio.cash,
        )

        # Adjust by signal strength/confidence
        position_value *= signal.strength * signal.confidence

        # Convert to shares
        return position_value / price

    def _calculate_vectorized_metrics(
        self,
        returns: np.ndarray,
        equity: np.ndarray,
    ) -> dict[str, float]:
        """Calculate metrics from vectorized backtest."""
        # Total return
        total_return = (equity[-1] - equity[0]) / equity[0]

        # Sharpe ratio
        sharpe = 0.0
        if len(returns) > 1 and np.std(returns) > 0:
            sharpe = np.mean(returns) / np.std(returns) * np.sqrt(252)

        # Sortino ratio
        sortino = 0.0
        downside = returns[returns < 0]
        if len(downside) > 0 and np.std(downside) > 0:
            sortino = np.mean(returns) / np.std(downside) * np.sqrt(252)

        # Max drawdown
        peak = np.maximum.accumulate(equity)
        drawdown = (peak - equity) / peak
        max_dd = np.max(drawdown)

        # Win rate (positive return days)
        win_rate = np.sum(returns > 0) / len(returns) if len(returns) > 0 else 0

        return {
            "total_return_pct": total_return * 100,
            "sharpe_ratio": float(sharpe),
            "sortino_ratio": float(sortino),
            "max_drawdown_pct": float(max_dd * 100),
            "win_rate": float(win_rate * 100),
            "profit_factor": 0.0,  # Not applicable in vectorized mode
            "avg_trade_pnl": 0.0,
            "num_trades": 0,
        }

    def _trade_to_dict(self, trade: Any) -> dict[str, Any]:
        """Convert trade to dictionary for serialization."""
        return {
            "timestamp": trade.timestamp.isoformat(),
            "symbol": trade.symbol,
            "side": trade.side.value,
            "quantity": trade.quantity,
            "price": trade.price,
            "fees": trade.fees,
            "value": trade.value,
        }
