"""
Tests for the logging utilities module.
"""

import logging
from unittest.mock import MagicMock, patch

from django.test import TestCase, override_settings

from backend.logging_utils import (
    log_debug,
    log_error,
    log_exception,
    log_info,
    log_warning,
)


class LoggingUtilsTestCase(TestCase):
    """Test cases for logging utility functions."""

    def setUp(self):
        """Set up test fixtures."""
        self.mock_logger = MagicMock()

    @patch("backend.logging_utils.logger")
    def test_log_debug(self, mock_logger):
        """Test debug logging."""
        log_debug("Debug message", user_id=123, action="test")
        mock_logger.debug.assert_called_once_with(
            "Debug message", extra={"user_id": 123, "action": "test"}
        )

    @patch("backend.logging_utils.logger")
    def test_log_info(self, mock_logger):
        """Test info logging."""
        log_info("Info message", request_id="abc-123")
        mock_logger.info.assert_called_once_with(
            "Info message", extra={"request_id": "abc-123"}
        )

    @patch("backend.logging_utils.logger")
    def test_log_warning(self, mock_logger):
        """Test warning logging."""
        log_warning("Warning message", severity="high")
        mock_logger.warning.assert_called_once_with(
            "Warning message", extra={"severity": "high"}
        )

    @patch("backend.logging_utils.logger")
    def test_log_error(self, mock_logger):
        """Test error logging."""
        log_error("Error message", error_code=500)
        mock_logger.error.assert_called_once_with(
            "Error message", extra={"error_code": 500}
        )

    @patch("backend.logging_utils.logger")
    def test_log_exception(self, mock_logger):
        """Test exception logging."""
        log_exception("Exception occurred", trace_id="xyz-789")
        mock_logger.exception.assert_called_once_with(
            "Exception occurred", exc_info=True, extra={"trace_id": "xyz-789"}
        )

    @patch("backend.logging_utils.logger")
    def test_log_exception_without_exc_info(self, mock_logger):
        """Test exception logging without traceback."""
        log_exception("Exception occurred", exc_info=False)
        mock_logger.exception.assert_called_once_with(
            "Exception occurred", exc_info=False, extra={}
        )

    @patch("backend.logging_utils.logger")
    def test_log_without_extra_context(self, mock_logger):
        """Test logging without additional context."""
        log_info("Simple message")
        mock_logger.info.assert_called_once_with("Simple message", extra={})

    @override_settings(
        LOGGING={
            "version": 1,
            "disable_existing_loggers": False,
            "handlers": {
                "console": {
                    "class": "logging.StreamHandler",
                },
            },
            "loggers": {
                "backend": {
                    "handlers": ["console"],
                    "level": "DEBUG",
                },
            },
        }
    )
    def test_actual_logging_integration(self):
        """Test actual logging output (integration test)."""
        with self.assertLogs("backend", level="INFO") as cm:
            log_info("Integration test message", test=True)
            self.assertEqual(len(cm.output), 1)
            self.assertIn("Integration test message", cm.output[0])
