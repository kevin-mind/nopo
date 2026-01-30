# E2E automation validation: test comment added successfully
from rest_framework import serializers
from .models import TodoItem
from typing import Dict, Any
from datetime import datetime


class TodoItemSerializer(serializers.ModelSerializer):
    """Serializer for TodoItem model with full CRUD operations."""

    is_overdue = serializers.ReadOnlyField()

    class Meta:
        model = TodoItem
        fields = [
            "id",
            "title",
            "description",
            "completed",
            "priority",
            "due_date",
            "created_at",
            "updated_at",
            "is_overdue",
        ]
        read_only_fields = ["id", "created_at", "updated_at", "is_overdue"]

    def validate_title(self, value: str) -> str:
        """Validate that title is not empty after stripping whitespace."""
        if not value.strip():
            raise serializers.ValidationError("Title cannot be empty.")
        return value.strip()

    def validate_due_date(self, value: datetime | None) -> datetime | None:
        """Validate that due_date is not in the past (for new items)."""
        if value and not self.instance:  # Only validate for new items
            if value < datetime.now().replace(tzinfo=value.tzinfo):
                raise serializers.ValidationError("Due date cannot be in the past.")
        return value


class TodoItemCreateSerializer(TodoItemSerializer):
    """Specialized serializer for creating TodoItems."""

    class Meta(TodoItemSerializer.Meta):
        fields = ["title", "description", "priority", "due_date"]


class TodoItemUpdateSerializer(TodoItemSerializer):
    """Specialized serializer for updating TodoItems."""

    title = serializers.CharField(required=False, max_length=200)

    class Meta(TodoItemSerializer.Meta):
        fields = ["title", "description", "completed", "priority", "due_date"]

    def validate(self, attrs: Dict[str, Any]) -> Dict[str, Any]:
        """Custom validation for updates."""
        if "title" in attrs:
            attrs["title"] = self.validate_title(attrs["title"])
        return attrs
