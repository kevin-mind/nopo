"""
Traffic source middleware for subdomain-based routing.

This middleware validates and processes traffic headers injected by the load balancer
and service-to-service calls, making traffic metadata available to views.

Headers:
- X-Traffic-Source: "public" for traffic from the load balancer
- X-Service-Origin: Service name for service-to-service calls (e.g., "web", "api")
"""

from typing import Callable

from django.http import HttpRequest, HttpResponse


class TrafficSourceMiddleware:
    """
    Middleware to validate and process traffic source headers.

    Makes the following attributes available on request:
    - request.traffic_source: "public" | "internal" | "unknown"
    - request.service_origin: Service name if service-to-service call, None otherwise

    Note: In production, ensure the load balancer strips these headers from
    incoming requests before adding its own, to prevent header spoofing.
    """

    HEADER_TRAFFIC_SOURCE = "X-Traffic-Source"
    HEADER_SERVICE_ORIGIN = "X-Service-Origin"

    # Valid traffic source values
    TRAFFIC_SOURCE_PUBLIC = "public"

    def __init__(self, get_response: Callable[[HttpRequest], HttpResponse]) -> None:
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponse:
        # Get traffic source header (case-insensitive lookup via Django)
        # Django converts headers to META format: X-Traffic-Source -> HTTP_X_TRAFFIC_SOURCE
        traffic_source_header = request.META.get("HTTP_X_TRAFFIC_SOURCE", "")
        service_origin_header = request.META.get("HTTP_X_SERVICE_ORIGIN", "")

        # Determine traffic source
        if traffic_source_header == self.TRAFFIC_SOURCE_PUBLIC:
            traffic_source = "public"
        elif service_origin_header:
            traffic_source = "internal"
        else:
            # No recognized headers - could be direct access or misconfigured proxy
            traffic_source = "unknown"

        # Attach to request for use in views
        request.traffic_source = traffic_source  # type: ignore[attr-defined]
        request.service_origin = service_origin_header or None  # type: ignore[attr-defined]

        return self.get_response(request)
