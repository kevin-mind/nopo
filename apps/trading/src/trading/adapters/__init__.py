"""Data adapters for different trading platforms."""

from trading.adapters.kalshi import KalshiAdapter
from trading.adapters.alpaca import AlpacaAdapter

__all__ = ["KalshiAdapter", "AlpacaAdapter"]
