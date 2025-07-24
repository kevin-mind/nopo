from django.test import TestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase
from rest_framework import status
from datetime import timedelta

from backend.todo.models import TodoItem
from backend.todo.serializers import (
    TodoItemSerializer,
    TodoItemCreateSerializer,
    TodoItemUpdateSerializer,
)


class TodoItemModelTests(TestCase):
    """Test cases for the TodoItem model."""

    def setUp(self) -> None:
        """Set up test data."""
        self.todo_item = TodoItem.objects.create(
            title="Test Todo", description="Test description", priority="high"
        )

    def test_todo_item_creation(self) -> None:
        """Test that a TodoItem can be created successfully."""
        self.assertEqual(self.todo_item.title, "Test Todo")
        self.assertEqual(self.todo_item.description, "Test description")
        self.assertEqual(self.todo_item.priority, "high")
        self.assertFalse(self.todo_item.completed)
        self.assertIsNotNone(self.todo_item.created_at)
        self.assertIsNotNone(self.todo_item.updated_at)

    def test_todo_item_str_method(self) -> None:
        """Test the string representation of TodoItem."""
        expected = "○ Test Todo"
        self.assertEqual(str(self.todo_item), expected)

        # Test completed todo
        self.todo_item.completed = True
        self.todo_item.save()
        expected_completed = "✓ Test Todo"
        self.assertEqual(str(self.todo_item), expected_completed)

    def test_is_overdue_property(self) -> None:
        """Test the is_overdue property."""
        # No due date should not be overdue
        self.assertFalse(self.todo_item.is_overdue)

        # Future due date should not be overdue
        future_date = timezone.now() + timedelta(days=1)
        self.todo_item.due_date = future_date
        self.todo_item.save()
        self.assertFalse(self.todo_item.is_overdue)

        # Past due date should be overdue
        past_date = timezone.now() - timedelta(days=1)
        self.todo_item.due_date = past_date
        self.todo_item.save()
        self.assertTrue(self.todo_item.is_overdue)

        # Completed items should not be overdue
        self.todo_item.completed = True
        self.todo_item.save()
        self.assertFalse(self.todo_item.is_overdue)

    def test_model_ordering(self) -> None:
        """Test that TodoItems are ordered by creation date (newest first)."""
        older_todo = TodoItem.objects.create(title="Older Todo")
        newer_todo = TodoItem.objects.create(title="Newer Todo")

        todos = list(TodoItem.objects.all())
        self.assertEqual(todos[0], newer_todo)
        self.assertEqual(todos[1], older_todo)

    def test_model_validation(self) -> None:
        """Test model field validation."""
        # Test title max length
        long_title = "x" * 201
        todo = TodoItem(title=long_title)
        with self.assertRaises(Exception):
            todo.full_clean()

    def test_priority_choices(self) -> None:
        """Test priority field choices."""
        valid_priorities = ["low", "medium", "high"]
        for priority in valid_priorities:
            todo = TodoItem.objects.create(title=f"Todo {priority}", priority=priority)
            self.assertEqual(todo.priority, priority)


