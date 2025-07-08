from rest_framework import viewsets, status, filters
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.request import Request
from django_filters.rest_framework import DjangoFilterBackend
from drf_spectacular.utils import extend_schema, extend_schema_view, OpenApiParameter
from drf_spectacular.types import OpenApiTypes
from typing import Dict, Any, Optional
from django.shortcuts import render
from django.http import HttpRequest, HttpResponse

from .models import TodoItem
from .serializers import (
    TodoItemSerializer,
    TodoItemCreateSerializer,
    TodoItemUpdateSerializer,
)


@extend_schema_view(
    list=extend_schema(
        description="List all todo items with filtering and search capabilities",
        parameters=[
            OpenApiParameter(
                name="completed",
                type=OpenApiTypes.BOOL,
                description="Filter by completion status",
            ),
            OpenApiParameter(
                name="priority",
                type=OpenApiTypes.STR,
                description="Filter by priority (low, medium, high)",
            ),
            OpenApiParameter(
                name="search",
                type=OpenApiTypes.STR,
                description="Search in title and description",
            ),
            OpenApiParameter(
                name="ordering",
                type=OpenApiTypes.STR,
                description="Order by field (prefix with - for descending)",
            ),
        ],
    ),
    create=extend_schema(
        description="Create a new todo item",
        request=TodoItemCreateSerializer,
        responses={201: TodoItemSerializer},
    ),
    retrieve=extend_schema(description="Get a specific todo item"),
    update=extend_schema(
        description="Update a todo item",
        request=TodoItemUpdateSerializer,
        responses={200: TodoItemSerializer},
    ),
    partial_update=extend_schema(
        description="Partially update a todo item",
        request=TodoItemUpdateSerializer,
        responses={200: TodoItemSerializer},
    ),
    destroy=extend_schema(description="Delete a todo item"),
)
class TodoItemViewSet(viewsets.ModelViewSet):
    """
    ViewSet for managing TodoItem instances.

    Provides CRUD operations plus additional actions for todo management.
    """

    queryset = TodoItem.objects.all()
    serializer_class = TodoItemSerializer
    filter_backends = [
        DjangoFilterBackend,
        filters.SearchFilter,
        filters.OrderingFilter,
    ]
    filterset_fields = ["completed", "priority"]
    search_fields = ["title", "description"]
    ordering_fields = ["created_at", "updated_at", "due_date", "priority", "title"]
    ordering = ["-created_at"]

    def get_serializer_class(self):
        """Return appropriate serializer class based on action."""
        if self.action == "create":
            return TodoItemCreateSerializer
        elif self.action in ["update", "partial_update"]:
            return TodoItemUpdateSerializer
        return TodoItemSerializer

    def create(self, request: Request, *args, **kwargs) -> Response:
        """Create a new todo item and return full representation."""
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        instance = serializer.save()

        # Return the full representation using TodoItemSerializer
        response_serializer = TodoItemSerializer(instance)
        return Response(response_serializer.data, status=status.HTTP_201_CREATED)

    @extend_schema(
        description="Mark a todo item as completed",
        request=None,
        responses={200: TodoItemSerializer},
    )
    @action(detail=True, methods=["post"])
    def complete(self, request: Request, pk: Optional[str] = None) -> Response:
        """Mark a todo item as completed."""
        todo_item = self.get_object()
        todo_item.completed = True
        todo_item.save(update_fields=["completed", "updated_at"])
        serializer = self.get_serializer(todo_item)
        return Response(serializer.data)

    @extend_schema(
        description="Mark a todo item as incomplete",
        request=None,
        responses={200: TodoItemSerializer},
    )
    @action(detail=True, methods=["post"])
    def uncomplete(self, request: Request, pk: Optional[str] = None) -> Response:
        """Mark a todo item as incomplete."""
        todo_item = self.get_object()
        todo_item.completed = False
        todo_item.save(update_fields=["completed", "updated_at"])
        serializer = self.get_serializer(todo_item)
        return Response(serializer.data)

    @extend_schema(
        description="Get statistics about todo items",
        request=None,
        responses={
            200: {
                "type": "object",
                "properties": {
                    "total": {"type": "integer"},
                    "completed": {"type": "integer"},
                    "incomplete": {"type": "integer"},
                    "overdue": {"type": "integer"},
                    "by_priority": {
                        "type": "object",
                        "properties": {
                            "low": {"type": "integer"},
                            "medium": {"type": "integer"},
                            "high": {"type": "integer"},
                        },
                    },
                },
            }
        },
    )
    @action(detail=False, methods=["get"])
    def stats(self, request: Request) -> Response:
        """Get statistics about todo items."""
        queryset = self.get_queryset()

        stats_data: Dict[str, Any] = {
            "total": queryset.count(),
            "completed": queryset.filter(completed=True).count(),
            "incomplete": queryset.filter(completed=False).count(),
            "overdue": sum(
                1 for item in queryset.filter(completed=False) if item.is_overdue
            ),
            "by_priority": {
                "low": queryset.filter(priority="low").count(),
                "medium": queryset.filter(priority="medium").count(),
                "high": queryset.filter(priority="high").count(),
            },
        }

        return Response(stats_data)

    @extend_schema(
        description="Mark all incomplete todo items as completed",
        request=None,
        responses={
            200: {
                "type": "object",
                "properties": {
                    "updated_count": {"type": "integer"},
                    "message": {"type": "string"},
                },
            }
        },
    )
    @action(detail=False, methods=["post"])
    def complete_all(self, request: Request) -> Response:
        """Mark all incomplete todo items as completed."""
        updated_count = TodoItem.objects.filter(completed=False).update(completed=True)
        return Response(
            {
                "updated_count": updated_count,
                "message": f"Marked {updated_count} items as completed",
            }
        )

    @extend_schema(
        description="Delete all completed todo items",
        request=None,
        responses={
            200: {
                "type": "object",
                "properties": {
                    "deleted_count": {"type": "integer"},
                    "message": {"type": "string"},
                },
            }
        },
    )
    @action(detail=False, methods=["delete"])
    def clear_completed(self, request: Request) -> Response:
        """Delete all completed todo items."""
        deleted_count, _ = TodoItem.objects.filter(completed=True).delete()
        return Response(
            {
                "deleted_count": deleted_count,
                "message": f"Deleted {deleted_count} completed items",
            }
        )


