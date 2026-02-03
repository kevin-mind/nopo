# Trading Backtesting Framework

A unified backtesting framework for **Kalshi** (prediction markets) and **Alpaca** (stocks/crypto) with built-in risk management designed for **steady, incremental gains**.

## Goals

- **Risk Management First**: Kelly Criterion position sizing, drawdown limits, volatility filters
- **Steady Returns**: Focus on consistent profits over big wins
- **Dual Platform**: Support both prediction markets (Kalshi) and traditional markets (Alpaca)
- **Easy Backtesting**: Vectorized engine for fast strategy testing

## Quick Start

```bash
cd apps/trading
uv sync
uv run python examples/backtest_example.py
```

## Architecture

```
trading/
├── core/
│   ├── backtest.py      # Backtesting engine
│   ├── portfolio.py     # Position & portfolio tracking
│   ├── risk.py          # Kelly Criterion & risk management
│   ├── strategy.py      # Base strategy class
│   └── types.py         # Core data types
├── adapters/
│   ├── kalshi.py        # Kalshi prediction markets API
│   └── alpaca.py        # Alpaca stocks/crypto API
├── strategies/
│   ├── mean_reversion.py    # Bollinger Bands + RSI
│   ├── prediction_value.py  # Value betting for Kalshi
│   └── momentum.py          # Low-vol momentum following
└── examples/
    ├── backtest_example.py  # Full backtesting demo
    └── live_trading.py      # Paper trading example
```

## Key Components

### Risk Management

The framework uses **Fractional Kelly Criterion** for position sizing:

```python
from trading.core.risk import KellyCriterion, RiskManager

# Conservative position sizing (25% Kelly)
kelly = KellyCriterion(
    fraction=0.25,        # Use 25% of full Kelly
    max_position_pct=0.10, # Never risk > 10% per trade
    min_position_pct=0.01, # Minimum 1% to be meaningful
)

# Full risk management
risk_manager = RiskManager(
    position_sizer=kelly,
    max_drawdown_pct=0.15,     # Stop at 15% drawdown
    daily_loss_limit_pct=0.03, # Max 3% daily loss
    max_open_positions=10,
)
```

**Why Fractional Kelly?**
- Full Kelly maximizes long-term growth but has ~50% drawdowns
- 25-50% Kelly significantly reduces volatility with modest growth reduction
- Better for psychological comfort and real-world trading

### Backtesting Engine

```python
from trading.core.backtest import Backtest
from trading.strategies.mean_reversion import MeanReversionStrategy

# Create strategy
strategy = MeanReversionStrategy(params={
    "lookback_period": 20,
    "std_dev_threshold": 2.0,
})

# Run backtest
backtest = Backtest(
    strategy=strategy,
    initial_capital=10000,
    risk_manager=risk_manager,
)

result = backtest.run(data, symbol="SPY")
print(result.summary())
```

### Pre-built Strategies

#### 1. Mean Reversion (Stocks)
- Buys when price falls below lower Bollinger Band + RSI oversold
- Sells when price returns to mean
- Avoids high-volatility regimes

```python
from trading.strategies.mean_reversion import MeanReversionStrategy

strategy = MeanReversionStrategy(params={
    "lookback_period": 20,
    "std_dev_threshold": 2.0,
    "rsi_oversold": 30,
    "volatility_filter": 0.03,
})
```

#### 2. Prediction Value (Kalshi)
- Finds markets where your probability estimate differs from market price
- Buys YES when underpriced, NO when overpriced
- Requires external probability model

```python
from trading.strategies.prediction_value import PredictionValueStrategy

strategy = PredictionValueStrategy(params={
    "min_edge": 0.05,  # Need 5% edge to trade
})
strategy.set_probability_estimate("KXELEC-2024", 0.55)  # Your estimate
```

#### 3. Low-Volatility Momentum (ETFs)
- Follows trends using dual EMA crossover
- Only trades in low-to-moderate volatility
- Reduces whipsaws in choppy markets

```python
from trading.strategies.momentum import LowVolMomentumStrategy

strategy = LowVolMomentumStrategy(params={
    "fast_period": 10,
    "slow_period": 30,
    "max_volatility": 0.025,
})
```

## Platform Adapters

### Alpaca (Stocks/Crypto)

```python
from trading.adapters.alpaca import AlpacaAdapter, AlpacaConfig

config = AlpacaConfig(
    api_key="your-key",
    secret_key="your-secret",
    paper=True,  # Paper trading
)

adapter = AlpacaAdapter(config=config)
adapter.connect()

# Get historical data
data = adapter.get_historical_bars("SPY", start, end, timeframe="1Day")

# Get account info
account = adapter.get_account()
positions = adapter.get_positions()
```

