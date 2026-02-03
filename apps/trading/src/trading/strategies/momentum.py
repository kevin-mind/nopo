"""Low-volatility momentum strategy for steady gains."""

from dataclasses import dataclass
from datetime import datetime
from typing import Any

import numpy as np
import pandas as pd

from trading.core.strategy import Signal, SignalType, Strategy
from trading.core.types import MarketData


@dataclass
class LowVolMomentumStrategy(Strategy):
    """
    Low-Volatility Momentum Strategy for steady, incremental gains.

    Philosophy:
    - Combine momentum (trend following) with volatility filter
    - Only trade when volatility is in a favorable range
    - Ride trends but with tight risk management
    - Avoid choppy, high-volatility markets

    Key Features:
    - Dual moving average crossover for trend identification
    - Volatility filter to avoid whipsaws
    - Trend strength confirmation via ADX-like measure
    - Gradual position building (not all-in)

    Risk Management:
    - Position size inversely proportional to volatility
    - Trailing stops to lock in gains
    - Exit on volatility expansion

    Best suited for:
    - ETFs and large-cap stocks
    - Crypto in trending phases
    - Markets with clear directional moves
    """

    name: str = "LowVolMomentum"

    # Parameters
    fast_period: int = 10
    slow_period: int = 30
    volatility_lookback: int = 20
    min_volatility: float = 0.005  # Too low = no opportunity
    max_volatility: float = 0.025  # Too high = too risky
    trend_strength_threshold: float = 0.02  # Min difference between MAs

    def __init__(self, params: dict[str, Any] | None = None):
        super().__init__(params)
        if params:
            self.fast_period = params.get("fast_period", self.fast_period)
            self.slow_period = params.get("slow_period", self.slow_period)
            self.volatility_lookback = params.get("volatility_lookback", self.volatility_lookback)
            self.min_volatility = params.get("min_volatility", self.min_volatility)
            self.max_volatility = params.get("max_volatility", self.max_volatility)

    def generate_signal(
        self,
        data: MarketData | pd.DataFrame,
        timestamp: datetime,
    ) -> Signal:
        """Generate low-volatility momentum signal."""
        # Convert to price array
        if isinstance(data, MarketData):
            if len(data.bars) < self.slow_period:
                return Signal(SignalType.HOLD, data.symbol)
            prices = np.array([bar.close for bar in data.bars])
            symbol = data.symbol
        else:
            if len(data) < self.slow_period:
                return Signal(SignalType.HOLD, "ASSET")
            prices = data["close"].values
            symbol = data.attrs.get("symbol", "ASSET")

        current_price = prices[-1]

        # Calculate EMAs
        fast_ema = self.calculate_ema(prices, self.fast_period)
        slow_ema = self.calculate_ema(prices, self.slow_period)

        current_fast = fast_ema[-1]
        current_slow = slow_ema[-1]
        prev_fast = fast_ema[-2] if len(fast_ema) > 1 else current_fast
        prev_slow = slow_ema[-2] if len(slow_ema) > 1 else current_slow

        # Calculate volatility
        returns = np.diff(prices) / prices[:-1]
        recent_returns = returns[-self.volatility_lookback :] if len(returns) >= self.volatility_lookback else returns
        volatility = np.std(recent_returns) if len(recent_returns) > 1 else 0

        # Skip if volatility outside acceptable range
        if volatility < self.min_volatility:
            return Signal(
                SignalType.HOLD,
                symbol,
                metadata={"reason": "volatility_too_low", "volatility": volatility},
            )

        if volatility > self.max_volatility:
            return Signal(
                SignalType.HOLD,
                symbol,
                metadata={"reason": "volatility_too_high", "volatility": volatility},
            )

        # Calculate trend strength (% difference between MAs)
        trend_strength = (current_fast - current_slow) / current_slow

        # Detect crossovers
        bullish_crossover = prev_fast <= prev_slow and current_fast > current_slow
        bearish_crossover = prev_fast >= prev_slow and current_fast < current_slow

        # Already in trend (no crossover but aligned)
        bullish_trend = current_fast > current_slow and trend_strength > self.trend_strength_threshold
        bearish_trend = current_fast < current_slow and trend_strength < -self.trend_strength_threshold

        # Calculate signal strength (stronger trend = higher strength)
        strength = min(1.0, abs(trend_strength) / 0.05)  # Max at 5% divergence

        # Volatility-adjusted confidence (lower vol = higher confidence)
        vol_factor = (self.max_volatility - volatility) / (self.max_volatility - self.min_volatility)
        confidence = min(1.0, vol_factor)

        # Generate signals
        if bullish_crossover or (bullish_trend and current_price > current_fast):
            return Signal(
                signal_type=SignalType.LONG,
                symbol=symbol,
                strength=strength,
                confidence=confidence,
                stop_loss=current_slow,  # Stop at slow MA
                metadata={
                    "trend_strength": trend_strength,
                    "volatility": volatility,
                    "fast_ema": current_fast,
                    "slow_ema": current_slow,
                    "crossover": bullish_crossover,
                },
            )

        elif bearish_crossover or (bearish_trend and current_price < current_fast):
            return Signal(
                signal_type=SignalType.CLOSE,
                symbol=symbol,
                strength=strength,
                confidence=confidence,
                metadata={
                    "trend_strength": trend_strength,
                    "volatility": volatility,
                    "fast_ema": current_fast,
                    "slow_ema": current_slow,
                    "crossover": bearish_crossover,
                },
            )

        return Signal(
            SignalType.HOLD,
            symbol,
            metadata={
                "trend_strength": trend_strength,
                "volatility": volatility,
            },
        )

    def vectorized_signals(self, data: pd.DataFrame) -> pd.Series:
        """
        Generate signals for entire DataFrame at once.

        Returns Series of 1 (long), -1 (short/close), 0 (hold).
        Useful for fast backtesting.
        """
        prices = data["close"].values

        # Calculate indicators
        fast_ema = pd.Series(self.calculate_ema(prices, self.fast_period))
        slow_ema = pd.Series(self.calculate_ema(prices, self.slow_period))

        # Volatility filter
        returns = data["close"].pct_change()
        volatility = returns.rolling(self.volatility_lookback).std()

        vol_ok = (volatility >= self.min_volatility) & (volatility <= self.max_volatility)

        # Signal generation
        trend_up = fast_ema > slow_ema
        trend_down = fast_ema < slow_ema

        signals = pd.Series(0, index=data.index)
        signals[trend_up & vol_ok] = 1
        signals[trend_down & vol_ok] = -1

        return signals
