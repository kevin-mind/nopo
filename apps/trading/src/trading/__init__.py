"""
Trading Backtesting Framework

A unified backtesting framework for Kalshi (prediction markets) and Alpaca (stocks/crypto)
with built-in risk management for steady, incremental gains.
"""

from trading.core.backtest import Backtest, BacktestResult
from trading.core.portfolio import Portfolio
from trading.core.risk import RiskManager, KellyCriterion
from trading.core.strategy import Strategy
from trading.adapters.kalshi import KalshiAdapter
from trading.adapters.alpaca import AlpacaAdapter

__version__ = "0.1.0"
__all__ = [
    "Backtest",
    "BacktestResult",
    "Portfolio",
    "RiskManager",
    "KellyCriterion",
    "Strategy",
    "KalshiAdapter",
    "AlpacaAdapter",
]
