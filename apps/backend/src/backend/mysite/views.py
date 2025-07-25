from django.conf import settings
from django.shortcuts import render
from django.utils import timezone
from django.http import JsonResponse
import django
from pathlib import Path
import json


def version(request):
    with open(Path("/build-info.json"), "r") as f:
        build_info = json.load(f)
    return JsonResponse(build_info)


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
