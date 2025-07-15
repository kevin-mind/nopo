from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.shortcuts import render
from django.utils import timezone
import django
from drf_spectacular.views import (
    SpectacularAPIView,
    SpectacularSwaggerView,
    SpectacularRedocView,
)
from django.urls import re_path


def home(request):
    """
    Home view that demonstrates Jinja2 templating with partials and data passing.
    """

    # Sample data to demonstrate passing data to partials
    sample_user_data = {
        "name": "John Doe",
        "role": "Developer",
        "last_login": "2024-01-15 14:30:00",
        "preferences": {"theme": "dark", "language": "English"},
        "stats": {
            "projects_completed": 12,
            "tasks_today": 5,
            "total_commits": 347,
            "code_reviews": 23,
        },
    }

    context = {
        "django_version": django.get_version(),
        "current_time": timezone.now(),
        "environment": "Development" if settings.DEBUG else "Production",
        "user_data": sample_user_data,
        "title": "Sample User Dashboard",
        "additional_info": "This data is passed from the Django view to demonstrate partial template functionality.",
    }

    return render(request, "home.html", context)


api_urls = [
    re_path(r"^todo/", include("src.todo.urls")),
    re_path(r"^schema$", SpectacularAPIView.as_view(), name="schema"),
    re_path(
        r"^docs$",
        SpectacularSwaggerView.as_view(url_name="schema"),
        name="swagger-ui-no-slash",
    ),
    re_path(
        r"^redoc$",
        SpectacularRedocView.as_view(url_name="schema"),
        name="redoc",
    ),
]

urlpatterns = [
    path("django", home),
    path("admin/", admin.site.urls),
    path("api/", include(api_urls)),
]
