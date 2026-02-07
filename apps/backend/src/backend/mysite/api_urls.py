from django.urls import re_path, include
from drf_spectacular.views import (
    SpectacularAPIView,
    SpectacularSwaggerView,
    SpectacularRedocView,
)
from rest_framework_simplejwt.views import (
    TokenObtainPairView,
    TokenRefreshView,
    TokenVerifyView,
)
from rest_framework.permissions import AllowAny


# Create public versions of documentation views
class PublicSpectacularAPIView(SpectacularAPIView):
    permission_classes = [AllowAny]


class PublicSpectacularSwaggerView(SpectacularSwaggerView):
    permission_classes = [AllowAny]


class PublicSpectacularRedocView(SpectacularRedocView):
    permission_classes = [AllowAny]

urlpatterns = [
    # Authentication endpoints
    re_path(r"^auth/token$", TokenObtainPairView.as_view(), name="token_obtain_pair"),
    re_path(r"^auth/token/refresh$", TokenRefreshView.as_view(), name="token_refresh"),
    re_path(r"^auth/token/verify$", TokenVerifyView.as_view(), name="token_verify"),
    # Application endpoints
    re_path(r"^todo/", include("backend.todo.urls")),
    # API documentation (public access)
    re_path(r"^schema$", PublicSpectacularAPIView.as_view(), name="schema"),
    re_path(
        r"^docs$",
        PublicSpectacularSwaggerView.as_view(url_name="schema"),
        name="swagger-ui-no-slash",
    ),
    re_path(
        r"^redoc$", PublicSpectacularRedocView.as_view(url_name="schema"), name="redoc"
    ),
]
