"""
URL configuration for auth app.
"""

from django.urls import path

from .views import SessionRefreshView, SessionView

urlpatterns = [
    path("session", SessionView.as_view(), name="session"),
    path("session/refresh", SessionRefreshView.as_view(), name="session-refresh"),
]
