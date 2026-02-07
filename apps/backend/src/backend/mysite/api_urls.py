from django.urls import re_path, include
from drf_spectacular.views import (
    SpectacularAPIView,
    SpectacularSwaggerView,
    SpectacularRedocView,
)
from rest_framework_simplejwt.views import (
    TokenObtainPairView,
    TokenRefreshView,
)

urlpatterns = [
    re_path(r"^auth/token$", TokenObtainPairView.as_view(), name="token_obtain_pair"),
    re_path(r"^auth/token/refresh$", TokenRefreshView.as_view(), name="token_refresh"),
    re_path(r"^todo/", include("backend.todo.urls")),
    re_path(r"^schema$", SpectacularAPIView.as_view(), name="schema"),
    re_path(
        r"^docs$",
        SpectacularSwaggerView.as_view(url_name="schema"),
        name="swagger-ui-no-slash",
    ),
    re_path(r"^redoc$", SpectacularRedocView.as_view(url_name="schema"), name="redoc"),
]
