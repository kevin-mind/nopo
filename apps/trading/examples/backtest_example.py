#!/usr/bin/env python3
"""
Example: Backtesting Strategies on Kalshi and Alpaca

This example demonstrates:
1. Running backtests with different strategies
2. Risk-managed position sizing with fractional Kelly
3. Comparing strategy performance
4. Generating sample data for testing

Run this example:
    cd apps/trading
    uv run python examples/backtest_example.py
"""

import numpy as np
import pandas as pd
from rich.console import Console
from rich.table import Table

from trading.core.backtest import Backtest
from trading.core.risk import KellyCriterion, RiskManager
from trading.adapters.kalshi import KalshiAdapter
from trading.adapters.alpaca import AlpacaAdapter
from trading.strategies.mean_reversion import MeanReversionStrategy
from trading.strategies.prediction_value import PredictionValueStrategy
from trading.strategies.momentum import LowVolMomentumStrategy

console = Console()


def run_stock_backtest():
    """Run backtest on simulated stock data."""
    console.print("\n[bold blue]Stock Backtest (Alpaca-style data)[/bold blue]")
    console.print("=" * 50)

    # Generate sample stock data
    data = AlpacaAdapter.generate_sample_data(
        symbol="SPY",
        days=252,  # One trading year
        initial_price=450.0,
        annual_return=0.08,  # 8% expected return
        annual_volatility=0.15,  # 15% volatility
    )

    console.print(f"Data: {len(data)} trading days")
    console.print(f"Price range: ${data['close'].min():.2f} - ${data['close'].max():.2f}")

    # Configure risk management
    risk_manager = RiskManager(
        position_sizer=KellyCriterion(
            fraction=0.25,  # 25% Kelly for conservative sizing
            max_position_pct=0.10,
            min_position_pct=0.01,
        ),
        max_drawdown_pct=0.15,
        daily_loss_limit_pct=0.03,
        max_open_positions=10,
    )

    # Test different strategies
    strategies = [
        MeanReversionStrategy(params={"lookback_period": 20, "std_dev_threshold": 2.0}),
        LowVolMomentumStrategy(params={"fast_period": 10, "slow_period": 30}),
    ]

    results = []
    for strategy in strategies:
        backtest = Backtest(
            strategy=strategy,
            initial_capital=10000,
            risk_manager=risk_manager,
        )
        result = backtest.run(data, symbol="SPY")
        results.append(result)
        console.print(f"\n[bold]{strategy.name}[/bold]")
        console.print(result.summary())

    return results


def run_prediction_market_backtest():
    """Run backtest on simulated prediction market data."""
    console.print("\n[bold blue]Prediction Market Backtest (Kalshi-style data)[/bold blue]")
    console.print("=" * 50)

    # Generate sample prediction market data
    data = KalshiAdapter.generate_sample_data(
        days=30,
        initial_prob=0.5,  # Start at 50%
        volatility=0.08,
    )

    console.print(f"Data: {len(data)} hours of trading")
    console.print(f"Price range: {data['close'].min():.2%} - {data['close'].max():.2%}")

    # Configure prediction market strategy
    strategy = PredictionValueStrategy(
        params={
            "min_edge": 0.05,  # 5% minimum edge
            "min_implied_prob": 0.10,
            "max_implied_prob": 0.90,
        }
    )

    # Set our probability estimate (simulating external model)
    # In reality, this would come from a forecasting model
    strategy.set_probability_estimate("PREDICTION", 0.55)  # We think true prob is 55%

    # Conservative risk management for prediction markets
    risk_manager = RiskManager(
        position_sizer=KellyCriterion(
            fraction=0.20,  # More conservative for prediction markets
            max_position_pct=0.05,  # Max 5% per market
        ),
        max_drawdown_pct=0.10,
        max_open_positions=20,  # Can diversify across many markets
    )

    backtest = Backtest(
        strategy=strategy,
        initial_capital=1000,  # Smaller capital for prediction markets
        risk_manager=risk_manager,
    )

    result = backtest.run(data, symbol="PREDICTION")
    console.print(result.summary())

    return result


