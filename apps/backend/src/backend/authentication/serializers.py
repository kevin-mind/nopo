from rest_framework import serializers
from django.contrib.auth import authenticate
from django.contrib.auth.models import User


class UserSerializer(serializers.ModelSerializer):
    """Serializer for the User model (response only)."""

    class Meta:
        model = User
        fields = ["id", "username", "email", "first_name", "last_name"]
        read_only_fields = ["id", "username", "email", "first_name", "last_name"]


class LoginSerializer(serializers.Serializer):
    """Serializer for login request."""

    username = serializers.CharField(required=True)
    password = serializers.CharField(required=True, write_only=True)

    def validate(self, attrs: dict) -> dict:
        """Validate credentials and authenticate user."""
        username = attrs.get("username")
        password = attrs.get("password")

        user = authenticate(username=username, password=password)
        if user is None:
            raise serializers.ValidationError("Invalid username or password.")

        if not user.is_active:
            raise serializers.ValidationError("User account is disabled.")

        attrs["user"] = user
        return attrs
