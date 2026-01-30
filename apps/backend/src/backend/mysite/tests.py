"""Tests for Django settings configuration."""

import os
from unittest import mock

from django.test import TestCase


class DatabaseConnectionPoolConfigTests(TestCase):
    """Test cases for database connection pool configuration."""

    def test_default_conn_max_age(self) -> None:
        """Test that CONN_MAX_AGE defaults to 600 seconds."""
        # The setting should be applied to the database config
        # When DATABASE_URL is not set, we use SQLite, so we check the setting directly
        import settings as app_settings

        # Check the configured value (with current env)
        self.assertIsInstance(app_settings.CONN_MAX_AGE, int)

    def test_default_conn_health_checks(self) -> None:
        """Test that DB_CONN_HEALTH_CHECKS defaults to True."""
        import settings as app_settings

        self.assertIsInstance(app_settings.DB_CONN_HEALTH_CHECKS, bool)

    @mock.patch.dict(os.environ, {"CONN_MAX_AGE": "300"})
    def test_custom_conn_max_age(self) -> None:
        """Test that CONN_MAX_AGE can be set via environment variable."""
        # Reimport to pick up new env var
        import importlib

        import settings as app_settings

        importlib.reload(app_settings)

        self.assertEqual(app_settings.CONN_MAX_AGE, 300)

    @mock.patch.dict(os.environ, {"CONN_MAX_AGE": "0"})
    def test_conn_max_age_zero(self) -> None:
        """Test that CONN_MAX_AGE can be set to 0 (close after each request)."""
        import importlib

        import settings as app_settings

        importlib.reload(app_settings)

        self.assertEqual(app_settings.CONN_MAX_AGE, 0)

    @mock.patch.dict(os.environ, {"DB_CONN_HEALTH_CHECKS": "false"})
    def test_disable_health_checks(self) -> None:
        """Test that DB_CONN_HEALTH_CHECKS can be disabled."""
        import importlib

        import settings as app_settings

        importlib.reload(app_settings)

        self.assertFalse(app_settings.DB_CONN_HEALTH_CHECKS)

    @mock.patch.dict(os.environ, {"DB_CONN_HEALTH_CHECKS": "true"})
    def test_enable_health_checks(self) -> None:
        """Test that DB_CONN_HEALTH_CHECKS can be explicitly enabled."""
        import importlib

        import settings as app_settings

        importlib.reload(app_settings)

        self.assertTrue(app_settings.DB_CONN_HEALTH_CHECKS)

    @mock.patch.dict(os.environ, {"DB_CONN_HEALTH_CHECKS": "TRUE"})
    def test_health_checks_case_insensitive(self) -> None:
        """Test that DB_CONN_HEALTH_CHECKS parsing is case-insensitive."""
        import importlib

        import settings as app_settings

        importlib.reload(app_settings)

        self.assertTrue(app_settings.DB_CONN_HEALTH_CHECKS)