class TodoItemSerializerTests(TestCase):
    """Test cases for TodoItem serializers."""

    def setUp(self) -> None:
        """Set up test data."""
        self.todo_item = TodoItem.objects.create(
            title="Test Todo", description="Test description", priority="medium"
        )

    def test_todo_item_serializer(self) -> None:
        """Test TodoItemSerializer serialization."""
        serializer = TodoItemSerializer(self.todo_item)
        data = serializer.data

        self.assertEqual(data["title"], "Test Todo")
        self.assertEqual(data["description"], "Test description")
        self.assertEqual(data["priority"], "medium")
        self.assertFalse(data["completed"])
        self.assertIn("id", data)
        self.assertIn("created_at", data)
        self.assertIn("updated_at", data)
        self.assertIn("is_overdue", data)

    def test_todo_item_create_serializer(self) -> None:
        """Test TodoItemCreateSerializer."""
        data = {
            "title": "New Todo",
            "description": "New description",
            "priority": "high",
        }
        serializer = TodoItemCreateSerializer(data=data)
        self.assertTrue(serializer.is_valid())

        todo = serializer.save()
        self.assertEqual(todo.title, "New Todo")
        self.assertEqual(todo.description, "New description")
        self.assertEqual(todo.priority, "high")
        self.assertFalse(todo.completed)

    def test_todo_item_update_serializer(self) -> None:
        """Test TodoItemUpdateSerializer."""
        data = {"title": "Updated Todo", "completed": True}
        serializer = TodoItemUpdateSerializer(self.todo_item, data=data, partial=True)
        self.assertTrue(serializer.is_valid())

        updated_todo = serializer.save()
        self.assertEqual(updated_todo.title, "Updated Todo")
        self.assertTrue(updated_todo.completed)

    def test_serializer_validation(self) -> None:
        """Test serializer validation."""
        # Test empty title validation
        data = {"title": "   "}
        serializer = TodoItemCreateSerializer(data=data)
        self.assertFalse(serializer.is_valid())
        self.assertIn("title", serializer.errors)

    def test_due_date_validation(self) -> None:
        """Test due date validation for new items."""
        # Past due date should be invalid for new items
        past_date = timezone.now() - timedelta(days=1)
        data = {"title": "New Todo", "due_date": past_date.isoformat()}
        serializer = TodoItemCreateSerializer(data=data)
        self.assertFalse(serializer.is_valid())
        self.assertIn("due_date", serializer.errors)


