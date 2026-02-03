"""Value-based strategy for prediction markets (Kalshi)."""

from dataclasses import dataclass
from datetime import datetime
from typing import Any

import numpy as np
import pandas as pd

from trading.core.strategy import Signal, SignalType, Strategy
from trading.core.types import KalshiMarket, MarketData


@dataclass
class PredictionValueStrategy(Strategy):
    """
    Value Strategy for Prediction Markets (Kalshi).

    Philosophy:
    - Find markets where implied probability differs from estimated true probability
    - Buy YES when market underprices probability, buy NO when overpriced
    - Focus on markets with sufficient liquidity and time to expiration
    - Take small, consistent edges rather than large bets

    Key Insight for Kalshi:
    - Contracts pay $1 if event happens, $0 otherwise
    - Price = implied probability (e.g., 60 cents = 60% implied probability)
    - If you estimate true probability is 70% but market says 60%, buy YES
    - Your edge = true_prob - market_price

    Risk Management:
    - Only trade when edge exceeds minimum threshold
    - Reduce position size as expiration approaches (time decay risk)
    - Avoid illiquid markets
    - Diversify across uncorrelated events

    Best suited for:
    - Sports/election outcomes where you have an edge
    - Weather markets with public forecast data
    - Economic indicators near release
    """

    name: str = "PredictionValue"

    # Parameters
    min_edge: float = 0.05  # Minimum 5% edge to trade
    max_implied_prob: float = 0.90  # Avoid extreme favorites
    min_implied_prob: float = 0.10  # Avoid extreme underdogs
    min_volume: int = 1000  # Minimum daily volume
    min_days_to_expiry: int = 1  # Don't trade on expiration day
    time_decay_start: int = 7  # Start reducing size with 7 days left

    def __init__(self, params: dict[str, Any] | None = None):
        super().__init__(params)
        if params:
            self.min_edge = params.get("min_edge", self.min_edge)
            self.max_implied_prob = params.get("max_implied_prob", self.max_implied_prob)
            self.min_implied_prob = params.get("min_implied_prob", self.min_implied_prob)
            self.min_volume = params.get("min_volume", self.min_volume)
            self.min_days_to_expiry = params.get("min_days_to_expiry", self.min_days_to_expiry)

        # Store probability estimates (would come from external model)
        self._probability_estimates: dict[str, float] = {}

    def set_probability_estimate(self, ticker: str, probability: float) -> None:
        """Set the estimated true probability for a market."""
        self._probability_estimates[ticker] = probability

    def generate_signal(
        self,
        data: MarketData | pd.DataFrame,
        timestamp: datetime,
    ) -> Signal:
        """Generate signal for prediction market."""
        # Handle different data types
        if isinstance(data, MarketData):
            symbol = data.symbol
            market_price = data.current_price
            bars = data.bars
        elif isinstance(data, pd.DataFrame):
            symbol = data.attrs.get("symbol", "MARKET")
            market_price = data["close"].iloc[-1]
            bars = None
        else:
            return Signal(SignalType.HOLD, "MARKET")

        # Get our probability estimate
        true_prob = self._probability_estimates.get(symbol)

        if true_prob is None:
            # No estimate - try to infer from historical mean reversion
            if isinstance(data, pd.DataFrame) and len(data) > 20:
                # Use historical average as naive estimate
                true_prob = data["close"].rolling(20).mean().iloc[-1]
            else:
                return Signal(
                    SignalType.HOLD,
                    symbol,
                    metadata={"reason": "no_probability_estimate"},
                )

        # Market implied probability (price is in 0-1 range)
        implied_prob = market_price

        # Filter: avoid extreme probabilities
        if implied_prob > self.max_implied_prob or implied_prob < self.min_implied_prob:
            return Signal(
                SignalType.HOLD,
                symbol,
                metadata={"reason": "extreme_probability", "implied_prob": implied_prob},
            )

        # Calculate edge
        edge = true_prob - implied_prob  # Positive = underpriced YES

        # Check minimum edge threshold
        if abs(edge) < self.min_edge:
            return Signal(
                SignalType.HOLD,
                symbol,
                metadata={"edge": edge, "below_threshold": True},
            )

        # Calculate signal strength based on edge magnitude
        strength = min(1.0, abs(edge) / 0.15)  # Max strength at 15% edge

        # Confidence based on how far from 50/50 (more confident at extremes)
        confidence = 1.0 - abs(implied_prob - true_prob) * 2

        # Generate signal
        if edge > 0:
            # YES is underpriced - BUY YES
            return Signal(
                signal_type=SignalType.LONG,
                symbol=symbol,
                strength=strength,
                confidence=max(0.5, confidence),
                metadata={
                    "edge": edge,
                    "true_prob": true_prob,
                    "implied_prob": implied_prob,
                    "action": "buy_yes",
                },
            )
        else:
            # YES is overpriced - BUY NO (equivalent to SHORT YES)
            return Signal(
                signal_type=SignalType.SHORT,
                symbol=symbol,
                strength=strength,
                confidence=max(0.5, confidence),
                metadata={
                    "edge": edge,
                    "true_prob": true_prob,
                    "implied_prob": implied_prob,
                    "action": "buy_no",
                },
            )

    def calculate_expected_value(
        self,
        true_prob: float,
        market_price: float,
        contract_type: str = "yes",
    ) -> float:
        """
        Calculate expected value of a trade.

        Args:
            true_prob: Your estimated probability
            market_price: Current market price (0-1)
            contract_type: "yes" or "no"

        Returns:
            Expected value per dollar risked
        """
        if contract_type == "yes":
            # YES contract: pay market_price, receive $1 if true
            win_amount = 1.0 - market_price
            lose_amount = market_price
            ev = true_prob * win_amount - (1 - true_prob) * lose_amount
        else:
            # NO contract: pay (1-market_price), receive $1 if false
            no_price = 1.0 - market_price
            win_amount = 1.0 - no_price
            lose_amount = no_price
            ev = (1 - true_prob) * win_amount - true_prob * lose_amount

        return ev

    def find_value_opportunities(
        self,
        markets: list[KalshiMarket],
        probability_estimates: dict[str, float],
    ) -> list[tuple[KalshiMarket, float, str]]:
        """
        Scan multiple markets for value opportunities.

        Returns:
            List of (market, edge, action) tuples sorted by edge
        """
        opportunities = []

        for market in markets:
            ticker = market.ticker
            if ticker not in probability_estimates:
                continue

            true_prob = probability_estimates[ticker]
            implied_prob = market.implied_probability

            # Skip filtered markets
            if (
                implied_prob > self.max_implied_prob
                or implied_prob < self.min_implied_prob
                or market.volume < self.min_volume
            ):
                continue

            edge = true_prob - implied_prob

            if abs(edge) >= self.min_edge:
                action = "buy_yes" if edge > 0 else "buy_no"
                opportunities.append((market, edge, action))

        # Sort by absolute edge (best opportunities first)
        opportunities.sort(key=lambda x: abs(x[1]), reverse=True)

        return opportunities
