from django.test import TestCase
from django.urls import reverse
from django.contrib.auth.models import User
from rest_framework.test import APITestCase
from rest_framework import status

from backend.authentication.serializers import LoginSerializer, UserSerializer


class UserSerializerTests(TestCase):
    """Test cases for UserSerializer."""

    def setUp(self) -> None:
        """Set up test data."""
        self.user = User.objects.create_user(
            username="testuser",
            email="test@example.com",
            password="testpass123",
            first_name="Test",
            last_name="User",
        )

    def test_user_serializer(self) -> None:
        """Test UserSerializer serializes user data correctly."""
        serializer = UserSerializer(self.user)
        data = serializer.data

        self.assertEqual(data["id"], self.user.id)
        self.assertEqual(data["username"], "testuser")
        self.assertEqual(data["email"], "test@example.com")
        self.assertEqual(data["first_name"], "Test")
        self.assertEqual(data["last_name"], "User")
        self.assertNotIn("password", data)


class LoginSerializerTests(TestCase):
    """Test cases for LoginSerializer."""

    def setUp(self) -> None:
        """Set up test data."""
        self.user = User.objects.create_user(
            username="testuser",
            email="test@example.com",
            password="testpass123",
        )

    def test_valid_credentials(self) -> None:
        """Test serializer validates correct credentials."""
        data = {"username": "testuser", "password": "testpass123"}
        serializer = LoginSerializer(data=data)
        self.assertTrue(serializer.is_valid())
        self.assertEqual(serializer.validated_data["user"], self.user)

    def test_invalid_password(self) -> None:
        """Test serializer rejects invalid password."""
        data = {"username": "testuser", "password": "wrongpassword"}
        serializer = LoginSerializer(data=data)
        self.assertFalse(serializer.is_valid())
        self.assertIn("non_field_errors", serializer.errors)

    def test_invalid_username(self) -> None:
        """Test serializer rejects invalid username."""
        data = {"username": "nonexistent", "password": "testpass123"}
        serializer = LoginSerializer(data=data)
        self.assertFalse(serializer.is_valid())
        self.assertIn("non_field_errors", serializer.errors)

    def test_missing_username(self) -> None:
        """Test serializer rejects missing username."""
        data = {"password": "testpass123"}
        serializer = LoginSerializer(data=data)
        self.assertFalse(serializer.is_valid())
        self.assertIn("username", serializer.errors)

    def test_missing_password(self) -> None:
        """Test serializer rejects missing password."""
        data = {"username": "testuser"}
        serializer = LoginSerializer(data=data)
        self.assertFalse(serializer.is_valid())
        self.assertIn("password", serializer.errors)

    def test_inactive_user(self) -> None:
        """Test serializer rejects inactive user."""
        self.user.is_active = False
        self.user.save()

        data = {"username": "testuser", "password": "testpass123"}
        serializer = LoginSerializer(data=data)
        self.assertFalse(serializer.is_valid())
        self.assertIn("non_field_errors", serializer.errors)


class AuthAPITests(APITestCase):
    """Test cases for authentication API endpoints."""

    def setUp(self) -> None:
        """Set up test data."""
        self.user = User.objects.create_user(
            username="testuser",
            email="test@example.com",
            password="testpass123",
            first_name="Test",
            last_name="User",
        )

    def test_login_success(self) -> None:
        """Test POST /api/auth/login with valid credentials."""
        url = reverse("authentication:login")
        data = {"username": "testuser", "password": "testpass123"}
        response = self.client.post(url, data, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        response_data = response.json()
        self.assertEqual(response_data["username"], "testuser")
        self.assertEqual(response_data["email"], "test@example.com")
        self.assertEqual(response_data["first_name"], "Test")
        self.assertEqual(response_data["last_name"], "User")
        self.assertIn("id", response_data)
        self.assertNotIn("password", response_data)

    def test_login_invalid_credentials(self) -> None:
        """Test POST /api/auth/login with invalid credentials."""
        url = reverse("authentication:login")
        data = {"username": "testuser", "password": "wrongpassword"}
        response = self.client.post(url, data, format="json")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_login_missing_fields(self) -> None:
        """Test POST /api/auth/login with missing fields."""
        url = reverse("authentication:login")

        # Missing password
        response = self.client.post(url, {"username": "testuser"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        # Missing username
        response = self.client.post(url, {"password": "testpass123"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_login_inactive_user(self) -> None:
        """Test POST /api/auth/login with inactive user."""
        self.user.is_active = False
        self.user.save()

        url = reverse("authentication:login")
        data = {"username": "testuser", "password": "testpass123"}
        response = self.client.post(url, data, format="json")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_logout_success(self) -> None:
        """Test POST /api/auth/logout."""
        # First login
        login_url = reverse("authentication:login")
        self.client.post(
            login_url, {"username": "testuser", "password": "testpass123"}, format="json"
        )

        # Then logout
        url = reverse("authentication:logout")
        response = self.client.post(url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        response_data = response.json()
        self.assertEqual(response_data["detail"], "Successfully logged out.")

    def test_logout_without_login(self) -> None:
        """Test POST /api/auth/logout without being logged in."""
        url = reverse("authentication:logout")
        response = self.client.post(url)

        # Should still succeed (no error for logging out when not logged in)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
