from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework.request import Request
from django.contrib.auth import login, logout
from drf_spectacular.utils import extend_schema

from .serializers import LoginSerializer, UserSerializer


@extend_schema(
    description="Authenticate user with username and password",
    request=LoginSerializer,
    responses={
        200: UserSerializer,
        400: {"type": "object", "properties": {"detail": {"type": "string"}}},
    },
)
@api_view(["POST"])
def login_view(request: Request) -> Response:
    """
    Login endpoint.

    Authenticates user credentials and creates a session.
    Returns user information on success.
    """
    serializer = LoginSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    user = serializer.validated_data["user"]
    login(request._request, user)

    user_serializer = UserSerializer(user)
    return Response(user_serializer.data, status=status.HTTP_200_OK)


@extend_schema(
    description="Logout the current user and invalidate the session",
    request=None,
    responses={
        200: {"type": "object", "properties": {"detail": {"type": "string"}}},
    },
)
@api_view(["POST"])
def logout_view(request: Request) -> Response:
    """
    Logout endpoint.

    Invalidates the current session and logs out the user.
    """
    logout(request._request)
    return Response({"detail": "Successfully logged out."}, status=status.HTTP_200_OK)
