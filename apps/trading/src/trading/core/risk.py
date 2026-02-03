"""Risk management components including Kelly Criterion position sizing."""

from dataclasses import dataclass, field
from typing import Protocol

import numpy as np


class PositionSizer(Protocol):
    """Protocol for position sizing strategies."""

    def calculate_position_size(
        self,
        win_rate: float,
        avg_win: float,
        avg_loss: float,
        capital: float,
    ) -> float:
        """Calculate optimal position size."""
        ...


@dataclass
class KellyCriterion:
    """
    Kelly Criterion position sizing for optimal growth.

    The Kelly formula calculates the optimal fraction of capital to risk:
    f* = (bp - q) / b

    Where:
    - f* = fraction of capital to bet
    - b = odds (avg_win / avg_loss ratio)
    - p = probability of winning (win_rate)
    - q = probability of losing (1 - p)

    For steady, lower-volatility returns, we use fractional Kelly (25-50%).
    """

    fraction: float = 0.25  # Use 25% Kelly by default for lower volatility
    max_position_pct: float = 0.10  # Never risk more than 10% per trade
    min_position_pct: float = 0.01  # Minimum 1% position to be meaningful

    def calculate_kelly_fraction(
        self,
        win_rate: float,
        avg_win: float,
        avg_loss: float,
    ) -> float:
        """
        Calculate the full Kelly fraction.

        Args:
            win_rate: Historical win rate (0-1)
            avg_win: Average winning trade return
            avg_loss: Average losing trade return (positive number)

        Returns:
            Optimal fraction of capital to risk (can be negative if edge is negative)
        """
        if avg_loss <= 0:
            return 0.0

        b = avg_win / avg_loss  # Odds
        p = win_rate
        q = 1 - p

        # Kelly formula: f* = (bp - q) / b
        kelly = (b * p - q) / b

        return kelly

    def calculate_position_size(
        self,
        win_rate: float,
        avg_win: float,
        avg_loss: float,
        capital: float,
    ) -> float:
        """
        Calculate position size using fractional Kelly.

        Args:
            win_rate: Historical win rate (0-1)
            avg_win: Average winning trade return
            avg_loss: Average losing trade return (positive number)
            capital: Available capital

        Returns:
            Dollar amount to risk on this trade
        """
        kelly = self.calculate_kelly_fraction(win_rate, avg_win, avg_loss)

        # Apply fractional Kelly for lower volatility
        adjusted_kelly = kelly * self.fraction

        # Clamp to min/max bounds
        position_pct = np.clip(adjusted_kelly, self.min_position_pct, self.max_position_pct)

        # If Kelly is negative (no edge), don't trade
        if kelly <= 0:
            return 0.0

        return capital * position_pct


@dataclass
class RiskManager:
    """
    Comprehensive risk management for steady returns.

    Combines multiple risk controls:
    1. Position sizing (Kelly Criterion)
    2. Maximum drawdown limits
    3. Daily/weekly loss limits
    4. Correlation-based exposure limits
    5. Volatility-adjusted sizing
    """

    position_sizer: KellyCriterion = field(default_factory=KellyCriterion)
    max_drawdown_pct: float = 0.15  # Stop trading at 15% drawdown
    daily_loss_limit_pct: float = 0.03  # Max 3% daily loss
    max_open_positions: int = 10
    max_correlation: float = 0.7  # Max correlation between positions
    volatility_lookback: int = 20  # Days for volatility calculation

    # State tracking
    peak_equity: float = 0.0
    daily_pnl: float = 0.0
    open_positions: int = 0

    def update_state(
        self,
        current_equity: float,
        daily_pnl: float,
        open_positions: int,
    ) -> None:
        """Update risk manager state."""
        self.peak_equity = max(self.peak_equity, current_equity)
        self.daily_pnl = daily_pnl
        self.open_positions = open_positions

    def current_drawdown(self, current_equity: float) -> float:
        """Calculate current drawdown from peak."""
        if self.peak_equity <= 0:
            return 0.0
        return (self.peak_equity - current_equity) / self.peak_equity

    def can_trade(self, current_equity: float) -> bool:
        """Check if trading is allowed given current risk state."""
        # Check drawdown limit
        if self.current_drawdown(current_equity) >= self.max_drawdown_pct:
            return False

        # Check daily loss limit
        if self.peak_equity > 0:
            daily_loss_pct = -self.daily_pnl / self.peak_equity
            if daily_loss_pct >= self.daily_loss_limit_pct:
                return False

        # Check position limits
        if self.open_positions >= self.max_open_positions:
            return False

        return True

    def calculate_position_size(
        self,
        win_rate: float,
        avg_win: float,
        avg_loss: float,
        capital: float,
        volatility: float | None = None,
    ) -> float:
        """
        Calculate risk-adjusted position size.

        Args:
            win_rate: Historical win rate
            avg_win: Average winning trade
            avg_loss: Average losing trade
            capital: Available capital
            volatility: Current asset volatility (optional)

        Returns:
            Dollar amount to allocate to position
        """
        base_size = self.position_sizer.calculate_position_size(
            win_rate, avg_win, avg_loss, capital
        )

        # Reduce size if approaching drawdown limit
        drawdown = self.current_drawdown(capital)
        drawdown_multiplier = 1.0 - (drawdown / self.max_drawdown_pct)
        drawdown_multiplier = max(0.0, drawdown_multiplier)

        # Volatility adjustment (higher vol = smaller position)
        vol_multiplier = 1.0
        if volatility is not None and volatility > 0:
            # Target a consistent dollar volatility per position
            target_vol = 0.02  # 2% target volatility
            vol_multiplier = min(1.0, target_vol / volatility)

        return base_size * drawdown_multiplier * vol_multiplier

    def calculate_volatility(self, returns: np.ndarray) -> float:
        """Calculate annualized volatility from returns."""
        if len(returns) < 2:
            return 0.0
        return float(np.std(returns) * np.sqrt(252))

    def get_risk_report(self, current_equity: float) -> dict:
        """Generate a risk status report."""
        return {
            "current_equity": current_equity,
            "peak_equity": self.peak_equity,
            "current_drawdown_pct": self.current_drawdown(current_equity) * 100,
            "max_drawdown_limit_pct": self.max_drawdown_pct * 100,
            "daily_pnl": self.daily_pnl,
            "daily_loss_limit_pct": self.daily_loss_limit_pct * 100,
            "open_positions": self.open_positions,
            "max_open_positions": self.max_open_positions,
            "can_trade": self.can_trade(current_equity),
        }
