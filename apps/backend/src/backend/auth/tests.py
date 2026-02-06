"""Tests for authentication."""

from django.test import TestCase
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework import status

User = get_user_model()


class UserRegistrationTests(TestCase):
    """Tests for user registration."""

    def setUp(self) -> None:
        """Set up test client."""
        self.client = APIClient()
        self.registration_url = "/api/auth/register/"

    def test_register_user_success(self) -> None:
        """Test successful user registration."""
        data = {
            "username": "testuser",
            "email": "test@example.com",
            "password": "testpass123",
            "password_confirm": "testpass123",
            "first_name": "Test",
            "last_name": "User",
        }
        response = self.client.post(self.registration_url, data, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(User.objects.filter(username="testuser").exists())

    def test_register_user_password_mismatch(self) -> None:
        """Test registration fails with mismatched passwords."""
        data = {
            "username": "testuser",
            "email": "test@example.com",
            "password": "testpass123",
            "password_confirm": "differentpass",
        }
        response = self.client.post(self.registration_url, data, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class TokenObtainTests(TestCase):
    """Tests for JWT token obtain."""

    def setUp(self) -> None:
        """Set up test user and client."""
        self.client = APIClient()
        self.token_url = "/api/auth/token/"
        self.user = User.objects.create_user(
            username="testuser",
            email="test@example.com",
            password="testpass123",
        )

    def test_obtain_token_success(self) -> None:
        """Test successful token obtain."""
        data = {
            "username": "testuser",
            "password": "testpass123",
        }
        response = self.client.post(self.token_url, data, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("access", response.data)
        self.assertIn("refresh", response.data)

    def test_obtain_token_invalid_credentials(self) -> None:
        """Test token obtain fails with invalid credentials."""
        data = {
            "username": "testuser",
            "password": "wrongpassword",
        }
        response = self.client.post(self.token_url, data, format="json")
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)


class UserProfileTests(TestCase):
    """Tests for user profile."""

    def setUp(self) -> None:
        """Set up test user and client."""
        self.client = APIClient()
        self.profile_url = "/api/auth/profile/"
        self.user = User.objects.create_user(
            username="testuser",
            email="test@example.com",
            password="testpass123",
        )

    def test_get_profile_authenticated(self) -> None:
        """Test getting profile when authenticated."""
        self.client.force_authenticate(user=self.user)
        response = self.client.get(self.profile_url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["username"], "testuser")

    def test_get_profile_unauthenticated(self) -> None:
        """Test getting profile when not authenticated."""
        response = self.client.get(self.profile_url)
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
