from django.apps import AppConfig


class AuthConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "backend.auth"
    label = "backend_auth"  # Avoid conflict with django.contrib.auth
