"""
Structured logging utilities for the backend application.

This module provides helper functions and utilities for structured logging
with support for multiple log levels and JSON output.
"""

import logging
from typing import Any

# Get logger for the backend application
logger = logging.getLogger("backend")


def log_debug(message: str, **kwargs: Any) -> None:
    """
    Log a debug message with optional structured context.

    Args:
        message: The log message
        **kwargs: Additional context to include in structured logs
    """
    logger.debug(message, extra=kwargs)


def log_info(message: str, **kwargs: Any) -> None:
    """
    Log an info message with optional structured context.

    Args:
        message: The log message
        **kwargs: Additional context to include in structured logs
    """
    logger.info(message, extra=kwargs)


def log_warning(message: str, **kwargs: Any) -> None:
    """
    Log a warning message with optional structured context.

    Args:
        message: The log message
        **kwargs: Additional context to include in structured logs
    """
    logger.warning(message, extra=kwargs)


def log_error(message: str, **kwargs: Any) -> None:
    """
    Log an error message with optional structured context.

    Args:
        message: The log message
        **kwargs: Additional context to include in structured logs
    """
    logger.error(message, extra=kwargs)


def log_exception(message: str, exc_info: bool = True, **kwargs: Any) -> None:
    """
    Log an exception with traceback and optional structured context.

    Args:
        message: The log message
        exc_info: Whether to include exception info (default: True)
        **kwargs: Additional context to include in structured logs
    """
    logger.exception(message, exc_info=exc_info, extra=kwargs)
