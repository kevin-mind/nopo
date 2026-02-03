"""Tests for risk management components."""

import numpy as np
import pytest

from trading.core.risk import KellyCriterion, RiskManager


class TestKellyCriterion:
    """Tests for Kelly Criterion position sizing."""

    def test_kelly_fraction_positive_edge(self):
        """Test Kelly calculation with positive edge."""
        kelly = KellyCriterion(fraction=1.0)  # Full Kelly for testing

        # 60% win rate, 1:1 payoff
        fraction = kelly.calculate_kelly_fraction(
            win_rate=0.6, avg_win=100, avg_loss=100
        )

        # f* = (bp - q) / b = (1*0.6 - 0.4) / 1 = 0.2
        assert abs(fraction - 0.2) < 0.01

    def test_kelly_fraction_no_edge(self):
        """Test Kelly with 50/50 odds returns zero."""
        kelly = KellyCriterion()

        fraction = kelly.calculate_kelly_fraction(
            win_rate=0.5, avg_win=100, avg_loss=100
        )

        assert fraction == 0.0

    def test_kelly_fraction_negative_edge(self):
        """Test Kelly returns negative for losing strategy."""
        kelly = KellyCriterion()

        fraction = kelly.calculate_kelly_fraction(
            win_rate=0.4, avg_win=100, avg_loss=100
        )

        assert fraction < 0  # Negative edge

    def test_position_size_respects_max(self):
        """Test position size is capped at maximum."""
        kelly = KellyCriterion(fraction=1.0, max_position_pct=0.10)

        # Very high edge that would normally suggest large bet
        size = kelly.calculate_position_size(
            win_rate=0.9, avg_win=200, avg_loss=50, capital=10000
        )

        # Should be capped at 10% of capital
        assert size <= 10000 * 0.10

    def test_position_size_zero_for_no_edge(self):
        """Test no position when no edge."""
        kelly = KellyCriterion()

        size = kelly.calculate_position_size(
            win_rate=0.5, avg_win=100, avg_loss=100, capital=10000
        )

        assert size == 0.0

    def test_fractional_kelly_reduces_size(self):
        """Test fractional Kelly reduces position size."""
        full_kelly = KellyCriterion(fraction=1.0, max_position_pct=0.50)
        half_kelly = KellyCriterion(fraction=0.5, max_position_pct=0.50)

        full_size = full_kelly.calculate_position_size(
            win_rate=0.6, avg_win=100, avg_loss=100, capital=10000
        )
        half_size = half_kelly.calculate_position_size(
            win_rate=0.6, avg_win=100, avg_loss=100, capital=10000
        )

        assert half_size < full_size
        assert abs(half_size / full_size - 0.5) < 0.1


class TestRiskManager:
    """Tests for comprehensive risk management."""

    def test_can_trade_normal_conditions(self):
        """Test trading allowed under normal conditions."""
        rm = RiskManager()
        rm.peak_equity = 10000

        assert rm.can_trade(10000) is True

    def test_cannot_trade_max_drawdown(self):
        """Test trading blocked at max drawdown."""
        rm = RiskManager(max_drawdown_pct=0.15)
        rm.peak_equity = 10000

        # 15% drawdown
        assert rm.can_trade(8500) is False
        # Just under threshold
        assert rm.can_trade(8600) is True

    def test_cannot_trade_max_positions(self):
        """Test trading blocked at max positions."""
        rm = RiskManager(max_open_positions=5)
        rm.peak_equity = 10000
        rm.open_positions = 5

        assert rm.can_trade(10000) is False

    def test_drawdown_calculation(self):
        """Test drawdown is calculated correctly."""
        rm = RiskManager()
        rm.peak_equity = 10000

        assert rm.current_drawdown(9000) == 0.10  # 10% drawdown
        assert rm.current_drawdown(10000) == 0.0
        assert rm.current_drawdown(8000) == 0.20

    def test_volatility_adjusted_sizing(self):
        """Test position sizing adjusts for volatility."""
        rm = RiskManager()
        rm.peak_equity = 10000

        # Low volatility = larger position
        low_vol_size = rm.calculate_position_size(
            win_rate=0.6, avg_win=100, avg_loss=100, capital=10000, volatility=0.01
        )

        # High volatility = smaller position
        high_vol_size = rm.calculate_position_size(
            win_rate=0.6, avg_win=100, avg_loss=100, capital=10000, volatility=0.05
        )

        assert low_vol_size > high_vol_size

    def test_risk_report_structure(self):
        """Test risk report contains all required fields."""
        rm = RiskManager()
        rm.peak_equity = 10000
        rm.daily_pnl = -50
        rm.open_positions = 3

        report = rm.get_risk_report(9500)

        assert "current_equity" in report
        assert "peak_equity" in report
        assert "current_drawdown_pct" in report
        assert "can_trade" in report
        assert report["current_equity"] == 9500
        assert report["peak_equity"] == 10000
