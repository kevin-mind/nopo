from django.contrib import admin
from .models import TodoItem


@admin.register(TodoItem)
class TodoItemAdmin(admin.ModelAdmin):
    """Admin interface for TodoItem model."""

    list_display = ("title", "priority", "completed", "due_date", "created_at")
    list_filter = ("completed", "priority", "created_at", "due_date")
    search_fields = ("title", "description")
    readonly_fields = ("created_at", "updated_at")
    list_editable = ("completed", "priority")
    date_hierarchy = "created_at"

    fieldsets = (
        ("Todo Details", {"fields": ("title", "description", "priority", "due_date")}),
        ("Status", {"fields": ("completed",)}),
        (
            "Timestamps",
            {"fields": ("created_at", "updated_at"), "classes": ("collapse",)},
        ),
    )
