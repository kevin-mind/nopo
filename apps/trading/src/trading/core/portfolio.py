"""Portfolio and position management."""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import numpy as np
import pandas as pd

from trading.core.types import Order, OrderSide, Trade


@dataclass
class Position:
    """A position in a single asset."""

    symbol: str
    quantity: float
    avg_cost: float
    current_price: float = 0.0
    metadata: dict[str, Any] = field(default_factory=dict)

    @property
    def market_value(self) -> float:
        """Current market value of position."""
        return self.quantity * self.current_price

    @property
    def cost_basis(self) -> float:
        """Total cost basis."""
        return self.quantity * self.avg_cost

    @property
    def unrealized_pnl(self) -> float:
        """Unrealized profit/loss."""
        return self.market_value - self.cost_basis

    @property
    def unrealized_pnl_pct(self) -> float:
        """Unrealized P&L as percentage."""
        if self.cost_basis == 0:
            return 0.0
        return (self.unrealized_pnl / self.cost_basis) * 100

    def update_price(self, price: float) -> None:
        """Update current price."""
        self.current_price = price


@dataclass
class Portfolio:
    """
    Portfolio manager for tracking positions, cash, and performance.

    Designed for steady, incremental gains with comprehensive tracking.
    """

    initial_capital: float
    cash: float = 0.0
    positions: dict[str, Position] = field(default_factory=dict)
    trades: list[Trade] = field(default_factory=list)
    equity_history: list[tuple[datetime, float]] = field(default_factory=list)

    def __post_init__(self) -> None:
        if self.cash == 0.0:
            self.cash = self.initial_capital

    @property
    def total_market_value(self) -> float:
        """Total market value of all positions."""
        return sum(p.market_value for p in self.positions.values())

    @property
    def total_equity(self) -> float:
        """Total portfolio equity (cash + positions)."""
        return self.cash + self.total_market_value

    @property
    def total_unrealized_pnl(self) -> float:
        """Total unrealized P&L across all positions."""
        return sum(p.unrealized_pnl for p in self.positions.values())

    @property
    def total_realized_pnl(self) -> float:
        """Total realized P&L from all trades."""
        pnl = 0.0
        for trade in self.trades:
            if trade.side == OrderSide.SELL:
                # Need to match with buy trades - simplified calculation
                pnl += trade.value - trade.fees
            else:
                pnl -= trade.value + trade.fees
        return pnl

    def execute_order(self, order: Order, fill_price: float, timestamp: datetime) -> Trade:
        """
        Execute an order and update portfolio.

        Args:
            order: Order to execute
            fill_price: Price at which order is filled
            timestamp: Execution timestamp

        Returns:
            The executed trade
        """
        # Calculate fees (simplified - 0.1% for stocks, higher for prediction markets)
        fee_rate = 0.001  # 0.1%
        fees = order.quantity * fill_price * fee_rate

        trade = Trade(
            timestamp=timestamp,
            symbol=order.symbol,
            side=order.side,
            quantity=order.quantity,
            price=fill_price,
            fees=fees,
            metadata=order.metadata,
        )

        self.trades.append(trade)
        self._update_position(trade)
        self._update_cash(trade)

        return trade

    def _update_position(self, trade: Trade) -> None:
        """Update position based on trade."""
        symbol = trade.symbol

        if symbol not in self.positions:
            if trade.side == OrderSide.BUY:
                self.positions[symbol] = Position(
                    symbol=symbol,
                    quantity=trade.quantity,
                    avg_cost=trade.price,
                    current_price=trade.price,
                )
            return

        position = self.positions[symbol]

        if trade.side == OrderSide.BUY:
            # Update average cost
            total_cost = position.cost_basis + trade.value
            total_qty = position.quantity + trade.quantity
            position.avg_cost = total_cost / total_qty if total_qty > 0 else 0
            position.quantity = total_qty
        else:  # SELL
            position.quantity -= trade.quantity

        position.current_price = trade.price

        # Remove position if fully closed
        if position.quantity <= 0:
            del self.positions[symbol]

    def _update_cash(self, trade: Trade) -> None:
        """Update cash balance based on trade."""
        if trade.side == OrderSide.BUY:
            self.cash -= trade.value + trade.fees
        else:
            self.cash += trade.value - trade.fees

    def update_prices(self, prices: dict[str, float]) -> None:
        """Update current prices for all positions."""
        for symbol, price in prices.items():
            if symbol in self.positions:
                self.positions[symbol].update_price(price)

    def record_equity(self, timestamp: datetime) -> None:
        """Record current equity for tracking."""
        self.equity_history.append((timestamp, self.total_equity))

    def get_returns(self) -> np.ndarray:
        """Calculate daily returns from equity history."""
        if len(self.equity_history) < 2:
            return np.array([])

        equities = np.array([eq for _, eq in self.equity_history])
        returns = np.diff(equities) / equities[:-1]
        return returns

    def get_metrics(self) -> dict:
        """Calculate comprehensive portfolio metrics."""
        returns = self.get_returns()

        if len(returns) == 0:
            return {
                "total_return_pct": 0.0,
                "sharpe_ratio": 0.0,
                "sortino_ratio": 0.0,
                "max_drawdown_pct": 0.0,
                "win_rate": 0.0,
                "profit_factor": 0.0,
                "avg_trade_pnl": 0.0,
                "num_trades": 0,
            }

        # Total return
        total_return = (self.total_equity - self.initial_capital) / self.initial_capital

        # Sharpe ratio (assuming 0 risk-free rate)
        sharpe = 0.0
        if len(returns) > 1 and np.std(returns) > 0:
            sharpe = np.mean(returns) / np.std(returns) * np.sqrt(252)

        # Sortino ratio (downside deviation)
        sortino = 0.0
        downside_returns = returns[returns < 0]
        if len(downside_returns) > 0 and np.std(downside_returns) > 0:
            sortino = np.mean(returns) / np.std(downside_returns) * np.sqrt(252)

        # Max drawdown
        equities = np.array([eq for _, eq in self.equity_history])
        peak = np.maximum.accumulate(equities)
        drawdown = (peak - equities) / peak
        max_drawdown = np.max(drawdown) if len(drawdown) > 0 else 0.0

        # Trade statistics
        winning_trades = [t for t in self.trades if t.side == OrderSide.SELL and t.value > 0]
        losing_trades = [t for t in self.trades if t.side == OrderSide.SELL and t.value <= 0]

        win_rate = len(winning_trades) / len(self.trades) if self.trades else 0.0

        gross_profit = sum(t.value for t in winning_trades)
        gross_loss = abs(sum(t.value for t in losing_trades))
        profit_factor = gross_profit / gross_loss if gross_loss > 0 else float("inf")

        avg_trade_pnl = total_return * self.initial_capital / len(self.trades) if self.trades else 0

        return {
            "total_return_pct": total_return * 100,
            "sharpe_ratio": sharpe,
            "sortino_ratio": sortino,
            "max_drawdown_pct": max_drawdown * 100,
            "win_rate": win_rate * 100,
            "profit_factor": profit_factor,
            "avg_trade_pnl": avg_trade_pnl,
            "num_trades": len(self.trades),
        }

    def to_dataframe(self) -> pd.DataFrame:
        """Convert equity history to pandas DataFrame."""
        return pd.DataFrame(self.equity_history, columns=["timestamp", "equity"]).set_index(
            "timestamp"
        )
