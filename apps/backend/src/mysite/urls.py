from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.http import HttpResponse
from django.shortcuts import render
from django.utils import timezone
import django
from drf_spectacular.views import (
    SpectacularAPIView,
    SpectacularSwaggerView,
    SpectacularRedocView,
)


def home(request):
    """
    Home view that demonstrates Jinja2 templating with partials and data passing.
    """
    print(f"host: {request.get_host()}")

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


def version(request):
    with open("/build-info.json") as file:
        return HttpResponse(file.read(), content_type="application/json")


base_path = f"{settings.SERVICE_PUBLIC_PATH.strip('/')}/"

urlpatterns = [
    path("__version__", version),
    path(
        base_path,
        include(
            [
                path("admin/", admin.site.urls),
                path("", home, name="home"),
                path("todo/", include("src.todo.urls")),
                path("schema/", SpectacularAPIView.as_view(), name="schema"),
                path(
                    "docs/",
                    SpectacularSwaggerView.as_view(url_name="schema"),
                    name="swagger-ui",
                ),
                path(
                    "redoc/",
                    SpectacularRedocView.as_view(url_name="schema"),
                    name="redoc",
                ),
            ]
        ),
    ),
]
