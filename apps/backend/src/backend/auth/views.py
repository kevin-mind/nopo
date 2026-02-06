"""Views for authentication."""

from rest_framework import generics, permissions, status
from rest_framework.response import Response
from rest_framework.request import Request
from django.contrib.auth import get_user_model
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from .serializers import UserSerializer, UserRegistrationSerializer

User = get_user_model()


class UserRegistrationView(generics.CreateAPIView):
    """View for user registration."""

    queryset = User.objects.all()
    serializer_class = UserRegistrationSerializer
    permission_classes = [permissions.AllowAny]


class UserProfileView(generics.RetrieveUpdateAPIView):
    """View for retrieving and updating user profile."""

    serializer_class = UserSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_object(self) -> User:
        """Return the authenticated user."""
        return self.request.user


class TokenObtainView(TokenObtainPairView):
    """View for obtaining JWT tokens."""

    permission_classes = [permissions.AllowAny]


class TokenRefreshViewCustom(TokenRefreshView):
    """View for refreshing JWT tokens."""

    permission_classes = [permissions.AllowAny]
