from django.urls import re_path, include
from drf_spectacular.views import (
    SpectacularAPIView,
    SpectacularSwaggerView,
    SpectacularRedocView,
)

urlpatterns = [
    re_path(r"^auth/", include("backend.authentication.urls")),
    re_path(r"^todo/", include("backend.todo.urls")),
    re_path(r"^schema$", SpectacularAPIView.as_view(), name="schema"),
    re_path(
        r"^docs$",
        SpectacularSwaggerView.as_view(url_name="schema"),
        name="swagger-ui-no-slash",
    ),
    re_path(r"^redoc$", SpectacularRedocView.as_view(url_name="schema"), name="redoc"),
]
