"""
Session management API views.
"""

from rest_framework import status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from .session_storage import (
    create_session,
    delete_session,
    get_session_expiry,
    get_session_user_id,
    is_session_valid,
    refresh_session,
)


class SessionView(APIView):
    """
    API view for session management.

    GET: Check if current session is valid and get session info.
    POST: Create a new session (requires user_id in request body).
    DELETE: Invalidate/logout the current session.
    """

    def get(self, request: Request) -> Response:
        """Get current session info."""
        session_key = request.COOKIES.get("session_key") or request.headers.get(
            "X-Session-Key"
        )

        if not session_key or not is_session_valid(session_key):
            return Response(
                {"authenticated": False, "error": "No valid session"},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        user_id = get_session_user_id(session_key)
        expiry = get_session_expiry(session_key)

        return Response(
            {
                "authenticated": True,
                "user_id": user_id,
                "expires_at": expiry.isoformat() if expiry else None,
            }
        )

    def post(self, request: Request) -> Response:
        """Create a new session."""
        user_id = request.data.get("user_id")

        if not user_id:
            return Response(
                {"error": "user_id is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            user_id = int(user_id)
        except (TypeError, ValueError):
            return Response(
                {"error": "user_id must be an integer"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        session_key = create_session(user_id)
        expiry = get_session_expiry(session_key)

        response = Response(
            {
                "session_key": session_key,
                "user_id": user_id,
                "expires_at": expiry.isoformat() if expiry else None,
            },
            status=status.HTTP_201_CREATED,
        )

        # Also set as cookie for browser clients
        response.set_cookie(
            "session_key",
            session_key,
            httponly=True,
            secure=True,
            samesite="Lax",
        )

        return response

    def delete(self, request: Request) -> Response:
        """Delete/logout the current session."""
        session_key = request.COOKIES.get("session_key") or request.headers.get(
            "X-Session-Key"
        )

        if not session_key:
            return Response(
                {"error": "No session to delete"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        deleted = delete_session(session_key)

        response = Response(
            {"deleted": deleted},
            status=status.HTTP_200_OK if deleted else status.HTTP_404_NOT_FOUND,
        )

        # Clear cookie
        response.delete_cookie("session_key")

        return response


class SessionRefreshView(APIView):
    """
    API view for refreshing sessions.

    POST: Refresh the current session, extending its expiry time.
    """

    def post(self, request: Request) -> Response:
        """Refresh the current session."""
        session_key = request.COOKIES.get("session_key") or request.headers.get(
            "X-Session-Key"
        )

        if not session_key:
            return Response(
                {"error": "No session to refresh"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        new_session_key = refresh_session(session_key)

        if new_session_key is None:
            return Response(
                {"error": "Session not found or invalid"},
                status=status.HTTP_404_NOT_FOUND,
            )

        expiry = get_session_expiry(new_session_key)
        refreshed = new_session_key != session_key

        response = Response(
            {
                "session_key": new_session_key,
                "refreshed": refreshed,
                "expires_at": expiry.isoformat() if expiry else None,
            }
        )

        # Update cookie if session key changed
        if refreshed:
            response.set_cookie(
                "session_key",
                new_session_key,
                httponly=True,
                secure=True,
                samesite="Lax",
            )

        return response
