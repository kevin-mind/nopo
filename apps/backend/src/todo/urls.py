from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import TodoItemViewSet, todo_list_view

app_name = "todo"

# Create a router and register our viewset
router = DefaultRouter()
router.register(r"items", TodoItemViewSet, basename="todoitem")

urlpatterns = [
    path("list/", todo_list_view, name="todo_list"),
    path("", include(router.urls)),
]
