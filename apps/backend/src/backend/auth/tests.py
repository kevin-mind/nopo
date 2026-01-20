"""
Tests for session management.
"""

from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APITestCase

from .session_storage import (
    REFRESH_THRESHOLD,
    create_session,
    delete_session,
    get_session,
    get_session_expiry,
    get_session_user_id,
    is_session_valid,
    refresh_session,
)


class SessionStorageTests(TestCase):
    """Tests for session storage functions."""

    def test_create_session_returns_session_key(self):
        """Creating a session returns a session key."""
        session_key = create_session(user_id=1)
        self.assertIsNotNone(session_key)
        self.assertIsInstance(session_key, str)
        self.assertTrue(len(session_key) > 0)

    def test_create_session_stores_user_id(self):
        """Creating a session stores the user ID."""
        session_key = create_session(user_id=42)
        user_id = get_session_user_id(session_key)
        self.assertEqual(user_id, 42)

    def test_create_session_with_additional_data(self):
        """Creating a session can store additional data."""
        session_key = create_session(user_id=1, data={"role": "admin"})
        session = get_session(session_key)
        self.assertIsNotNone(session)
        assert session is not None  # For type checker
        self.assertEqual(session.get("role"), "admin")

    def test_get_session_returns_none_for_invalid_key(self):
        """Getting a session with invalid key returns None."""
        session = get_session("invalid-key")
        self.assertIsNone(session)

    def test_get_session_returns_none_for_empty_key(self):
        """Getting a session with empty key returns None."""
        session = get_session("")
        self.assertIsNone(session)

    def test_get_session_user_id_returns_none_for_invalid_key(self):
        """Getting user ID for invalid session returns None."""
        user_id = get_session_user_id("invalid-key")
        self.assertIsNone(user_id)

    def test_delete_session_removes_session(self):
        """Deleting a session removes it."""
        session_key = create_session(user_id=1)
        self.assertTrue(is_session_valid(session_key))

        result = delete_session(session_key)
        self.assertTrue(result)
        self.assertFalse(is_session_valid(session_key))

    def test_delete_session_returns_false_for_invalid_key(self):
        """Deleting non-existent session returns False."""
        result = delete_session("invalid-key")
        self.assertFalse(result)

    def test_is_session_valid_returns_true_for_valid_session(self):
        """is_session_valid returns True for valid session."""
        session_key = create_session(user_id=1)
        self.assertTrue(is_session_valid(session_key))

    def test_is_session_valid_returns_false_for_invalid_session(self):
        """is_session_valid returns False for invalid session."""
        self.assertFalse(is_session_valid("invalid-key"))

    def test_get_session_expiry_returns_future_datetime(self):
        """Session expiry is in the future."""
        session_key = create_session(user_id=1)
        expiry = get_session_expiry(session_key)
        self.assertIsNotNone(expiry)
        assert expiry is not None  # For type checker
        self.assertGreater(expiry, timezone.now())

    def test_get_session_expiry_returns_none_for_invalid_key(self):
        """Session expiry returns None for invalid key."""
        expiry = get_session_expiry("invalid-key")
        self.assertIsNone(expiry)

    def test_refresh_session_returns_same_key_if_not_needed(self):
        """Refreshing a fresh session returns the same key."""
        session_key = create_session(user_id=1)
        new_key = refresh_session(session_key)
        self.assertEqual(new_key, session_key)

    def test_refresh_session_returns_none_for_invalid_key(self):
        """Refreshing invalid session returns None."""
        new_key = refresh_session("invalid-key")
        self.assertIsNone(new_key)

    def test_refresh_session_creates_new_session_when_close_to_expiry(self):
        """Refreshing session close to expiry creates new session."""
        session_key = create_session(user_id=1)
        session = get_session(session_key)

        # Mock the session to appear close to expiry
        # Set expiry to less than threshold
        with patch.object(
            session, "get_expiry_age", return_value=REFRESH_THRESHOLD.total_seconds() - 1
        ):
            # We need to re-get the session since our patch won't affect get_session
            pass

        # Instead, let's test by creating a session with short expiry
        session = get_session(session_key)
        if session:
            session.set_expiry(10)  # 10 seconds
            session.save()

            new_key = refresh_session(session_key)
            self.assertIsNotNone(new_key)
            assert new_key is not None  # For type checker
            self.assertNotEqual(new_key, session_key)
            # Old session should be deleted
            self.assertFalse(is_session_valid(session_key))
            # New session should be valid
            self.assertTrue(is_session_valid(new_key))


