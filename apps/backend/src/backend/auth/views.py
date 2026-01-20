from rest_framework import status
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.request import Request
from django.contrib.auth import login, logout
from drf_spectacular.utils import extend_schema

from .serializers import LoginSerializer, UserSerializer


class LoginView(APIView):
    """API endpoint for user login."""

    @extend_schema(
        description="Authenticate a user and create a session",
        request=LoginSerializer,
        responses={
            200: {
                "type": "object",
                "properties": {
                    "message": {"type": "string"},
                    "user": {
                        "type": "object",
                        "properties": {
                            "id": {"type": "integer"},
                            "username": {"type": "string"},
                            "email": {"type": "string"},
                            "first_name": {"type": "string"},
                            "last_name": {"type": "string"},
                        },
                    },
                },
            },
            400: {
                "type": "object",
                "properties": {
                    "non_field_errors": {"type": "array", "items": {"type": "string"}},
                },
            },
        },
    )
    def post(self, request: Request) -> Response:
        """Handle user login."""
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        user = serializer.validated_data["user"]
        login(request, user)

        user_serializer = UserSerializer(user)
        return Response(
            {"message": "Login successful", "user": user_serializer.data},
            status=status.HTTP_200_OK,
        )


class LogoutView(APIView):
    """API endpoint for user logout."""

    @extend_schema(
        description="Log out the current user and destroy the session",
        request=None,
        responses={
            200: {
                "type": "object",
                "properties": {
                    "message": {"type": "string"},
                },
            },
        },
    )
    def post(self, request: Request) -> Response:
        """Handle user logout."""
        logout(request)
        return Response(
            {"message": "Logout successful"},
            status=status.HTTP_200_OK,
        )