class TodoItemAPITests(APITestCase):
    """Test cases for TodoItem API endpoints."""

    def setUp(self) -> None:
        """Set up test data."""
        self.todo1 = TodoItem.objects.create(
            title="Todo 1", description="Description 1", priority="high"
        )
        self.todo2 = TodoItem.objects.create(
            title="Todo 2", description="Description 2", priority="low", completed=True
        )

    def test_list_todo_items(self) -> None:
        """Test GET /api/todo/items/"""
        url = reverse("todo:todoitem-list")
        response = self.client.get(url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertIn("results", data)
        self.assertEqual(len(data["results"]), 2)

    def test_create_todo_item(self) -> None:
        """Test POST /api/todo/items/"""
        url = reverse("todo:todoitem-list")
        data = {
            "title": "New Todo",
            "description": "New description",
            "priority": "medium",
        }
        response = self.client.post(url, data, format="json")

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        response_data = response.json()
        self.assertEqual(response_data["title"], "New Todo")
        self.assertEqual(response_data["description"], "New description")
        self.assertEqual(response_data["priority"], "medium")
        self.assertFalse(response_data["completed"])

    def test_retrieve_todo_item(self) -> None:
        """Test GET /api/todo/items/{id}/"""
        url = reverse("todo:todoitem-detail", kwargs={"pk": self.todo1.pk})
        response = self.client.get(url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertEqual(data["title"], self.todo1.title)
        self.assertEqual(data["id"], self.todo1.id)

    def test_update_todo_item(self) -> None:
        """Test PUT /api/todo/items/{id}/"""
        url = reverse("todo:todoitem-detail", kwargs={"pk": self.todo1.pk})
        data = {
            "title": "Updated Todo",
            "description": "Updated description",
            "priority": "low",
            "completed": True,
        }
        response = self.client.put(url, data, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        response_data = response.json()
        self.assertEqual(response_data["title"], "Updated Todo")
        self.assertTrue(response_data["completed"])

    def test_partial_update_todo_item(self) -> None:
        """Test PATCH /api/todo/items/{id}/"""
        url = reverse("todo:todoitem-detail", kwargs={"pk": self.todo1.pk})
        data = {"completed": True}
        response = self.client.patch(url, data, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        response_data = response.json()
        self.assertTrue(response_data["completed"])
        self.assertEqual(
            response_data["title"], self.todo1.title
        )  # Should remain unchanged

    def test_delete_todo_item(self) -> None:
        """Test DELETE /api/todo/items/{id}/"""
        url = reverse("todo:todoitem-detail", kwargs={"pk": self.todo1.pk})
        response = self.client.delete(url)

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(TodoItem.objects.filter(pk=self.todo1.pk).exists())

    def test_complete_action(self) -> None:
        """Test POST /api/todo/items/{id}/complete/"""
        url = reverse("todo:todoitem-complete", kwargs={"pk": self.todo1.pk})
        response = self.client.post(url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        response_data = response.json()
        self.assertTrue(response_data["completed"])

        # Verify in database
        self.todo1.refresh_from_db()
        self.assertTrue(self.todo1.completed)

    def test_uncomplete_action(self) -> None:
        """Test POST /api/todo/items/{id}/uncomplete/"""
        url = reverse("todo:todoitem-uncomplete", kwargs={"pk": self.todo2.pk})
        response = self.client.post(url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        response_data = response.json()
        self.assertFalse(response_data["completed"])

        # Verify in database
        self.todo2.refresh_from_db()
        self.assertFalse(self.todo2.completed)

    def test_stats_action(self) -> None:
        """Test GET /api/todo/items/stats/"""
        url = reverse("todo:todoitem-stats")
        response = self.client.get(url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()

        expected_stats = {
            "total": 2,
            "completed": 1,
            "incomplete": 1,
            "overdue": 0,
            "by_priority": {"low": 1, "medium": 0, "high": 1},
        }
        self.assertEqual(data, expected_stats)

    def test_complete_all_action(self) -> None:
        """Test POST /api/todo/items/complete_all/"""
        url = reverse("todo:todoitem-complete-all")
        response = self.client.post(url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertEqual(data["updated_count"], 1)  # Only one incomplete item

        # Verify all items are completed
        incomplete_count = TodoItem.objects.filter(completed=False).count()
        self.assertEqual(incomplete_count, 0)

    def test_clear_completed_action(self) -> None:
        """Test DELETE /api/todo/items/clear_completed/"""
        url = reverse("todo:todoitem-clear-completed")
        response = self.client.delete(url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertEqual(data["deleted_count"], 1)  # Only one completed item

        # Verify completed items are deleted
        completed_count = TodoItem.objects.filter(completed=True).count()
        self.assertEqual(completed_count, 0)

    def test_filtering(self) -> None:
        """Test filtering functionality."""
        url = reverse("todo:todoitem-list")

        # Filter by completed status
        response = self.client.get(url, {"completed": "true"})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertEqual(len(data["results"]), 1)
        self.assertTrue(data["results"][0]["completed"])

        # Filter by priority
        response = self.client.get(url, {"priority": "high"})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertEqual(len(data["results"]), 1)
        self.assertEqual(data["results"][0]["priority"], "high")

    def test_searching(self) -> None:
        """Test search functionality."""
        url = reverse("todo:todoitem-list")

        # Search in title
        response = self.client.get(url, {"search": "Todo 1"})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertEqual(len(data["results"]), 1)
        self.assertEqual(data["results"][0]["title"], "Todo 1")

    def test_ordering(self) -> None:
        """Test ordering functionality."""
        url = reverse("todo:todoitem-list")

        # Order by priority
        response = self.client.get(url, {"ordering": "priority"})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        priorities = [item["priority"] for item in data["results"]]
        self.assertEqual(priorities, ["high", "low"])

    def test_invalid_data_handling(self) -> None:
        """Test handling of invalid data."""
        url = reverse("todo:todoitem-list")

        # Missing required title
        data = {"description": "No title provided"}
        response = self.client.post(url, data, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        # Empty title
        data = {"title": ""}
        response = self.client.post(url, data, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_nonexistent_item(self) -> None:
        """Test accessing non-existent todo item."""
        url = reverse("todo:todoitem-detail", kwargs={"pk": 99999})
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
