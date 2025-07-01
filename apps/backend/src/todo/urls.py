from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import TodoItemViewSet

app_name = "todo"

# Create a router and register our viewset
router = DefaultRouter()
router.register(r"items", TodoItemViewSet, basename="todoitem")

urlpatterns = [
    path("", include(router.urls)),
]
