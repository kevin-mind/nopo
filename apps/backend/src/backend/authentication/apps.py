from django.apps import AppConfig


class AuthenticationConfig(AppConfig):
    """Configuration for the Authentication app."""

    default_auto_field: str = "django.db.models.BigAutoField"
    name: str = "backend.authentication"
    verbose_name: str = "Authentication"