class SessionAPITests(APITestCase):
    """Tests for session API endpoints."""

    def test_get_session_without_auth_returns_401(self):
        """GET /api/auth/session without session returns 401."""
        response = self.client.get("/api/auth/session")
        self.assertEqual(response.status_code, 401)
        self.assertFalse(response.data["authenticated"])

    def test_create_session_requires_user_id(self):
        """POST /api/auth/session requires user_id."""
        response = self.client.post("/api/auth/session", {}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("error", response.data)

    def test_create_session_returns_session_key(self):
        """POST /api/auth/session with user_id returns session key."""
        response = self.client.post("/api/auth/session", {"user_id": 1}, format="json")
        self.assertEqual(response.status_code, 201)
        self.assertIn("session_key", response.data)
        self.assertEqual(response.data["user_id"], 1)
        self.assertIn("expires_at", response.data)

    def test_create_session_sets_cookie(self):
        """POST /api/auth/session sets session cookie."""
        response = self.client.post("/api/auth/session", {"user_id": 1}, format="json")
        self.assertEqual(response.status_code, 201)
        self.assertIn("session_key", response.cookies)

    def test_get_session_with_valid_session_header(self):
        """GET /api/auth/session with valid X-Session-Key header."""
        # Create session
        create_response = self.client.post(
            "/api/auth/session", {"user_id": 1}, format="json"
        )
        session_key = create_response.data["session_key"]

        # Get session info using header
        response = self.client.get(
            "/api/auth/session", HTTP_X_SESSION_KEY=session_key
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["authenticated"])
        self.assertEqual(response.data["user_id"], 1)

    def test_delete_session_without_session_returns_400(self):
        """DELETE /api/auth/session without session returns 400."""
        response = self.client.delete("/api/auth/session")
        self.assertEqual(response.status_code, 400)

    def test_delete_session_with_valid_session(self):
        """DELETE /api/auth/session with valid session deletes it."""
        # Create session
        create_response = self.client.post(
            "/api/auth/session", {"user_id": 1}, format="json"
        )
        session_key = create_response.data["session_key"]

        # Delete session
        response = self.client.delete(
            "/api/auth/session", HTTP_X_SESSION_KEY=session_key
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["deleted"])

        # Verify session is gone
        response = self.client.get(
            "/api/auth/session", HTTP_X_SESSION_KEY=session_key
        )
        self.assertEqual(response.status_code, 401)

    def test_refresh_session_without_session_returns_400(self):
        """POST /api/auth/session/refresh without session returns 400."""
        response = self.client.post("/api/auth/session/refresh")
        self.assertEqual(response.status_code, 400)

    def test_refresh_session_with_valid_session(self):
        """POST /api/auth/session/refresh with valid session."""
        # Create session
        create_response = self.client.post(
            "/api/auth/session", {"user_id": 1}, format="json"
        )
        session_key = create_response.data["session_key"]

        # Refresh session
        response = self.client.post(
            "/api/auth/session/refresh", HTTP_X_SESSION_KEY=session_key
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn("session_key", response.data)
        self.assertIn("refreshed", response.data)
        # Fresh session shouldn't need refresh
        self.assertFalse(response.data["refreshed"])

    def test_refresh_session_with_invalid_session_returns_404(self):
        """POST /api/auth/session/refresh with invalid session returns 404."""
        response = self.client.post(
            "/api/auth/session/refresh", HTTP_X_SESSION_KEY="invalid-key"
        )
        self.assertEqual(response.status_code, 404)

    def test_create_session_rejects_non_integer_user_id(self):
        """POST /api/auth/session rejects non-integer user_id."""
        response = self.client.post(
            "/api/auth/session", {"user_id": "not-an-int"}, format="json"
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("error", response.data)
