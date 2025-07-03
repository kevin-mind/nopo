from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.http import HttpResponse
from django.shortcuts import render
from drf_spectacular.views import (
    SpectacularAPIView,
    SpectacularSwaggerView,
    SpectacularRedocView,
)


def home(request):
    print(f"host: {request.get_host()}")
    return render(
        request,
        "base.html",
        {
            "title": "Web Components Demo",
        },
    )


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