def compare_strategies():
    """Compare multiple strategies on the same data."""
    console.print("\n[bold blue]Strategy Comparison[/bold blue]")
    console.print("=" * 50)

    # Generate consistent test data
    np.random.seed(42)
    data = AlpacaAdapter.generate_sample_data(
        symbol="TEST",
        days=504,  # 2 years
        annual_return=0.06,
        annual_volatility=0.18,
    )

    strategies = [
        MeanReversionStrategy(params={"lookback_period": 10}),
        MeanReversionStrategy(params={"lookback_period": 20}),
        MeanReversionStrategy(params={"lookback_period": 30}),
        LowVolMomentumStrategy(params={"fast_period": 5, "slow_period": 20}),
        LowVolMomentumStrategy(params={"fast_period": 10, "slow_period": 30}),
    ]

    # Run all backtests
    results = []
    for strategy in strategies:
        backtest = Backtest(strategy=strategy, initial_capital=10000)
        result = backtest.run(data, symbol="TEST")
        results.append(
            {
                "strategy": strategy.name,
                "params": str(strategy.params) if hasattr(strategy, "params") else "",
                "return": result.total_return_pct,
                "sharpe": result.sharpe_ratio,
                "max_dd": result.max_drawdown_pct,
                "trades": result.metrics.get("num_trades", 0),
            }
        )

    # Display comparison table
    table = Table(title="Strategy Comparison")
    table.add_column("Strategy", style="cyan")
    table.add_column("Return %", justify="right")
    table.add_column("Sharpe", justify="right")
    table.add_column("Max DD %", justify="right")
    table.add_column("Trades", justify="right")

    for r in sorted(results, key=lambda x: x["sharpe"], reverse=True):
        table.add_row(
            f"{r['strategy']}",
            f"{r['return']:.1f}%",
            f"{r['sharpe']:.2f}",
            f"{r['max_dd']:.1f}%",
            str(r["trades"]),
        )

    console.print(table)


def demonstrate_kelly_sizing():
    """Demonstrate Kelly Criterion position sizing."""
    console.print("\n[bold blue]Kelly Criterion Position Sizing Demo[/bold blue]")
    console.print("=" * 50)

    kelly = KellyCriterion(fraction=1.0)  # Full Kelly for demonstration

    scenarios = [
        ("50% win, 1:1 odds", 0.50, 100, 100),
        ("55% win, 1:1 odds", 0.55, 100, 100),
        ("60% win, 1:1 odds", 0.60, 100, 100),
        ("50% win, 2:1 odds", 0.50, 200, 100),
        ("40% win, 3:1 odds", 0.40, 300, 100),
    ]

    table = Table(title="Full Kelly Fractions")
    table.add_column("Scenario", style="cyan")
    table.add_column("Kelly %", justify="right")
    table.add_column("25% Kelly", justify="right")
    table.add_column("$10k Position", justify="right")

    for name, win_rate, avg_win, avg_loss in scenarios:
        full_kelly = kelly.calculate_kelly_fraction(win_rate, avg_win, avg_loss)
        quarter_kelly = full_kelly * 0.25
        position = kelly.calculate_position_size(win_rate, avg_win, avg_loss, 10000)

        table.add_row(
            name,
            f"{full_kelly * 100:.1f}%",
            f"{quarter_kelly * 100:.1f}%",
            f"${position:,.0f}",
        )

    console.print(table)
    console.print(
        "\n[dim]Note: 25% Kelly is recommended for lower volatility and steadier returns.[/dim]"
    )


def main():
    """Run all examples."""
    console.print("[bold green]Trading Backtesting Framework Examples[/bold green]")
    console.print("Focus: Steady, incremental gains with proper risk management\n")

    # Run demonstrations
    demonstrate_kelly_sizing()
    run_stock_backtest()
    run_prediction_market_backtest()
    compare_strategies()

    console.print("\n[bold green]Examples complete![/bold green]")
    console.print(
        "\nNext steps:\n"
        "1. Connect to Alpaca paper trading for real data\n"
        "2. Connect to Kalshi API for prediction market data\n"
        "3. Develop your own probability models for prediction markets\n"
        "4. Run walk-forward optimization to tune parameters\n"
    )


if __name__ == "__main__":
    main()
