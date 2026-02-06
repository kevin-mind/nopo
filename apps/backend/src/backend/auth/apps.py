"""App configuration for authentication."""

from django.apps import AppConfig


class AuthConfig(AppConfig):
    """Configuration for the auth app."""

    default_auto_field = "django.db.models.BigAutoField"
    name = "backend.auth"
