"""Tests for utility functions."""

from django.test import TestCase

from backend.utils import format_greeting


class TestFormatGreeting(TestCase):
    """Tests for format_greeting function."""

    def test_basic_greeting(self) -> None:
        """Test basic informal greeting."""
        result = format_greeting("Alice")
        self.assertEqual(result, "Hello, Alice!")

    def test_formal_greeting(self) -> None:
        """Test formal greeting."""
        result = format_greeting("Bob", formal=True)
        self.assertEqual(result, "Good day, Bob.")

    def test_strips_whitespace(self) -> None:
        """Test that leading/trailing whitespace is stripped."""
        result = format_greeting("  Charlie  ")
        self.assertEqual(result, "Hello, Charlie!")

    def test_empty_name_raises_error(self) -> None:
        """Test that empty name raises ValueError."""
        with self.assertRaisesMessage(ValueError, "Name cannot be empty"):
            format_greeting("")

    def test_whitespace_only_name_raises_error(self) -> None:
        """Test that whitespace-only name raises ValueError."""
        with self.assertRaisesMessage(ValueError, "Name cannot be empty"):
            format_greeting("   ")

    def test_formal_with_whitespace(self) -> None:
        """Test formal greeting with whitespace."""
        result = format_greeting("  David  ", formal=True)
        self.assertEqual(result, "Good day, David.")
