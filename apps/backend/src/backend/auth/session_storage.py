"""
Session storage utilities for managing user sessions.

This module provides session storage functionality using Django's built-in
session framework with additional utilities for session management.
"""

from datetime import datetime, timedelta
from typing import Any

from django.contrib.sessions.backends.db import SessionStore
from django.utils import timezone


# Default session expiry time (2 weeks)
DEFAULT_SESSION_EXPIRY = timedelta(days=14)

# Refresh threshold - refresh session if less than this time remaining
REFRESH_THRESHOLD = timedelta(days=1)


def create_session(user_id: int, data: dict[str, Any] | None = None) -> str:
    """
    Create a new session for a user.

    Args:
        user_id: The ID of the user to create a session for.
        data: Optional additional data to store in the session.

    Returns:
        The session key (token) for the new session.
    """
    session = SessionStore()
    session["user_id"] = user_id
    session["created_at"] = timezone.now().isoformat()

    if data:
        for key, value in data.items():
            session[key] = value

    session.set_expiry(int(DEFAULT_SESSION_EXPIRY.total_seconds()))
    session.create()

    # session_key is guaranteed to be set after create()
    assert session.session_key is not None
    return session.session_key


def get_session(session_key: str) -> SessionStore | None:
    """
    Retrieve a session by its key.

    Args:
        session_key: The session key to look up.

    Returns:
        The session store if found and valid, None otherwise.
    """
    if not session_key:
        return None

    session = SessionStore(session_key=session_key)

    # Check if session exists and hasn't expired
    if not session.exists(session_key):
        return None

    return session


def get_session_user_id(session_key: str) -> int | None:
    """
    Get the user ID from a session.

    Args:
        session_key: The session key to look up.

    Returns:
        The user ID if found, None otherwise.
    """
    session = get_session(session_key)
    if session is None:
        return None

    return session.get("user_id")


def delete_session(session_key: str) -> bool:
    """
    Delete a session.

    Args:
        session_key: The session key to delete.

    Returns:
        True if the session was deleted, False if it didn't exist.
    """
    session = get_session(session_key)
    if session is None:
        return False

    session.delete()
    return True


def refresh_session(session_key: str) -> str | None:
    """
    Refresh a session, extending its expiry time.

    If the session is close to expiring (within REFRESH_THRESHOLD),
    a new session is created with the same data and the old one is deleted.

    Args:
        session_key: The session key to refresh.

    Returns:
        The new session key if refreshed, the same key if not needed,
        or None if the session doesn't exist.
    """
    session = get_session(session_key)
    if session is None:
        return None

    # Get expiry time
    expiry_age = session.get_expiry_age()

    # If session has plenty of time left, just return the same key
    if expiry_age > REFRESH_THRESHOLD.total_seconds():
        return session_key

    # Session needs refresh - create new one with same data
    user_id = session.get("user_id")
    if user_id is None:
        return None

    # Collect all session data except internal keys
    data = {k: v for k, v in session.items() if not k.startswith("_")}
    data.pop("user_id", None)  # Will be added by create_session
    data.pop("created_at", None)  # Will be refreshed

    # Delete old session
    session.delete()

    # Create new session
    return create_session(user_id, data if data else None)


def is_session_valid(session_key: str) -> bool:
    """
    Check if a session is valid (exists and not expired).

    Args:
        session_key: The session key to check.

    Returns:
        True if the session is valid, False otherwise.
    """
    return get_session(session_key) is not None


def get_session_expiry(session_key: str) -> datetime | None:
    """
    Get the expiry datetime of a session.

    Args:
        session_key: The session key to check.

    Returns:
        The expiry datetime if the session exists, None otherwise.
    """
    session = get_session(session_key)
    if session is None:
        return None

    expiry_age = session.get_expiry_age()
    return timezone.now() + timedelta(seconds=expiry_age)
