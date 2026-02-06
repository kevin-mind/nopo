"""URL configuration for authentication."""

from django.urls import path
from .views import (
    UserRegistrationView,
    UserProfileView,
    TokenObtainView,
    TokenRefreshViewCustom,
)

app_name = "auth"

urlpatterns = [
    path("register/", UserRegistrationView.as_view(), name="register"),
    path("profile/", UserProfileView.as_view(), name="profile"),
    path("token/", TokenObtainView.as_view(), name="token_obtain"),
    path("token/refresh/", TokenRefreshViewCustom.as_view(), name="token_refresh"),
]
