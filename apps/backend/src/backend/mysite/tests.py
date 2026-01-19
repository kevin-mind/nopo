"""Tests for mysite middleware."""

from django.test import TestCase, RequestFactory

from backend.mysite.middleware import TrafficSourceMiddleware


class TrafficSourceMiddlewareTests(TestCase):
    """Test cases for TrafficSourceMiddleware."""

    def setUp(self) -> None:
        """Set up test fixtures."""
        self.factory = RequestFactory()
        # Create a simple response function
        self.get_response = lambda request: request

    def test_public_traffic_source(self) -> None:
        """Test that X-Traffic-Source: public is recognized."""
        middleware = TrafficSourceMiddleware(self.get_response)
        request = self.factory.get("/", HTTP_X_TRAFFIC_SOURCE="public")

        middleware(request)

        self.assertEqual(request.traffic_source, "public")  # type: ignore[attr-defined]
        self.assertIsNone(request.service_origin)  # type: ignore[attr-defined]

    def test_service_origin_header(self) -> None:
        """Test that X-Service-Origin header is recognized as internal traffic."""
        middleware = TrafficSourceMiddleware(self.get_response)
        request = self.factory.get("/", HTTP_X_SERVICE_ORIGIN="web")

        middleware(request)

        self.assertEqual(request.traffic_source, "internal")  # type: ignore[attr-defined]
        self.assertEqual(request.service_origin, "web")  # type: ignore[attr-defined]

    def test_both_headers_present(self) -> None:
        """Test behavior when both headers are present (public takes precedence)."""
        middleware = TrafficSourceMiddleware(self.get_response)
        request = self.factory.get(
            "/", HTTP_X_TRAFFIC_SOURCE="public", HTTP_X_SERVICE_ORIGIN="web"
        )

        middleware(request)

        # Public traffic source takes precedence
        self.assertEqual(request.traffic_source, "public")  # type: ignore[attr-defined]
        # But service origin is still set if provided
        self.assertEqual(request.service_origin, "web")  # type: ignore[attr-defined]

    def test_no_headers_is_unknown(self) -> None:
        """Test that missing headers results in unknown traffic source."""
        middleware = TrafficSourceMiddleware(self.get_response)
        request = self.factory.get("/")

        middleware(request)

        self.assertEqual(request.traffic_source, "unknown")  # type: ignore[attr-defined]
        self.assertIsNone(request.service_origin)  # type: ignore[attr-defined]

    def test_invalid_traffic_source_is_unknown(self) -> None:
        """Test that invalid traffic source values are treated as unknown."""
        middleware = TrafficSourceMiddleware(self.get_response)
        request = self.factory.get("/", HTTP_X_TRAFFIC_SOURCE="invalid")

        middleware(request)

        # Invalid value without service origin should be unknown
        self.assertEqual(request.traffic_source, "unknown")  # type: ignore[attr-defined]
        self.assertIsNone(request.service_origin)  # type: ignore[attr-defined]

    def test_empty_service_origin_is_ignored(self) -> None:
        """Test that empty service origin header is treated as missing."""
        middleware = TrafficSourceMiddleware(self.get_response)
        request = self.factory.get("/", HTTP_X_SERVICE_ORIGIN="")

        middleware(request)

        self.assertEqual(request.traffic_source, "unknown")  # type: ignore[attr-defined]
        self.assertIsNone(request.service_origin)  # type: ignore[attr-defined]

    def test_various_service_origins(self) -> None:
        """Test that various service names are recognized."""
        middleware = TrafficSourceMiddleware(self.get_response)

        for service_name in ["web", "api", "worker", "scheduler"]:
            request = self.factory.get("/", HTTP_X_SERVICE_ORIGIN=service_name)
            middleware(request)

            self.assertEqual(request.traffic_source, "internal")  # type: ignore[attr-defined]
            self.assertEqual(request.service_origin, service_name)  # type: ignore[attr-defined]
