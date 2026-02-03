"""Mean reversion strategy for steady gains."""

from dataclasses import dataclass
from datetime import datetime
from typing import Any

import numpy as np
import pandas as pd

from trading.core.strategy import Signal, SignalType, Strategy
from trading.core.types import MarketData


@dataclass
class MeanReversionStrategy(Strategy):
    """
    Mean Reversion Strategy for steady, incremental gains.

    Philosophy:
    - Markets tend to revert to their mean over time
    - Buy when price is significantly below the moving average
    - Sell when price returns to or exceeds the mean
    - Use Bollinger Bands to identify oversold/overbought conditions

    Risk Management:
    - Only trades when signal strength is high (clear divergence from mean)
    - Uses confidence based on RSI confirmation
    - Avoids trading in high-volatility regimes

    Best suited for:
    - Range-bound markets
    - Liquid stocks with stable volatility
    - Prediction markets near settlement
    """

    name: str = "MeanReversion"

    # Parameters
    lookback_period: int = 20
    std_dev_threshold: float = 2.0
    rsi_oversold: float = 30.0
    rsi_overbought: float = 70.0
    volatility_filter: float = 0.03  # Max daily volatility to trade

    def __init__(self, params: dict[str, Any] | None = None):
        super().__init__(params)
        if params:
            self.lookback_period = params.get("lookback_period", self.lookback_period)
            self.std_dev_threshold = params.get("std_dev_threshold", self.std_dev_threshold)
            self.rsi_oversold = params.get("rsi_oversold", self.rsi_oversold)
            self.rsi_overbought = params.get("rsi_overbought", self.rsi_overbought)
            self.volatility_filter = params.get("volatility_filter", self.volatility_filter)

    def generate_signal(
        self,
        data: MarketData | pd.DataFrame,
        timestamp: datetime,
    ) -> Signal:
        """Generate mean reversion signal."""
        # Convert to price array
        if isinstance(data, MarketData):
            if len(data.bars) < self.lookback_period:
                return Signal(SignalType.HOLD, data.symbol)
            prices = np.array([bar.close for bar in data.bars])
            symbol = data.symbol
        else:
            if len(data) < self.lookback_period:
                return Signal(SignalType.HOLD, "ASSET")
            prices = data["close"].values
            symbol = data.attrs.get("symbol", "ASSET")

        current_price = prices[-1]

        # Calculate Bollinger Bands
        middle, upper, lower = self.calculate_bollinger_bands(
            prices, self.lookback_period, self.std_dev_threshold
        )

        # Calculate RSI for confirmation
        rsi = self.calculate_rsi(prices)[-1]

        # Calculate current volatility
        returns = np.diff(prices) / prices[:-1]
        current_vol = np.std(returns[-self.lookback_period :]) if len(returns) >= self.lookback_period else 0

        # Skip high volatility regimes
        if current_vol > self.volatility_filter:
            return Signal(SignalType.HOLD, symbol, strength=0.0, metadata={"reason": "high_vol"})

        # Get latest band values
        current_middle = middle[-1]
        current_upper = upper[-1]
        current_lower = lower[-1]

        # Skip if bands not yet calculated
        if np.isnan(current_middle):
            return Signal(SignalType.HOLD, symbol)

        # Calculate z-score (how many std devs from mean)
        band_width = (current_upper - current_lower) / 2
        z_score = (current_price - current_middle) / band_width if band_width > 0 else 0

        # Generate signals based on band position and RSI confirmation
        if current_price <= current_lower and rsi <= self.rsi_oversold:
            # Price below lower band AND RSI oversold = BUY
            strength = min(1.0, abs(z_score) / self.std_dev_threshold)
            confidence = (self.rsi_oversold - rsi) / self.rsi_oversold

            return Signal(
                signal_type=SignalType.LONG,
                symbol=symbol,
                strength=strength,
                confidence=confidence,
                target_price=current_middle,  # Target mean
                stop_loss=current_price * 0.95,  # 5% stop loss
                metadata={
                    "z_score": z_score,
                    "rsi": rsi,
                    "lower_band": current_lower,
                    "middle_band": current_middle,
                },
            )

        elif current_price >= current_upper and rsi >= self.rsi_overbought:
            # Price above upper band AND RSI overbought = SELL/CLOSE
            strength = min(1.0, abs(z_score) / self.std_dev_threshold)
            confidence = (rsi - self.rsi_overbought) / (100 - self.rsi_overbought)

            return Signal(
                signal_type=SignalType.CLOSE,
                symbol=symbol,
                strength=strength,
                confidence=confidence,
                metadata={
                    "z_score": z_score,
                    "rsi": rsi,
                    "upper_band": current_upper,
                    "middle_band": current_middle,
                },
            )

        # No clear signal
        return Signal(
            signal_type=SignalType.HOLD,
            symbol=symbol,
            metadata={"z_score": z_score, "rsi": rsi},
        )
