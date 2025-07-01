"""
Business logic services for the Todo application.
"""

from typing import Dict, Any, List, Optional
from django.db.models import QuerySet, Q
from django.utils import timezone
from datetime import datetime, timedelta

from .models import TodoItem


class TodoService:
    """Service class containing business logic for Todo operations."""

    @staticmethod
    def get_overdue_items() -> QuerySet[TodoItem]:
        """Get all incomplete todo items that are past their due date."""
        return TodoItem.objects.filter(completed=False, due_date__lt=timezone.now())

    @staticmethod
    def get_upcoming_items(days: int = 7) -> QuerySet[TodoItem]:
        """Get incomplete todo items due within the specified number of days."""
        cutoff_date = timezone.now() + timedelta(days=days)
        return TodoItem.objects.filter(
            completed=False, due_date__lte=cutoff_date, due_date__gte=timezone.now()
        ).order_by("due_date")

    @staticmethod
    def get_priority_items(priority: str) -> QuerySet[TodoItem]:
        """Get all todo items of a specific priority."""
        return TodoItem.objects.filter(priority=priority)

    @staticmethod
    def search_items(query: str) -> QuerySet[TodoItem]:
        """Search todo items by title and description."""
        return TodoItem.objects.filter(
            Q(title__icontains=query) | Q(description__icontains=query)
        )

    @staticmethod
    def get_completion_stats() -> Dict[str, Any]:
        """Get comprehensive statistics about todo completion."""
        total = TodoItem.objects.count()
        completed = TodoItem.objects.filter(completed=True).count()
        incomplete = total - completed

        # Get overdue count
        overdue = TodoService.get_overdue_items().count()

        # Get priority breakdown
        priority_stats = {}
        priority_field = TodoItem._meta.get_field("priority")
        if hasattr(priority_field, 'choices') and priority_field.choices:
            for priority, _ in priority_field.choices:
                priority_stats[priority] = TodoItem.objects.filter(
                    priority=priority
                ).count()

        return {
            "total": total,
            "completed": completed,
            "incomplete": incomplete,
            "overdue": overdue,
            "completion_rate": (completed / total * 100) if total > 0 else 0,
            "by_priority": priority_stats,
        }

    @staticmethod
    def bulk_complete(item_ids: List[int]) -> int:
        """Mark multiple todo items as completed."""
        return TodoItem.objects.filter(id__in=item_ids, completed=False).update(
            completed=True
        )

    @staticmethod
    def bulk_delete_completed() -> int:
        """Delete all completed todo items."""
        deleted_count, _ = TodoItem.objects.filter(completed=True).delete()
        return deleted_count

    @staticmethod
    def create_todo_item(
        title: str,
        description: Optional[str] = None,
        priority: str = "medium",
        due_date: Optional[datetime] = None,
    ) -> TodoItem:
        """Create a new todo item with validation."""
        return TodoItem.objects.create(
            title=title.strip(),
            description=description,
            priority=priority,
            due_date=due_date,
        )

    @staticmethod
    def update_todo_item(item_id: int, **update_fields: Any) -> Optional[TodoItem]:
        """Update a todo item with the provided fields."""
        try:
            item = TodoItem.objects.get(id=item_id)
            for field, value in update_fields.items():
                if hasattr(item, field):
                    setattr(item, field, value)
            item.save()
            return item
        except TodoItem.DoesNotExist:
            return None

    @staticmethod
    def get_items_by_date_range(
        start_date: datetime, end_date: datetime
    ) -> QuerySet[TodoItem]:
        """Get todo items created within a date range."""
        return TodoItem.objects.filter(created_at__range=(start_date, end_date))

    @staticmethod
    def archive_old_completed_items(days_old: int = 30) -> int:
        """Archive (delete) completed items older than specified days."""
        cutoff_date = timezone.now() - timedelta(days=days_old)
        deleted_count, _ = TodoItem.objects.filter(
            completed=True, updated_at__lt=cutoff_date
        ).delete()
        return deleted_count