def todo_list_view(request: HttpRequest) -> HttpResponse:
    """
    Basic Django template view for displaying todos with Tailwind styling.
    This is a read-only version to demonstrate shared state across apps.
    """
    # Get todos with basic filtering
    todos = TodoItem.objects.all().order_by('-created_at')

    # Apply simple filtering
    filter_completed = request.GET.get('completed')
    filter_priority = request.GET.get('priority')

    if filter_completed is not None:
        todos = todos.filter(completed=filter_completed.lower() == 'true')

    if filter_priority and filter_priority != 'all':
        todos = todos.filter(priority=filter_priority)

    # Calculate stats
    all_todos = TodoItem.objects.all()
    stats = {
        'total': all_todos.count(),
        'completed': all_todos.filter(completed=True).count(),
        'incomplete': all_todos.filter(completed=False).count(),
        'overdue': sum(1 for todo in all_todos.filter(completed=False) if todo.is_overdue),
        'by_priority': {
            'low': all_todos.filter(priority='low').count(),
            'medium': all_todos.filter(priority='medium').count(),
            'high': all_todos.filter(priority='high').count(),
        }
    }

    # Separate todos by completion status
    active_todos = [todo for todo in todos if not todo.completed]
    completed_todos = [todo for todo in todos if todo.completed]

    context = {
        'todos': todos,
        'active_todos': active_todos,
        'completed_todos': completed_todos,
        'stats': stats,
        'current_filter': {
            'completed': filter_completed,
            'priority': filter_priority or 'all',
        },
        'priorities': ['low', 'medium', 'high'],
    }

    return render(request, 'todo/todo_list.html', context)
