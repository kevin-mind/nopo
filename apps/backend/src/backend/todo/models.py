from django.db import models
from django.core.validators import MinLengthValidator
from datetime import datetime

from django.db.models.manager import Manager


class TodoItem(models.Model):
    """A single todo item with title, description, completion status, and timestamps."""

    title = models.CharField(
        max_length=200,
        validators=[MinLengthValidator(1)],
        help_text="Title of the todo item",
    )
    description = models.TextField(
        blank=True, null=True, help_text="Optional detailed description"
    )
    completed = models.BooleanField(
        default=False, help_text="Whether this todo item is completed"
    )
    created_at = models.DateTimeField(
        auto_now_add=True, help_text="When this todo item was created"
    )
    updated_at = models.DateTimeField(
        auto_now=True, help_text="When this todo item was last updated"
    )
    due_date = models.DateTimeField(
        blank=True, null=True, help_text="Optional due date for this todo item"
    )
    priority = models.CharField(
        max_length=10,
        choices=[
            ("low", "Low"),
            ("medium", "Medium"),
            ("high", "High"),
        ],
        default="medium",
        help_text="Priority level of this todo item",
    )

    objects: Manager["TodoItem"] = Manager()
    id: int

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["completed"]),
            models.Index(fields=["priority"]),
            models.Index(fields=["due_date"]),
        ]

    def __str__(self) -> str:
        status = "✓" if self.completed else "○"
        return f"{status} {self.title}"

    @property
    def is_overdue(self) -> bool:
        """Check if this todo item is overdue."""
        if not self.due_date or self.completed:
            return False
        return self.due_date < datetime.now().replace(tzinfo=self.due_date.tzinfo)
