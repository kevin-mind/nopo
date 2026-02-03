#!/usr/bin/env python3
"""
Example: Live Paper Trading with Alpaca

This example demonstrates connecting to Alpaca's paper trading
environment for live strategy execution.

IMPORTANT: This uses paper trading - no real money involved.

Setup:
1. Create Alpaca account at https://alpaca.markets
2. Get API keys from the dashboard
3. Set environment variables:
   export ALPACA_API_KEY=your_key
   export ALPACA_SECRET_KEY=your_secret

Run:
    cd apps/trading
    uv run python examples/live_trading.py
"""

import os
import time
from datetime import datetime, timedelta

from dotenv import load_dotenv
from rich.console import Console
from rich.live import Live
from rich.table import Table

from trading.adapters.alpaca import AlpacaAdapter, AlpacaConfig
from trading.core.risk import RiskManager, KellyCriterion
from trading.strategies.momentum import LowVolMomentumStrategy

load_dotenv()
console = Console()


def create_status_table(
    account: dict, positions: list, risk_report: dict, last_signal: str
) -> Table:
    """Create a live status table."""
    table = Table(title="Paper Trading Status")

    table.add_column("Metric", style="cyan")
    table.add_column("Value", justify="right")

    # Account info
    table.add_row("Cash", f"${account['cash']:,.2f}")
    table.add_row("Portfolio Value", f"${account['portfolio_value']:,.2f}")
    table.add_row("Buying Power", f"${account['buying_power']:,.2f}")

    # Risk metrics
    table.add_row("---", "---")
    table.add_row("Current Drawdown", f"{risk_report['current_drawdown_pct']:.1f}%")
    table.add_row("Can Trade", str(risk_report["can_trade"]))
    table.add_row("Open Positions", str(len(positions)))

    # Last signal
    table.add_row("---", "---")
    table.add_row("Last Signal", last_signal)
    table.add_row("Time", datetime.now().strftime("%H:%M:%S"))

    return table


def run_paper_trading():
    """Run paper trading loop."""
    # Check for API keys
    api_key = os.getenv("ALPACA_API_KEY")
    secret_key = os.getenv("ALPACA_SECRET_KEY")

    if not api_key or not secret_key:
        console.print("[red]Error: Set ALPACA_API_KEY and ALPACA_SECRET_KEY[/red]")
        console.print(
            "\nGet your keys from: https://app.alpaca.markets/paper/dashboard/overview"
        )
        return

    # Initialize adapter
    config = AlpacaConfig(api_key=api_key, secret_key=secret_key, paper=True)
    adapter = AlpacaAdapter(config=config)

    try:
        adapter.connect()
        console.print("[green]Connected to Alpaca Paper Trading[/green]")
    except Exception as e:
        console.print(f"[red]Connection failed: {e}[/red]")
        return

    # Initialize strategy and risk manager
    strategy = LowVolMomentumStrategy(
        params={"fast_period": 10, "slow_period": 30, "max_volatility": 0.025}
    )

    risk_manager = RiskManager(
        position_sizer=KellyCriterion(fraction=0.25, max_position_pct=0.05),
        max_drawdown_pct=0.10,
        max_open_positions=5,
    )

    symbol = "SPY"
    last_signal = "Initializing..."

    console.print(f"\nMonitoring {symbol} with {strategy.name} strategy")
    console.print("Press Ctrl+C to stop\n")

    try:
        with Live(console=console, refresh_per_second=1) as live:
            while True:
                try:
                    # Get account info
                    account = adapter.get_account()
                    positions = adapter.get_positions()

                    # Update risk manager state
                    risk_manager.update_state(
                        current_equity=account["portfolio_value"],
                        daily_pnl=account["portfolio_value"] - account["last_equity"],
                        open_positions=len(positions),
                    )

                    # Get historical data for signal generation
                    end = datetime.now()
                    start = end - timedelta(days=60)

                    try:
                        data = adapter.get_historical_bars(
                            symbol=symbol, start=start, end=end, timeframe="1Day"
                        )

                        if len(data) > 30:
                            signal = strategy.generate_signal(data, datetime.now())
                            last_signal = f"{signal.signal_type.value} (strength: {signal.strength:.2f})"

                            # Log if interesting signal
                            if signal.signal_type.value != "hold":
                                console.log(
                                    f"Signal: {signal.signal_type.value} for {symbol}"
                                )

                    except Exception as e:
                        last_signal = f"Data error: {str(e)[:30]}"

                    # Get risk report
                    risk_report = risk_manager.get_risk_report(account["portfolio_value"])

                    # Update display
                    table = create_status_table(
                        account, positions, risk_report, last_signal
                    )
                    live.update(table)

                except Exception as e:
                    console.log(f"[red]Error: {e}[/red]")

                time.sleep(10)  # Check every 10 seconds

    except KeyboardInterrupt:
        console.print("\n[yellow]Stopping paper trading...[/yellow]")

    adapter.disconnect()
    console.print("[green]Disconnected[/green]")


def main():
    """Main entry point."""
    console.print("[bold blue]Alpaca Paper Trading Example[/bold blue]")
    console.print("This connects to Alpaca's paper trading (no real money)\n")

    run_paper_trading()


if __name__ == "__main__":
    main()
