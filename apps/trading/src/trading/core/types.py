"""Core type definitions for the trading framework."""

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any


class OrderSide(Enum):
    """Order side (buy/sell)."""

    BUY = "buy"
    SELL = "sell"


class OrderType(Enum):
    """Order type."""

    MARKET = "market"
    LIMIT = "limit"


class AssetType(Enum):
    """Type of tradeable asset."""

    STOCK = "stock"
    CRYPTO = "crypto"
    PREDICTION = "prediction"  # Kalshi event contracts


@dataclass
class OHLCV:
    """OHLCV bar data."""

    timestamp: datetime
    open: float
    high: float
    low: float
    close: float
    volume: float


@dataclass
class Trade:
    """Executed trade."""

    timestamp: datetime
    symbol: str
    side: OrderSide
    quantity: float
    price: float
    fees: float = 0.0
    metadata: dict[str, Any] = field(default_factory=dict)

    @property
    def value(self) -> float:
        """Total trade value (quantity * price)."""
        return self.quantity * self.price

    @property
    def cost(self) -> float:
        """Total cost including fees (positive for buys, negative for sells)."""
        base = self.value + self.fees
        return base if self.side == OrderSide.BUY else -base + self.fees


@dataclass
class Order:
    """Order to be executed."""

    symbol: str
    side: OrderSide
    quantity: float
    order_type: OrderType = OrderType.MARKET
    limit_price: float | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class MarketData:
    """Container for market data."""

    symbol: str
    asset_type: AssetType
    bars: list[OHLCV] = field(default_factory=list)
    current_price: float = 0.0
    bid: float = 0.0
    ask: float = 0.0
    spread: float = 0.0

    def __post_init__(self) -> None:
        if self.bars and not self.current_price:
            self.current_price = self.bars[-1].close


@dataclass
class KalshiMarket:
    """Kalshi-specific market data."""

    ticker: str
    title: str
    subtitle: str
    yes_price: float  # Price of YES contract (0-100 cents)
    no_price: float  # Price of NO contract (0-100 cents)
    volume: int
    open_interest: int
    expiration: datetime
    result: str | None = None  # "yes", "no", or None if not settled

    @property
    def implied_probability(self) -> float:
        """Implied probability from YES price."""
        return self.yes_price / 100.0
