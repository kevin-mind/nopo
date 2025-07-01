from django.apps import AppConfig


class TodoConfig(AppConfig):
    """Configuration for the Todo app."""

    default_auto_field: str = "django.db.models.BigAutoField"
    name: str = "src.todo"
    verbose_name: str = "Todo Application"