### Kalshi (Prediction Markets)

```python
from trading.adapters.kalshi import KalshiAdapter, KalshiConfig

config = KalshiConfig(
    api_key="your-key",
    private_key="your-rsa-key",
    use_demo=True,
)

adapter = KalshiAdapter(config=config)
await adapter.connect()

# Get markets
markets = await adapter.get_markets(series_ticker="KXBTC")

# Get market history
history = await adapter.get_market_history("KXBTC-24DEC31")
```

## Testing

```bash
cd apps/trading
uv run pytest
```

## API Research Summary

### Kalshi API
- **Auth**: RSA-signed requests, tokens expire every 30 minutes
- **Rate Limits**: Applies, use exponential backoff
- **Data**: REST API + WebSocket for real-time
- **Key Insight**: Prices in cents (0-100), contracts pay $1 or $0

**Resources:**
- [Kalshi API Docs](https://docs.kalshi.com/welcome)
- [Kalshi GitHub Topics](https://github.com/topics/kalshi-api)

### Alpaca API
- **Auth**: API key + secret
- **SDK**: `alpaca-py` (official Python SDK)
- **Features**: Paper trading, fractional shares, real-time data
- **Rate Limits**: 200 req/min trading, separate for data

**Resources:**
- [Alpaca API Docs](https://docs.alpaca.markets/docs/getting-started)
- [Alpaca Python SDK](https://github.com/alpacahq/alpaca-py)

### Backtesting Frameworks Comparison

| Framework | Speed | Ease of Use | Live Trading | Best For |
|-----------|-------|-------------|--------------|----------|
| VectorBT | Fastest | Medium | Limited | Research, optimization |
| Backtrader | Medium | Easy | Good | Swing trading, learning |
| Zipline | Medium | Hard | Deprecated | Legacy, institutional |

This framework takes inspiration from VectorBT's speed with Backtrader's simplicity.

## Risk Management Philosophy

### For Steady Gains (Not Big Wins)

1. **Use Fractional Kelly (25-50%)**: Reduces volatility significantly
2. **Set Max Drawdown Limits**: Stop trading at 10-15% drawdown
3. **Daily Loss Limits**: Prevent catastrophic single-day losses
4. **Volatility Filters**: Avoid trading in choppy markets
5. **Diversification**: Multiple uncorrelated positions
6. **Position Size Limits**: Never risk more than 5-10% per position

### Kelly Criterion Quick Reference

| Win Rate | Odds (Win:Loss) | Full Kelly | 25% Kelly |
|----------|-----------------|------------|-----------|
| 55% | 1:1 | 10% | 2.5% |
| 60% | 1:1 | 20% | 5.0% |
| 50% | 2:1 | 25% | 6.25% |
| 40% | 3:1 | 20% | 5.0% |

## Deployment Strategy

1. **Paper Trading First**: Run on Alpaca paper for 1-3 months
2. **Start Small**: Begin with 10-25% of intended capital
3. **Monitor Metrics**: Track Sharpe, drawdown, win rate daily
4. **Gradual Scale**: Increase capital only after consistent results
5. **Circuit Breakers**: Auto-stop on unexpected losses

## Next Steps

1. [ ] Add walk-forward optimization
2. [ ] Implement WebSocket real-time data
3. [ ] Add more strategies (pairs trading, stat arb)
4. [ ] Create probability models for Kalshi
5. [ ] Add position correlation analysis
6. [ ] Implement automated deployment

## Sources

- [Kalshi API Documentation](https://docs.kalshi.com/welcome)
- [Kalshi API Guide - Zuplo](https://zuplo.com/learning-center/kalshi-api)
- [Alpaca API Docs](https://docs.alpaca.markets/docs/getting-started)
- [Alpaca Python SDK](https://github.com/alpacahq/alpaca-py)
- [VectorBT Documentation](https://vectorbt.dev/)
- [Kelly Criterion - QuantStart](https://www.quantstart.com/articles/Money-Management-via-the-Kelly-Criterion/)
- [Risk-Constrained Kelly - QuantInsti](https://blog.quantinsti.com/risk-constrained-kelly-criterion/)
- [Kalshi Market Making - GitHub](https://github.com/nikhilnd/kalshi-market-making)
- [Backtester Comparison - Medium](https://medium.com/@trading.dude/battle-tested-backtesters-comparing-vectorbt-zipline-and-backtrader-for-financial-strategy-dee33d33a9e0)
